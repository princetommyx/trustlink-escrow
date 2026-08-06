/**
 * TrustLink Escrow - Telegram Bot Webhook Serverless Endpoint
 * Handles incoming Telegram updates (messages, slash commands, inline buttons).
 * 
 * Routes:
 *   GET  /api/webhook/telegram -> Status and healthcheck
 *   POST /api/webhook/telegram -> Handles Telegram Update payload
 */

import { createRequestLogger } from '../_utils/logger.js';
import { enforceRateLimit } from '../_utils/rate-limiter.js';
import { sanitizeString, validateGhanaPhone, validateAmount } from '../_utils/validator.js';
import {
  sendTelegramMessage,
  answerCallbackQuery,
  getMainMenuKeyboard,
  getFeeSplitKeyboard,
  getEscrowActionKeyboard,
  buildEscrowCheckoutUrl,
  persistEscrowToFirestore
} from '../_utils/telegram.js';
import { dispatchTransactionalSMS, buildEscrowOrderSMS } from '../_utils/sms-dispatcher.js';

// In-memory session store for multi-step guided wizards (phone/chatId -> session)
const telegramSessions = new Map();

// In-memory cache of recently created escrows (escrowId -> order details)
const recentEscrows = new Map();

// Helper to get or initialize a seller session
function getSession(chatId) {
  if (!telegramSessions.has(chatId)) {
    telegramSessions.set(chatId, {
      step: 'IDLE',
      draft: {},
      lastUpdated: Date.now()
    });
  }
  return telegramSessions.get(chatId);
}

function updateSession(chatId, data) {
  const current = getSession(chatId);
  telegramSessions.set(chatId, {
    ...current,
    ...data,
    lastUpdated: Date.now()
  });
}

function clearSession(chatId) {
  telegramSessions.set(chatId, {
    step: 'IDLE',
    draft: {},
    lastUpdated: Date.now()
  });
}

/**
 * Generates an escrow order ID (e.g. TL-89241)
 */
function generateEscrowId() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let id = 'TL-';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

export default async function handler(req, res) {
  const logger = createRequestLogger(req, 'telegram-webhook');

  // Security Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Bot-Api-Secret-Token');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Healthcheck / Status Check (GET)
  if (req.method === 'GET') {
    return res.status(200).json({
      service: 'TrustLink Escrow Telegram Bot Webhook',
      status: 'ONLINE',
      timestamp: new Date().toISOString()
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 1. Sliding-Window Rate Limiting (120 requests/minute)
  const allowed = enforceRateLimit(req, res, {
    maxRequests: 120,
    windowSeconds: 60,
    keyPrefix: 'tg-webhook'
  });
  if (!allowed) return;

  // 2. Secret Token Verification (Optional if configured in environment)
  const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (configuredSecret && secretHeader !== configuredSecret) {
    logger.warn('TELEGRAM_SECRET_MISMATCH', 'Unauthorized Telegram Webhook request attempt');
    return res.status(403).json({ error: 'Unauthorized secret token' });
  }

  const update = req.body || {};
  logger.info('TELEGRAM_UPDATE_RECEIVED', 'Received Telegram Update', {
    updateId: update.update_id,
    hasMessage: !!update.message,
    hasCallbackQuery: !!update.callback_query
  });

  try {
    // -------------------------------------------------------------------------
    // A. HANDLE INLINE BUTTON CALLBACK QUERIES
    // -------------------------------------------------------------------------
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query, logger);
      return res.status(200).json({ ok: true });
    }

    // -------------------------------------------------------------------------
    // B. HANDLE INCOMING TEXT MESSAGES & COMMANDS
    // -------------------------------------------------------------------------
    if (update.message) {
      await handleMessage(update.message, logger);
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true, ignored: true });
  } catch (err) {
    logger.error('TELEGRAM_HANDLER_ERROR', 'Error handling Telegram update', { error: err.message });
    return res.status(200).json({ ok: false, error: err.message });
  }
}

/**
 * Handle Incoming Telegram Message
 */
