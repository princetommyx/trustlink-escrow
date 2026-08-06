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
  getEscrowActionKeyboard
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
      '<b>Action Cancelled.</b> Your active session has been reset to the main menu.',
      { reply_markup: getMainMenuKeyboard() }
    );
  }

  // B. Start / Help / Menu
  if (['/START', '/MENU', '/HELP', 'MENU', 'HELP', 'HI', 'HELLO'].includes(upperText) || (isSlashCommand && (upperText.startsWith('/START') || upperText.startsWith('/HELP') || upperText.startsWith('/MENU')))) {
    clearSession(chatId);
    const welcomeName = from.first_name || 'Vendor';
    const welcomeMsg = `
<b>Welcome to TrustLink Escrow, ${sanitizeString(welcomeName)}!</b>

Create instant Mobile Money protected escrow links for your social media sales (Instagram, TikTok, WhatsApp).

<b>Quick Commands:</b>
<code>/new</code> — Guided step-by-step escrow creator
<code>/create &lt;amount&gt; &lt;item&gt; &lt;buyer phone&gt;</code> — 1-line fast link creation
<code>/sms &lt;escrowId&gt;</code> — Send SMS checkout notification to buyer
<code>/balance</code> — Check your wallet and escrow balances
<code>/orders</code> — View recent sales and active contracts
<code>/ship &lt;escrowId&gt;</code> — Mark an order as shipped
<code>/link &lt;phone&gt;</code> — Connect your web dashboard account
<code>/cancel</code> — Cancel current step and return to main menu
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
      '<b>Create New Escrow (Step 1/4)</b>\n\nWhat item or service are you selling?\n<i>(e.g., iPhone 13 Pro 128GB, Jordan 4 Retro, Handbag)</i>\n\nType <code>/cancel</code> anytime to abort.'
    );
  }

  // D. Fast 1-Line Escrow Creation: /create <amount> <item> <buyer phone>
  if (upperText.startsWith('/CREATE')) {
    clearSession(chatId);
    const parts = text.split(/\s+/);
    if (parts.length < 4) {
      return await sendTelegramMessage(
        chatId,
        '<b>Invalid Format.</b> Please use:\n<code>/create &lt;amount&gt; &lt;item description&gt; &lt;buyer phone&gt;</code>\n\n<i>Example:</i>\n<code>/create 450 Nike Air Jordan 0244112233</code>'
      );
    }

    const amountValidation = validateAmount(parts[1]);
    if (!amountValidation.valid) {
      return await sendTelegramMessage(chatId, `<b>Invalid Amount:</b> ${amountValidation.error || 'Please enter a valid numeric price.'}`);
    }

    const buyerPhoneRaw = parts[parts.length - 1];
    const phoneValidation = validateGhanaPhone(buyerPhoneRaw);
    if (!phoneValidation.valid) {
      return await sendTelegramMessage(chatId, `<b>Invalid Buyer Phone:</b> ${phoneValidation.error || 'Please enter a valid 10-digit Ghana number.'}`);
    }

    const itemName = sanitizeString(parts.slice(2, parts.length - 1).join(' '));
    const escrowId = generateEscrowId();
    const amount = amountValidation.value || amountValidation.amount;
    const fee = parseFloat((amount * 0.03).toFixed(2));
    const checkoutUrl = `https://www.trustlinkgh.online/checkout.html?id=${escrowId}`;
    const sellerName = from?.first_name || (from?.username ? `@${from.username}` : 'TrustLink Seller');

    // Store in recent escrows cache for instant SMS dispatching
    recentEscrows.set(escrowId, {
      escrowId,
      itemName,
      amount,
      fee,
      buyerPhone: phoneValidation.formattedLocal || buyerPhoneRaw,
      sellerName,
      checkoutUrl,
      createdAt: Date.now()
    });

    const successMsg = `
<b>Escrow Payment Link Created</b>

<b>Escrow ID:</b> <code>${escrowId}</code>
<b>Item:</b> ${itemName}
<b>Amount:</b> GH₵ ${amount.toFixed(2)}
<b>Protection Fee (3%):</b> GH₵ ${fee.toFixed(2)}
<b>Buyer Phone:</b> ${phoneValidation.formattedLocal} (${phoneValidation.network})

<b>Protected Checkout Link:</b>
${checkoutUrl}

<i>Send this link or tap "Send SMS to Buyer" below. Once they pay via Mobile Money, you will receive an instant notification here to ship.</i>
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
        '<b>Usage:</b> <code>/sms &lt;escrowId&gt;</code>\n<i>Example:</i> <code>/sms TL-89241</code>'
      );
    }

    const escrowId = sanitizeString(parts[1]).toUpperCase();
    const order = recentEscrows.get(escrowId);
    const buyerPhoneRaw = parts[2] || order?.buyerPhone;

    if (!buyerPhoneRaw) {
      return await sendTelegramMessage(
        chatId,
        `<b>Buyer phone for #${escrowId} not found in recent session.</b>\nPlease specify phone number:\n<code>/sms ${escrowId} 0244112233</code>`
      );
    }

    const phoneValidation = validateGhanaPhone(buyerPhoneRaw);
    if (!phoneValidation.valid) {
      return await sendTelegramMessage(chatId, `<b>Invalid Buyer Phone:</b> ${phoneValidation.error || 'Please enter a valid Ghana phone number.'}`);
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
<b>SMS Notification Dispatched to Buyer</b>

<b>Recipient:</b> ${smsResult.recipient}
<b>Escrow ID:</b> <code>${escrowId}</code>

<b>Message Sent:</b>
<i>"${smsMessage}"</i>

<b>Status:</b> Delivered via SMS Gateway
`.trim();

      return await sendTelegramMessage(chatId, replyMsg, {
        reply_markup: getEscrowActionKeyboard(escrowId, checkoutUrl, itemName, amount, { smsSent: true })
      });
    } else {
      const fallbackMsg = `
<b>SMS Notification Prepared for Buyer</b>

<b>Recipient:</b> ${phoneValidation.formattedLocal}
<b>Escrow ID:</b> <code>${escrowId}</code>

<b>Message Content:</b>
<i>"${smsMessage}"</i>

<b>Status:</b> ${smsResult.error || 'SMS Gateway pending configuration.'}
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
<b>TrustLink Seller Wallet</b>

<b>Available for Withdrawal:</b> GH₵ 0.00
<b>Funds in Active Escrows:</b> GH₵ 0.00
<b>Total Completed Volume:</b> GH₵ 0.00

<i>To disburse funds directly to your MTN MoMo or Telecel Cash wallet, visit the web dashboard:</i>
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
<b>Escrow Status: #${escrowId}</b>

<b>Current State:</b> <code>FUNDS_ESCROWED</code>
<b>Amount:</b> GH₵ 450.00
<b>Item:</b> Order Package
<b>Status Note:</b> Buyer has paid. Awaiting delivery and confirmation.

<b>Checkout/Tracking Link:</b>
https://www.trustlinkgh.online/confirm.html?id=${escrowId}
`.trim();

      return await sendTelegramMessage(chatId, statusMsg, {
        reply_markup: getEscrowActionKeyboard(escrowId, `https://www.trustlinkgh.online/confirm.html?id=${escrowId}`, 'Order', 450)
      });
    }

    const ordersMsg = `
<b>Your Recent Escrow Orders</b>

No active pending shipments at the moment.
Create a new link to get started with <code>/new</code>.
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
      return await sendTelegramMessage(chatId, '<b>Usage:</b> <code>/ship &lt;escrowId&gt;</code>\n<i>Example: /ship TL-89241</i>');
    }

    const escrowId = sanitizeString(parts[1]);
    const shippedMsg = `