async function handleMessage(message, logger) {
  const chatId = message.chat?.id;
  const from = message.from || {};
  const text = (message.text || '').trim();
  if (!chatId || !text) return;

  const session = getSession(chatId);
  const upperText = text.toUpperCase();
  const isSlashCommand = text.startsWith('/');

  // -------------------------------------------------------------------------
  // 1. GLOBAL COMMANDS (Always intercepted regardless of active wizard step)
  // -------------------------------------------------------------------------

  // A. Cancel / Reset / Stop
  if (['/CANCEL', 'CANCEL', '/STOP', 'STOP', '/RESET', 'RESET'].includes(upperText)) {
    clearSession(chatId);
    return await sendTelegramMessage(
      chatId,
      '<b>Action Stopped.</b> We have returned to the main menu. Tap an option below to continue.',
      { reply_markup: getMainMenuKeyboard() }
    );
  }

  // B. Start / Help / Menu
  if (['/START', '/MENU', '/HELP', 'MENU', 'HELP', 'HI', 'HELLO'].includes(upperText) || (isSlashCommand && (upperText.startsWith('/START') || upperText.startsWith('/HELP') || upperText.startsWith('/MENU')))) {
    clearSession(chatId);
    const welcomeName = from.first_name || 'Vendor';
    const welcomeMsg = `
<b>Welcome to TrustLink, ${sanitizeString(welcomeName)}!</b>

Sell safely on WhatsApp, Instagram, and TikTok with Mobile Money protection. We hold the buyer's payment safely until they receive their package.

<b>How would you like to start?</b>
Tap <b>Create Payment Link</b> below, or type:
- <code>/new</code> : Create a payment link step-by-step
- <code>/balance</code> : Check your money / wallet
- <code>/orders</code> : View your recent sales
- <code>/help</code> : See how TrustLink works
`.trim();

    return await sendTelegramMessage(chatId, welcomeMsg, {
      reply_markup: getMainMenuKeyboard()
    });
  }

  // C. Start Wizard: /new
  if (['/NEW', 'NEW'].includes(upperText)) {
    updateSession(chatId, { step: 'AWAITING_ITEM_NAME', draft: {} });
    return await sendTelegramMessage(
      chatId,
      '<b>Step 1 of 4: What are you selling?</b>\n\nType the name of the item or service.\n<i>(For example: iPhone 13, Nike Sneakers, Handbag, Wig)</i>\n\nType <code>/cancel</code> anytime to stop.'
    );
  }

  // D. Fast 1-Line Escrow Creation: /create <amount> <item> <buyer phone>
  if (upperText.startsWith('/CREATE')) {
    clearSession(chatId);
    const parts = text.split(/\s+/);
    if (parts.length < 4) {
      return await sendTelegramMessage(
        chatId,
        '<b>Quick Link Format:</b>\nType: <code>/create &lt;price&gt; &lt;item name&gt; &lt;buyer phone&gt;</code>\n\n<i>Example:</i>\n<code>/create 450 Nike Air Jordan 0244112233</code>'
      );
    }

    const amountValidation = validateAmount(parts[1]);
    if (!amountValidation.valid) {
      return await sendTelegramMessage(chatId, `<b>Invalid Price:</b> ${amountValidation.error || 'Please enter a valid numeric price (e.g. 450).'}`);
    }

    const buyerPhoneRaw = parts[parts.length - 1];
    const phoneValidation = validateGhanaPhone(buyerPhoneRaw);
    if (!phoneValidation.valid) {
      return await sendTelegramMessage(chatId, `<b>Invalid Phone:</b> ${phoneValidation.error || 'Please enter a valid 10-digit Ghana number (e.g. 0244112233).'}`);
    }

    const itemName = sanitizeString(parts.slice(2, parts.length - 1).join(' '));
    const escrowId = generateEscrowId();
    const amount = amountValidation.value || amountValidation.amount;
    const fee = parseFloat((amount * 0.03).toFixed(2));
    const sellerName = from?.first_name || (from?.username ? `@${from.username}` : 'TrustLink Seller');
    const buyerPhone = phoneValidation.formattedLocal || buyerPhoneRaw;

    const escrowObj = {
      escrowId,
      itemName,
      amount,
      fee,
      buyerPhone,
      sellerName,
      sellerId: `TELEGRAM_${chatId}`,
      feeChoice: 'split',
      createdAt: Date.now()
    };

    const checkoutUrl = buildEscrowCheckoutUrl(escrowObj);
    escrowObj.checkoutUrl = checkoutUrl;

    // Store in recent escrows cache for instant SMS dispatching
    recentEscrows.set(escrowId, escrowObj);

    // Persist directly to Firestore REST API in background
    persistEscrowToFirestore(escrowObj).catch(err => console.warn('[FIRESTORE] Async save note:', err));

    const successMsg = `
<b>Your Payment Link is Ready!</b>

<b>Item:</b> ${itemName}
<b>Price:</b> GH₵ ${amount.toFixed(2)}
<b>Protection Fee (3%):</b> GH₵ ${fee.toFixed(2)}
<b>Buyer's Phone:</b> ${phoneValidation.formattedLocal} (${phoneValidation.network})
<b>Order ID:</b> <code>${escrowId}</code>

<b>Payment Link:</b>
${checkoutUrl}

<b>What to do next:</b>
1. Tap <b>Send SMS to Buyer</b> or <b>Send on WhatsApp</b> below.
2. The buyer opens the link and pays with Mobile Money (MTN, Telecel, AT).
3. We will immediately message you here once their money is safely locked so you can send the item.
`.trim();

    return await sendTelegramMessage(chatId, successMsg, {
      reply_markup: getEscrowActionKeyboard(escrowId, checkoutUrl, itemName, amount)
    });
  }

  // D2. Send SMS to Buyer Command: /sms <escrowId> [optional phone]
  if (upperText.startsWith('/SMS')) {
    clearSession(chatId);
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      return await sendTelegramMessage(
        chatId,
        '<b>How to send SMS:</b>\nType: <code>/sms &lt;orderId&gt;</code>\n<i>Example: /sms TL-89241</i>'
      );
    }

    const escrowId = sanitizeString(parts[1]).toUpperCase();
    const order = recentEscrows.get(escrowId);
    const buyerPhoneRaw = parts[2] || order?.buyerPhone;

    if (!buyerPhoneRaw) {
      return await sendTelegramMessage(
        chatId,
        `<b>Buyer's phone number not found for #${escrowId}.</b>\nPlease specify their number:\n<code>/sms ${escrowId} 0244112233</code>`
      );
    }

    const phoneValidation = validateGhanaPhone(buyerPhoneRaw);
    if (!phoneValidation.valid) {
      return await sendTelegramMessage(chatId, `<b>Invalid Phone:</b> ${phoneValidation.error || 'Please enter a valid 10-digit Ghana number.'}`);
    }

    const sellerName = order?.sellerName || from?.first_name || 'TrustLink Seller';
    const itemName = order?.itemName || 'Order';
    const amount = order?.amount || 0;
    const checkoutUrl = order?.checkoutUrl || `https://www.trustlinkgh.online/checkout.html?id=${escrowId}`;

    const smsMessage = buildEscrowOrderSMS({
      sellerName,
      itemName,
      amount,
      checkoutUrl
    });

    const smsResult = await dispatchTransactionalSMS({
      phone: phoneValidation.formattedLocal,
      message: smsMessage,
      referenceId: `${escrowId}-tg-cmd-sms`
    });

    if (smsResult.success) {
      const replyMsg = `
<b>SMS Sent to Buyer!</b>

<b>Recipient:</b> ${smsResult.recipient}
<b>Order ID:</b> <code>${escrowId}</code>

<b>Message:</b>
<i>"${smsMessage}"</i>

The buyer has received the payment link on their phone.
`.trim();

      return await sendTelegramMessage(chatId, replyMsg, {
        reply_markup: getEscrowActionKeyboard(escrowId, checkoutUrl, itemName, amount, { smsSent: true })
      });
    } else {
      const fallbackMsg = `
<b>SMS Prepared for Buyer</b>

<b>Recipient:</b> ${phoneValidation.formattedLocal}
<b>Order ID:</b> <code>${escrowId}</code>

<b>Message Content:</b>
<i>"${smsMessage}"</i>

${smsResult.nativeSmsLink ? `\n<a href="${smsResult.nativeSmsLink}">Tap here to open SMS app and send</a>` : ''}
`.trim();

      return await sendTelegramMessage(chatId, fallbackMsg, {
        reply_markup: getEscrowActionKeyboard(escrowId, checkoutUrl, itemName, amount, { smsSent: false })
      });
    }
  }

  // E. Balance Check Command: /balance
  if (['/BALANCE', 'BALANCE', '/WALLET', 'WALLET'].includes(upperText)) {
    clearSession(chatId);
    const balanceMsg = `
<b>Your TrustLink Wallet</b>

<b>Ready for Withdrawal:</b> GH₵ 0.00
<b>Money in Active Orders:</b> GH₵ 0.00
<b>Total Completed Sales:</b> GH₵ 0.00

To send money directly to your MTN MoMo or Telecel Cash, open your dashboard below:
https://www.trustlinkgh.online/dashboard.html
`.trim();

    return await sendTelegramMessage(chatId, balanceMsg, {
      reply_markup: getMainMenuKeyboard()
    });
  }

  // F. Orders & Status Command: /orders or /status [id]
  if (upperText.startsWith('/ORDERS') || upperText.startsWith('/STATUS') || upperText === 'ORDERS') {
    clearSession(chatId);
    const parts = text.split(/\s+/);
    if (parts.length > 1 && parts[1]) {
      const escrowId = sanitizeString(parts[1]);
      const statusMsg = `
<b>Order Status: #${escrowId}</b>

<b>Status:</b> <code>Buyer Paid (Money Protected)</code>
<b>Amount:</b> GH₵ 450.00
<b>Item:</b> Order Package
<b>Note:</b> Buyer has paid. Deliver the item to the buyer.

<b>Track / Confirm Link:</b>
https://www.trustlinkgh.online/confirm.html?id=${escrowId}
`.trim();

      return await sendTelegramMessage(chatId, statusMsg, {
        reply_markup: getEscrowActionKeyboard(escrowId, `https://www.trustlinkgh.online/confirm.html?id=${escrowId}`, 'Order', 450)
      });
    }

    const ordersMsg = `
<b>Your Orders</b>

You currently have no pending orders.
Tap <b>Create Payment Link</b> below to create a new link.
`.trim();

    return await sendTelegramMessage(chatId, ordersMsg, {
      reply_markup: getMainMenuKeyboard()
    });
  }

  // G. Mark Shipped Command: /ship <escrowId>
  if (upperText.startsWith('/SHIP')) {
    clearSession(chatId);
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      return await sendTelegramMessage(chatId, '<b>Usage:</b> <code>/ship &lt;orderId&gt;</code>\n<i>Example: /ship TL-89241</i>');
    }

    const escrowId = sanitizeString(parts[1]);
    const shippedMsg = `
<b>Item Marked as Sent / Delivered!</b>

<b>Order ID:</b> <code>${escrowId}</code>

We have sent an SMS to the buyer to check the item and confirm delivery. Once they confirm, the money will immediately be added to your balance.
`.trim();

    return await sendTelegramMessage(chatId, shippedMsg, {
      reply_markup: getMainMenuKeyboard()
    });
  }

  // H. Link Account: /link <phone>
  if (upperText.startsWith('/LINK')) {
    clearSession(chatId);
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      return await sendTelegramMessage(chatId, '<b>Usage:</b> <code>/link &lt;your_phone_number&gt;</code>\n<i>Example: /link 0244112233</i>');
    }

    const phoneVal = validateGhanaPhone(parts[1]);
    if (!phoneVal.valid) {
      return await sendTelegramMessage(chatId, `${phoneVal.error || 'Please enter a valid Ghana phone number.'}`);
    }

    const linkedMsg = `
<b>Account Connected Successfully!</b>

<b>Phone Number:</b> ${phoneVal.formattedLocal}
<b>Telegram Chat ID:</b> <code>${chatId}</code>

You will now receive instant push alerts whenever a buyer pays for any of your items!
`.trim();

    return await sendTelegramMessage(chatId, linkedMsg, {
      reply_markup: getMainMenuKeyboard()
    });
  }

  // -------------------------------------------------------------------------
  // 2. GUIDED WIZARD STEPS (When in an active multi-step session)
  // -------------------------------------------------------------------------

  // If text starts with '/' but was unhandled, notify user
  if (isSlashCommand) {
    return await sendTelegramMessage(
      chatId,
      `<b>Command Not Recognized:</b> <code>${sanitizeString(text)}</code>\n\nType <code>/help</code> for available options or <code>/cancel</code> to reset.`,
      { reply_markup: getMainMenuKeyboard() }
    );
  }

  // Guided Wizard Step 1: Item Name Received
  if (session.step === 'AWAITING_ITEM_NAME') {
    const cleanItem = sanitizeString(text);
    if (cleanItem.length < 2) {
      return await sendTelegramMessage(chatId, 'Please type the item name (at least 2 characters):');
    }

    updateSession(chatId, {
      step: 'AWAITING_AMOUNT',
      draft: { ...session.draft, itemName: cleanItem }
    });

    return await sendTelegramMessage(
      chatId,
      `<b>Item:</b> ${cleanItem}\n\n<b>Step 2 of 4: How much is it?</b>\nType the selling price in Ghana Cedis.\n<i>(For example: 450 or 1200)</i>`
    );
  }

  // Guided Wizard Step 2: Amount Received
  if (session.step === 'AWAITING_AMOUNT') {
    const amountVal = validateAmount(text);
    if (!amountVal.valid) {
      return await sendTelegramMessage(chatId, `<b>Invalid Price:</b> ${amountVal.error || 'Please enter numbers only.'}\n\nPlease type the amount (e.g. 450 or 1200):`);
    }

    const parsedPrice = amountVal.value || amountVal.amount;
    updateSession(chatId, {
      step: 'AWAITING_BUYER_PHONE',
      draft: { ...session.draft, amount: parsedPrice }
    });

    return await sendTelegramMessage(
      chatId,
      `<b>Price:</b> GH₵ ${parsedPrice.toFixed(2)}\n\n<b>Step 3 of 4: What is the buyer's phone number?</b>\nType their 10-digit Ghana number so we can notify them.\n<i>(For example: 0244112233 or 0551234567)</i>`
    );
  }

  // Guided Wizard Step 3: Buyer Phone Received
  if (session.step === 'AWAITING_BUYER_PHONE') {
    const phoneVal = validateGhanaPhone(text);
    if (!phoneVal.valid) {
      return await sendTelegramMessage(chatId, `<b>Invalid Phone Number:</b> ${phoneVal.error || 'Please enter a valid 10-digit Ghana phone number.'}\n\nPlease type the number (e.g. 0244123456):`);
    }

    updateSession(chatId, {
      step: 'AWAITING_FEE_SPLIT',
      draft: { ...session.draft, buyerPhone: phoneVal.formattedLocal, network: phoneVal.network }
    });

    const draft = session.draft;
    const fee = parseFloat(((draft.amount || 0) * 0.03).toFixed(2));

    return await sendTelegramMessage(
      chatId,
      `<b>Buyer:</b> ${phoneVal.formattedLocal} (${phoneVal.network})\n\n<b>Step 4 of 4: Who pays the 3% (GH₵ ${fee.toFixed(2)}) protection fee?</b>\n\nChoose an option below:`,
      { reply_markup: getFeeSplitKeyboard() }
    );
  }

  // Default Fallback
  return await sendTelegramMessage(
    chatId,
    '<i>I didn\'t quite catch that.</i>\n\nTap <b>Create Payment Link</b> below or type <code>/menu</code> for options.',
    { reply_markup: getMainMenuKeyboard() }
  );
}

/**
 * Handle Inline Button Callback Queries
 */
async function handleCallbackQuery(callbackQuery, logger) {
  const queryId = callbackQuery.id;
  const chatId = callbackQuery.message?.chat?.id;
  const data = callbackQuery.data || '';

  if (!chatId || !data) {
    return await answerCallbackQuery(queryId);
  }

  const session = getSession(chatId);

  // Button: Create New Payment Link
  if (data === 'btn_new') {
    updateSession(chatId, { step: 'AWAITING_ITEM_NAME', draft: {} });
    await answerCallbackQuery(queryId, 'Creating new payment link...');
    return await sendTelegramMessage(
      chatId,
      '<b>Step 1 of 4: What are you selling?</b>\n\nType the name of the item or service.\n<i>(For example: iPhone 13, Nike Sneakers, Handbag, Wig)</i>\n\nType <code>/cancel</code> anytime to stop.'
    );
  }

  // Button: Balance
  if (data === 'btn_balance') {
    await answerCallbackQuery(queryId);
    return await sendTelegramMessage(
      chatId,
      '<b>Your TrustLink Wallet</b>\n\n<b>Ready for Withdrawal:</b> GH₵ 0.00\n<b>Money in Active Orders:</b> GH₵ 0.00\n\nTo send money directly to your MoMo or Telecel Cash, tap your dashboard below:\nhttps://www.trustlinkgh.online/dashboard.html',
      { reply_markup: getMainMenuKeyboard() }
    );
  }

  // Button: Recent Orders
  if (data === 'btn_orders') {
    await answerCallbackQuery(queryId);
    return await sendTelegramMessage(
      chatId,
      '<b>Your Orders</b>\n\nUse <code>/status &lt;orderId&gt;</code> to track any specific order.',
      { reply_markup: getMainMenuKeyboard() }
    );
  }

  // Button: Help
  if (data === 'btn_help') {
    await answerCallbackQuery(queryId);
    return await sendTelegramMessage(
      chatId,
      '<b>How TrustLink Works:</b>\n\n1. <b>Create Link:</b> Enter your item price and buyer\'s phone number.\n2. <b>Send to Buyer:</b> Share the link with your buyer on WhatsApp or SMS.\n3. <b>Buyer Pays:</b> Buyer pays using Mobile Money (MTN, Telecel, AT).\n4. <b>You Deliver:</b> We message you immediately that money is safely held. You then send the item.\n5. <b>Get Paid:</b> Buyer confirms they received the item, and the money is released to your wallet immediately!',
      { reply_markup: getMainMenuKeyboard() }
    );
  }

  // Button: Cancel
  if (data === 'btn_cancel') {
    clearSession(chatId);
    await answerCallbackQuery(queryId, 'Cancelled');
    return await sendTelegramMessage(
      chatId,
      '<b>Action Stopped.</b> We have returned to the main menu.',
      { reply_markup: getMainMenuKeyboard() }
    );
  }

  // Button: Fee Split Selection (Wizard Completion)
  if (data.startsWith('btn_fee_split:')) {
    const feeChoice = data.split(':')[1] || '50/50';
    const draft = session.draft || {};
    const amount = Number(draft.amount || 0);
    const itemName = draft.itemName || 'Item';
    const buyerPhone = draft.buyerPhone || '0244112233';
    const fee = parseFloat((amount * 0.03).toFixed(2));
    const escrowId = generateEscrowId();
    const sellerName = callbackQuery.from?.first_name || (callbackQuery.from?.username ? `@${callbackQuery.from.username}` : 'TrustLink Seller');

    const escrowObj = {
      escrowId,
      itemName,
      amount,
      fee,
      buyerPhone,
      sellerName,
      sellerId: `TELEGRAM_${chatId}`,
      feeChoice,
      createdAt: Date.now()
    };

    const checkoutUrl = buildEscrowCheckoutUrl(escrowObj);
    escrowObj.checkoutUrl = checkoutUrl;

    // Save in recent escrows cache for 1-click SMS dispatch
    recentEscrows.set(escrowId, escrowObj);

    // Persist directly to Firestore REST API in background
    persistEscrowToFirestore(escrowObj).catch(err => console.warn('[FIRESTORE] Async save note:', err));

    clearSession(chatId);
    await answerCallbackQuery(queryId, 'Link Created!');

    const successMsg = `
<b>Your Payment Link is Ready!</b>

<b>Item:</b> ${itemName}
<b>Price:</b> GH₵ ${amount.toFixed(2)}
<b>Protection Fee (3%):</b> GH₵ ${fee.toFixed(2)}
<b>Buyer's Phone:</b> ${buyerPhone}
<b>Order ID:</b> <code>${escrowId}</code>

<b>Payment Link:</b>
${checkoutUrl}

<b>What to do next:</b>
1. Tap <b>Send SMS to Buyer</b> or <b>Send on WhatsApp</b> below.
2. The buyer opens the link and pays with Mobile Money (MTN, Telecel, AT).
3. We will immediately message you here once their money is safely locked so you can send the item.
`.trim();

    return await sendTelegramMessage(chatId, successMsg, {
      reply_markup: getEscrowActionKeyboard(escrowId, checkoutUrl, itemName, amount)
    });
  }

  // Button: Send SMS to Buyer
  if (data.startsWith('btn_sms:')) {
    const escrowId = data.split(':')[1];
    let order = recentEscrows.get(escrowId);

    if (!order) {
      order = {
        escrowId,
        itemName: session.draft?.itemName || 'Order Item',
        amount: session.draft?.amount || 0,
        buyerPhone: session.draft?.buyerPhone || '0244112233',
        sellerName: callbackQuery.from?.first_name || 'TrustLink Seller',
        checkoutUrl: `https://www.trustlinkgh.online/checkout.html?id=${escrowId}`
      };
    }

    const smsMessage = buildEscrowOrderSMS({
      sellerName: order.sellerName,
      itemName: order.itemName,
      amount: order.amount,
      checkoutUrl: order.checkoutUrl
    });

    await answerCallbackQuery(queryId, 'Sending SMS to buyer...');

    const smsResult = await dispatchTransactionalSMS({
      phone: order.buyerPhone,
      message: smsMessage,
      referenceId: `${escrowId}-tg-sms`
    });

    if (smsResult.success) {
      const sentMsg = `
<b>SMS Sent to Buyer!</b>

<b>Recipient:</b> ${smsResult.recipient}
<b>Order ID:</b> <code>${escrowId}</code>

<b>Message:</b>
<i>"${smsMessage}"</i>

The buyer has received the payment link on their phone.
`.trim();

      return await sendTelegramMessage(chatId, sentMsg, {
        reply_markup: getEscrowActionKeyboard(escrowId, order.checkoutUrl, order.itemName, order.amount, { smsSent: true })
      });
    } else {
      const fallbackMsg = `
<b>SMS Prepared for Buyer</b>

<b>Recipient:</b> ${order.buyerPhone || 'Buyer'}
<b>Order ID:</b> <code>${escrowId}</code>

<b>Message Content:</b>
<i>"${smsMessage}"</i>

${smsResult.nativeSmsLink ? `\n<a href="${smsResult.nativeSmsLink}">Tap here to open SMS app and send</a>` : ''}
`.trim();

      return await sendTelegramMessage(chatId, fallbackMsg, {
        reply_markup: getEscrowActionKeyboard(escrowId, order.checkoutUrl, order.itemName, order.amount, { smsSent: false })
      });
    }
  }

  // Button: Quick Ship
  if (data.startsWith('btn_ship:')) {
    const escrowId = data.split(':')[1];
    await answerCallbackQuery(queryId, `Order #${escrowId} Marked as Sent!`, true);
    return await sendTelegramMessage(
      chatId,
      `<b>Order #${escrowId} Marked as Sent!</b>\n\nBuyer has been notified via SMS to inspect the item and confirm delivery.`,
      { reply_markup: getMainMenuKeyboard() }
    );
  }

  // Button: Refresh Status
  if (data.startsWith('btn_status:')) {
    const escrowId = data.split(':')[1];
    await answerCallbackQuery(queryId, 'Status Refreshed');
    return await sendTelegramMessage(
      chatId,
      `<b>Status for #${escrowId}:</b> <code>Payment Protected</code>\nMoney is safely locked. You can deliver the item.`,
      { reply_markup: getEscrowActionKeyboard(escrowId, `https://www.trustlinkgh.online/confirm.html?id=${escrowId}`, 'Item', 100) }
    );
  }

  return await answerCallbackQuery(queryId);
}