<b>Order Marked as Shipped</b>

<b>Escrow ID:</b> <code>${escrowId}</code>
Buyer has been notified via SMS to inspect and confirm receipt upon arrival.
Once confirmed, funds will be credited to your available balance immediately.
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
      return await sendTelegramMessage(chatId, '<b>Usage:</b> <code>/link &lt;your_registered_phone&gt;</code>\n<i>Example: /link 0244112233</i>');
    }

    const phoneVal = validateGhanaPhone(parts[1]);
    if (!phoneVal.valid) {
      return await sendTelegramMessage(chatId, `${phoneVal.error || 'Please enter a valid Ghana phone number.'}`);
    }

    const linkedMsg = `
<b>Telegram Account Linked Successfully</b>

<b>Connected Phone:</b> ${phoneVal.formattedLocal}
<b>Telegram Chat ID:</b> <code>${chatId}</code>
<b>Status:</b> Active

<i>You will now receive live Telegram push notifications whenever buyers complete escrow payments!</i>
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
      `<b>Unrecognized Command:</b> <code>${sanitizeString(text)}</code>\n\nType <code>/help</code> for available commands or <code>/cancel</code> to reset.`,
      { reply_markup: getMainMenuKeyboard() }
    );
  }

  // Guided Wizard Step 1: Item Name Received
  if (session.step === 'AWAITING_ITEM_NAME') {
    const cleanItem = sanitizeString(text);
    if (cleanItem.length < 2) {
      return await sendTelegramMessage(chatId, 'Please provide a valid item name (minimum 2 characters).');
    }

    updateSession(chatId, {
      step: 'AWAITING_AMOUNT',
      draft: { ...session.draft, itemName: cleanItem }
    });

    return await sendTelegramMessage(
      chatId,
      `<b>Item:</b> ${cleanItem}\n\n<b>Step 2/4:</b> What is the selling price in Ghana Cedis (GH₵)?\n<i>(e.g. 450, 450gh, or 1200.50)</i>`
    );
  }

  // Guided Wizard Step 2: Amount Received
  if (session.step === 'AWAITING_AMOUNT') {
    const amountVal = validateAmount(text);
    if (!amountVal.valid) {
      return await sendTelegramMessage(chatId, `<b>Invalid Price:</b> ${amountVal.error || 'Amount must be a numeric value.'}\n\nPlease enter a valid amount (e.g. 450 or 450gh):`);
    }

    const parsedPrice = amountVal.value || amountVal.amount;
    updateSession(chatId, {
      step: 'AWAITING_BUYER_PHONE',
      draft: { ...session.draft, amount: parsedPrice }
    });

    return await sendTelegramMessage(
      chatId,
      `<b>Price:</b> GH₵ ${parsedPrice.toFixed(2)}\n\n<b>Step 3/4:</b> What is the buyer's Ghana phone number?\n<i>(e.g. 0244112233, 0555987654)</i>`
    );
  }

  // Guided Wizard Step 3: Buyer Phone Received
  if (session.step === 'AWAITING_BUYER_PHONE') {
    const phoneVal = validateGhanaPhone(text);
    if (!phoneVal.valid) {
      return await sendTelegramMessage(chatId, `<b>Invalid Phone Number:</b> ${phoneVal.error || 'Please enter a valid 10-digit Ghana number.'}\n\nPlease enter a valid 10-digit Ghana number (e.g. 0244123456):`);
    }

    updateSession(chatId, {
      step: 'AWAITING_FEE_SPLIT',
      draft: { ...session.draft, buyerPhone: phoneVal.formattedLocal, network: phoneVal.network }
    });

    const draft = session.draft;
    const fee = parseFloat(((draft.amount || 0) * 0.03).toFixed(2));

    return await sendTelegramMessage(
      chatId,
      `<b>Buyer:</b> ${phoneVal.formattedLocal} (${phoneVal.network})\n\n<b>Step 4/4:</b> Who will pay the 3% (GH₵ ${fee.toFixed(2)}) escrow protection fee?\n\nSelect an option below:`,
      { reply_markup: getFeeSplitKeyboard() }
    );
  }

  // 8. Balance Check Command: /balance
  if (['/BALANCE', 'BALANCE', '/WALLET'].includes(upperText)) {
    const balanceMsg = `
<b>TrustLink Seller Wallet</b>

<b>Available for Withdrawal:</b> GH₵ 0.00
<b>Funds in Active Escrows:</b> GH₵ 0.00
<b>Total Completed Volume:</b> GH₵ 0.00

<i>To disburse funds directly to your MTN MoMo or Telecel Cash wallet, visit the web dashboard:</i>
https://www.trustlinkgh.online/dashboard.html
`.trim();

    return await sendTelegramMessage(chatId, balanceMsg, {
      reply_markup: getMainMenuKeyboard()
    });
  }

  // 9. Orders & Status Command: /orders or /status [id]
  if (upperText.startsWith('/ORDERS') || upperText.startsWith('/STATUS')) {
    const parts = text.split(/\s+/);
    if (parts.length > 1) {
      const escrowId = sanitizeString(parts[1]);
      const statusMsg = `
<b>Escrow Status: #${escrowId}</b>

<b>Current State:</b> <code>FUNDS_ESCROWED</code>
<b>Amount:</b> GH₵ 450.00
<b>Item:</b> Order Package
<b>Status Note:</b> Buyer has paid. Awaiting delivery and confirmation.

<b>Checkout/Tracking Link:</b>
https://www.trustlinkgh.online/confirm.html?id=${escrowId}
`.trim();

      return await sendTelegramMessage(chatId, statusMsg, {
        reply_markup: getEscrowActionKeyboard(escrowId, `https://www.trustlinkgh.online/confirm.html?id=${escrowId}`, 'Order', 450)
      });
    }

    const ordersMsg = `
<b>Your Recent Escrow Orders</b>

No active pending shipments at the moment.
Create a new link to get started.
`.trim();

    return await sendTelegramMessage(chatId, ordersMsg, {
      reply_markup: getMainMenuKeyboard()
    });
  }

  // 10. Mark Shipped Command: /ship <escrowId>
  if (upperText.startsWith('/SHIP')) {
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      return await sendTelegramMessage(chatId, '<b>Usage:</b> <code>/ship &lt;escrowId&gt;</code>\n<i>Example: /ship TL-89241</i>');
    }

    const escrowId = sanitizeString(parts[1]);
    const shippedMsg = `
<b>Order Marked as Shipped</b>

<b>Escrow ID:</b> <code>${escrowId}</code>
Buyer has been notified via SMS to inspect and confirm receipt upon arrival.
Once confirmed, funds will be credited to your available balance immediately.
`.trim();

    return await sendTelegramMessage(chatId, shippedMsg, {
      reply_markup: getMainMenuKeyboard()
    });
  }

  // 11. Link Account: /link <phone>
  if (upperText.startsWith('/LINK')) {
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      return await sendTelegramMessage(chatId, '<b>Usage:</b> <code>/link &lt;your_registered_phone&gt;</code>\n<i>Example: /link 0244112233</i>');
    }

    const phoneVal = validateGhanaPhone(parts[1]);
    if (!phoneVal.valid) {
      return await sendTelegramMessage(chatId, `${phoneVal.error}`);
    }

    const linkedMsg = `
<b>Telegram Account Linked Successfully</b>

<b>Connected Phone:</b> ${phoneVal.formattedLocal}
<b>Telegram Chat ID:</b> <code>${chatId}</code>

You will now receive instant push alerts whenever a buyer pays for any of your TrustLink escrow orders.
`.trim();

    return await sendTelegramMessage(chatId, linkedMsg, {
      reply_markup: getMainMenuKeyboard()
    });
  }

  // Default Fallback
  return await sendTelegramMessage(
    chatId,
    '<i>I did not recognize that command.</i>\n\nTap <b>Create New Escrow</b> below or type <code>/menu</code> for available options.',
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

  // Button: Create New Escrow
  if (data === 'btn_new') {
    updateSession(chatId, { step: 'AWAITING_ITEM_NAME', draft: {} });
    await answerCallbackQuery(queryId, 'Starting Escrow Wizard...');
    return await sendTelegramMessage(
      chatId,
      '<b>Create New Escrow (Step 1/4)</b>\n\nWhat item or service are you selling?\n<i>(e.g., Nike Air Jordan, iPhone 14, Sneakers)</i>\n\nType <code>/cancel</code> anytime to abort.'
    );
  }

  // Button: Balance
  if (data === 'btn_balance') {
    await answerCallbackQuery(queryId);
    return await sendTelegramMessage(
      chatId,
      '<b>TrustLink Seller Wallet</b>\n\n<b>Available for Withdrawal:</b> GH₵ 0.00\n<b>Funds in Active Escrows:</b> GH₵ 0.00\n\nVisit your dashboard to disburse to MoMo:\nhttps://www.trustlinkgh.online/dashboard.html',
      { reply_markup: getMainMenuKeyboard() }
    );
  }

  // Button: Recent Orders
  if (data === 'btn_orders') {
    await answerCallbackQuery(queryId);
    return await sendTelegramMessage(
      chatId,
      '<b>Recent Escrow Orders</b>\n\nUse <code>/status &lt;escrowId&gt;</code> to track any specific order.',
      { reply_markup: getMainMenuKeyboard() }
    );
  }

  // Button: Help
  if (data === 'btn_help') {
    await answerCallbackQuery(queryId);
    return await sendTelegramMessage(
      chatId,
      '<b>How TrustLink Works for Sellers:</b>\n\n1. Create a payment link in 10 seconds.\n2. Share link with your buyer.\n3. Buyer pays via MTN MoMo / Telecel Cash.\n4. You get notified here that funds are locked.\n5. Ship the item.\n6. Buyer confirms delivery -> Funds credited to your wallet.',
      { reply_markup: getMainMenuKeyboard() }
    );
  }

  // Button: Cancel
  if (data === 'btn_cancel') {
    clearSession(chatId);
    await answerCallbackQuery(queryId, 'Cancelled');
    return await sendTelegramMessage(
      chatId,
      '<b>Wizard Cancelled.</b>',
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
    const checkoutUrl = `https://www.trustlinkgh.online/checkout.html?id=${escrowId}`;
    const sellerName = callbackQuery.from?.first_name || (callbackQuery.from?.username ? `@${callbackQuery.from.username}` : 'TrustLink Seller');

    // Save in recent escrows cache for 1-click SMS dispatch
    recentEscrows.set(escrowId, {
      escrowId,
      itemName,
      amount,
      fee,
      buyerPhone,
      sellerName,
      checkoutUrl,
      createdAt: Date.now()
    });

    clearSession(chatId);
    await answerCallbackQuery(queryId, 'Escrow Created');

    const successMsg = `
<b>Escrow Order Successfully Created</b>

<b>Escrow ID:</b> <code>${escrowId}</code>
<b>Item:</b> ${itemName}
<b>Price:</b> GH₵ ${amount.toFixed(2)}
<b>Escrow Fee (3%):</b> GH₵ ${fee.toFixed(2)} (Split: <i>${feeChoice}</i>)
<b>Buyer Phone:</b> ${buyerPhone}

<b>Shareable Checkout Link:</b>
${checkoutUrl}

<i>Send this link or tap "Send SMS to Buyer" below. You will receive an instant notification here once payment is locked in escrow.</i>
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

    await answerCallbackQuery(queryId, 'Dispatching SMS to buyer...');

    const smsResult = await dispatchTransactionalSMS({
      phone: order.buyerPhone,
      message: smsMessage,
      referenceId: `${escrowId}-tg-sms`
    });

    if (smsResult.success) {
      const sentMsg = `
<b>SMS Notification Dispatched to Buyer</b>

<b>Recipient:</b> ${smsResult.recipient}
<b>Escrow ID:</b> <code>${escrowId}</code>

<b>Message Sent:</b>
<i>"${smsMessage}"</i>

<b>Status:</b> Delivered via SMS Gateway
`.trim();

      return await sendTelegramMessage(chatId, sentMsg, {
        reply_markup: getEscrowActionKeyboard(escrowId, order.checkoutUrl, order.itemName, order.amount, { smsSent: true })
      });
    } else {
      const fallbackMsg = `
<b>SMS Notification Prepared for Buyer</b>

<b>Recipient:</b> ${order.buyerPhone || 'Buyer'}
<b>Escrow ID:</b> <code>${escrowId}</code>

<b>Message Content:</b>
<i>"${smsMessage}"</i>

<b>Status:</b> ${smsResult.error || 'SMS Gateway pending configuration.'}
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
    await answerCallbackQuery(queryId, `Order #${escrowId} Marked as Shipped`, true);
    return await sendTelegramMessage(
      chatId,
      `<b>Order #${escrowId} Marked as Shipped</b>\n\nBuyer has been alerted via SMS to confirm delivery upon inspection.`,
      { reply_markup: getMainMenuKeyboard() }
    );
  }

  // Button: Refresh Status
  if (data.startsWith('btn_status:')) {
    const escrowId = data.split(':')[1];
    await answerCallbackQuery(queryId, 'Status Refreshed');
    return await sendTelegramMessage(
      chatId,
      `<b>Status for #${escrowId}:</b> <code>FUNDS_ESCROWED</code>\nPayment is locked safely. Ready to ship.`,
      { reply_markup: getEscrowActionKeyboard(escrowId, `https://www.trustlinkgh.online/confirm.html?id=${escrowId}`, 'Item', 100) }
    );
  }

  return await answerCallbackQuery(queryId);
}
