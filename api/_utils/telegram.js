/**
 * Telegram Bot API Dispatcher & Formatting Utility
 * Provides helpers for sending clean, professional HTML messages, inline keyboards,
 * answering callback queries, and sending transactional escrow push notifications.
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * Get active bot token from environment
 */
export function getTelegramBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN || '';
}

/**
 * Send a message via Telegram Bot API
 * @param {string|number} chatId - Telegram chat ID
 * @param {string} text - Message text (HTML formatted)
 * @param {object} [options] - Additional Telegram options (reply_markup, parse_mode, etc.)
 */
export async function sendTelegramMessage(chatId, text, options = {}) {
  const token = getTelegramBotToken();
  if (!token) {
    console.warn('[TELEGRAM] Warning: TELEGRAM_BOT_TOKEN is not configured in environment variables.');
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN_MISSING' };
  }

  const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: options.parse_mode || 'HTML',
    disable_web_page_preview: options.disable_web_page_preview ?? false,
    ...options
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    return data;
  } catch (err) {
    console.error('[TELEGRAM] Failed to send message:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Answer an inline button callback query
 */
export async function answerCallbackQuery(callbackQueryId, text = '', showAlert = false) {
  const token = getTelegramBotToken();
  if (!token) return { ok: false };

  const url = `${TELEGRAM_API_BASE}/bot${token}/answerCallbackQuery`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text,
        show_alert: showAlert
      })
    });
    return await res.json();
  } catch (err) {
    console.error('[TELEGRAM] Failed to answer callback query:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Returns the Main Menu Inline Keyboard
 */
export function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Create Payment Link', callback_data: 'btn_new' },
        { text: 'My Money / Balance', callback_data: 'btn_balance' }
      ],
      [
        { text: 'My Orders', callback_data: 'btn_orders' },
        { text: 'How It Works', callback_data: 'btn_help' }
      ],
      [
        { text: 'Open Web Dashboard', url: 'https://www.trustlinkgh.online/dashboard.html' }
      ]
    ]
  };
}

/**
 * Returns the Fee Split Inline Keyboard for Escrow Creation Wizard
 */
export function getFeeSplitKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Split 50/50 (Both pay half)', callback_data: 'btn_fee_split:50/50' }
      ],
      [
        { text: 'Buyer pays the fee (3%)', callback_data: 'btn_fee_split:buyer' }
      ],
      [
        { text: 'I will pay the fee (3%)', callback_data: 'btn_fee_split:seller' }
      ],
      [
        { text: 'Cancel', callback_data: 'btn_cancel' }
      ]
    ]
  };
}

/**
 * Constructs a rich checkout URL that includes order parameters for instant fallback loading
 */
export function buildEscrowCheckoutUrl(escrow) {
  const base = 'https://www.trustlinkgh.online/checkout.html';
  const escrowId = escrow.escrowId || escrow.id || '';
  const params = new URLSearchParams();
  params.set('id', escrowId);
  if (escrow.amount) params.set('amount', Number(escrow.amount).toFixed(2));
  if (escrow.itemName || escrow.description) params.set('item', escrow.itemName || escrow.description);
  if (escrow.sellerName) params.set('seller', escrow.sellerName);
  if (escrow.buyerPhone) params.set('buyer', escrow.buyerPhone);
  if (escrow.feeChoice || escrow.feeAllocation) params.set('split', escrow.feeChoice || escrow.feeAllocation || 'split');
  return `${base}?${params.toString()}`;
}

/**
 * Persists an escrow directly to Firestore REST API in the background
 */
export async function persistEscrowToFirestore(escrow) {
  try {
    const escrowId = escrow.escrowId || escrow.id;
    if (!escrowId) return { ok: false };
    const apiKey = 'AIzaSyA2kBaKsu5WtboFBmOWJTLzESkbh776ij0';
    const projectId = 'trustlink-escrow';
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/escrows/${escrowId}?key=${apiKey}`;
    
    const amount = Number(escrow.amount || 0);
    const body = {
      fields: {
        amount: { doubleValue: amount },
        totalAmount: { doubleValue: amount },
        description: { stringValue: String(escrow.itemName || escrow.description || 'Escrow Order') },
        sellerName: { stringValue: String(escrow.sellerName || 'TrustLink Seller') },
        sellerId: { stringValue: String(escrow.sellerId || 'TELEGRAM_BOT') },
        buyerPhone: { stringValue: String(escrow.buyerPhone || '') },
        feeAllocation: { stringValue: String(escrow.feeChoice || escrow.feeAllocation || 'split') },
        feePercent: { doubleValue: 3.0 },
        status: { stringValue: 'PENDING_PAYMENT' },
        source: { stringValue: 'TELEGRAM_BOT' },
        createdAt: { timestampValue: new Date().toISOString() }
      }
    };

    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch (err) {
    console.warn('[FIRESTORE] Background escrow save warning:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Fetches an escrow record directly from Firestore REST API
 */
export async function getEscrowFromFirestore(escrowId) {
  try {
    if (!escrowId) return null;
    const apiKey = 'AIzaSyA2kBaKsu5WtboFBmOWJTLzESkbh776ij0';
    const projectId = 'trustlink-escrow';
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/escrows/${escrowId}?key=${apiKey}`;

    const res = await fetch(url);
    if (!res.ok) return null;
    const doc = await res.json();
    if (!doc || !doc.fields) return null;

    const parseField = (f) => {
      if (!f) return null;
      if (f.stringValue !== undefined) return f.stringValue;
      if (f.integerValue !== undefined) return parseInt(f.integerValue, 10);
      if (f.doubleValue !== undefined) return parseFloat(f.doubleValue);
      if (f.booleanValue !== undefined) return f.booleanValue;
      if (f.timestampValue !== undefined) return f.timestampValue;
      return null;
    };

    return {
      id: escrowId,
      escrowId: escrowId,
      status: parseField(doc.fields.status) || 'PENDING_PAYMENT',
      amount: parseField(doc.fields.amount) || parseField(doc.fields.totalAmount) || 0,
      totalAmount: parseField(doc.fields.totalAmount) || parseField(doc.fields.amount) || 0,
      description: parseField(doc.fields.description) || parseField(doc.fields.itemName) || 'Item',
      itemName: parseField(doc.fields.description) || parseField(doc.fields.itemName) || 'Item',
      buyerPhone: parseField(doc.fields.buyerPhone) || '',
      sellerName: parseField(doc.fields.sellerName) || 'Seller',
      sellerId: parseField(doc.fields.sellerId) || '',
      feeAllocation: parseField(doc.fields.feeAllocation) || 'split',
      createdAt: parseField(doc.fields.createdAt) || null
    };
  } catch (err) {
    console.warn('[FIRESTORE] Fetch escrow warning:', err.message);
    return null;
  }
}

/**
 * Updates specific fields on an escrow document in Firestore REST API
 */
export async function updateEscrowInFirestore(escrowId, fieldsToUpdate = {}) {
  try {
    if (!escrowId) return { ok: false };
    const apiKey = 'AIzaSyA2kBaKsu5WtboFBmOWJTLzESkbh776ij0';
    const projectId = 'trustlink-escrow';

    const fieldPaths = Object.keys(fieldsToUpdate).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/escrows/${escrowId}?${fieldPaths}&key=${apiKey}`;

    const formattedFields = {};
    for (const [key, val] of Object.entries(fieldsToUpdate)) {
      if (typeof val === 'number') {
        formattedFields[key] = { doubleValue: val };
      } else if (typeof val === 'boolean') {
        formattedFields[key] = { booleanValue: val };
      } else if (key.endsWith('At') && typeof val === 'string' && val.includes('T')) {
        formattedFields[key] = { timestampValue: val };
      } else {
        formattedFields[key] = { stringValue: String(val) };
      }
    }

    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: formattedFields })
    });

    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch (err) {
    console.warn('[FIRESTORE] Update escrow warning:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Fetches a user's Telegram session from Firestore REST API
 */
export async function getTelegramSessionFromFirestore(chatId) {
  try {
    if (!chatId) return null;
    const apiKey = 'AIzaSyA2kBaKsu5WtboFBmOWJTLzESkbh776ij0';
    const projectId = 'trustlink-escrow';
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/telegram_sessions/${chatId}?key=${apiKey}`;

    const res = await fetch(url);
    if (!res.ok) return null;
    const doc = await res.json();
    if (!doc || !doc.fields) return null;

    const step = doc.fields.step?.stringValue || 'IDLE';
    let draft = {};
    if (doc.fields.draftJson?.stringValue) {
      try { draft = JSON.parse(doc.fields.draftJson.stringValue); } catch (_) {}
    }

    return {
      step,
      draft,
      lastUpdated: doc.fields.lastUpdated?.integerValue ? parseInt(doc.fields.lastUpdated.integerValue, 10) : Date.now()
    };
  } catch (err) {
    return null;
  }
}

/**
 * Saves a user's Telegram session to Firestore REST API
 */
export async function saveTelegramSessionToFirestore(chatId, session) {
  try {
    if (!chatId) return { ok: false };
    const apiKey = 'AIzaSyA2kBaKsu5WtboFBmOWJTLzESkbh776ij0';
    const projectId = 'trustlink-escrow';
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/telegram_sessions/${chatId}?key=${apiKey}`;

    const body = {
      fields: {
        step: { stringValue: session.step || 'IDLE' },
        draftJson: { stringValue: JSON.stringify(session.draft || {}) },
        lastUpdated: { integerValue: String(Date.now()) }
      }
    };

    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { ok: res.ok };
  } catch (err) {
    return { ok: false };
  }
}

/**
 * Deletes/clears a user's Telegram session from Firestore
 */
export async function clearTelegramSessionInFirestore(chatId) {
  try {
    if (!chatId) return { ok: false };
    const apiKey = 'AIzaSyA2kBaKsu5WtboFBmOWJTLzESkbh776ij0';
    const projectId = 'trustlink-escrow';
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/telegram_sessions/${chatId}?key=${apiKey}`;

    await fetch(url, { method: 'DELETE' });
    return { ok: true };
  } catch (err) {
    return { ok: false };
  }
}

/**
 * Formats a clean, user-friendly status message based on actual escrow state
 */
export function formatEscrowStatusMessage(order) {
  const escrowId = order.id || order.escrowId || 'N/A';
  const amount = Number(order.amount || order.totalAmount || 0).toFixed(2);
  const itemName = order.itemName || order.description || 'Order Item';
  const buyerPhone = order.buyerPhone || 'Buyer';
  const rawStatus = (order.status || 'PENDING_PAYMENT').toUpperCase();

  if (['PENDING_PAYMENT', 'AWAITING_PAYMENT', 'CREATED', 'PENDING'].includes(rawStatus)) {
    return {
      status: 'PENDING_PAYMENT',
      text: `
<b>Status for #${escrowId}:</b> ⏳ <b>Waiting for Buyer to Pay</b>

<b>Item:</b> ${itemName}
<b>Amount:</b> GH₵ ${amount}
<b>Buyer:</b> ${buyerPhone}

❌ <b>Payment has NOT been made yet.</b>
The buyer has not sent the money yet.

⚠️ <b>Important:</b> Do NOT deliver or send the item until the money is safely held. We will send you an instant message here the moment the buyer pays.
`.trim()
    };
  }

  if (['FUNDS_ESCROWED', 'FUNDED', 'PAID', 'PAYMENT_PROTECTED'].includes(rawStatus)) {
    return {
      status: 'FUNDS_ESCROWED',
      text: `
<b>Status for #${escrowId}:</b> 🔒 <b>Money Safely Locked!</b>

<b>Item:</b> ${itemName}
<b>Amount:</b> GH₵ ${amount}
<b>Buyer:</b> ${buyerPhone}

✅ <b>The buyer has paid GH₵ ${amount}!</b>
The money is now safely held in TrustLink Escrow.

📦 <b>You can now deliver or send the item</b> to the buyer. After sending, tap <b>I Have Sent the Item</b> below so we can notify the buyer to confirm delivery.
`.trim()
    };
  }

  if (['ITEM_SHIPPED', 'DISPATCHED', 'SHIPPED'].includes(rawStatus)) {
    return {
      status: 'ITEM_SHIPPED',
      text: `
<b>Status for #${escrowId}:</b> 🚚 <b>Item Sent (In Transit)</b>

<b>Item:</b> ${itemName}
<b>Amount:</b> GH₵ ${amount}
<b>Buyer:</b> ${buyerPhone}

You marked this item as sent. We notified the buyer to inspect the package and confirm delivery. Once they confirm, the funds will be released to your wallet immediately.
`.trim()
    };
  }

  if (['COMPLETED', 'CONFIRMED', 'RELEASED'].includes(rawStatus)) {
    return {
      status: 'COMPLETED',
      text: `
<b>Status for #${escrowId}:</b> 🎉 <b>Order Completed!</b>

<b>Item:</b> ${itemName}
<b>Amount:</b> GH₵ ${amount}

The buyer confirmed receipt and the payment has been released to your wallet.
`.trim()
    };
  }

  if (['DISPUTED', 'DISPUTE'].includes(rawStatus)) {
    return {
      status: 'DISPUTED',
      text: `
<b>Status for #${escrowId}:</b> ⚠️ <b>Under Dispute Review</b>

<b>Item:</b> ${itemName}
<b>Amount:</b> GH₵ ${amount}

This order is currently being reviewed by TrustLink support. Funds remain safely held.
`.trim()
    };
  }

  return {
    status: rawStatus,
    text: `
<b>Status for #${escrowId}:</b> <code>${rawStatus}</code>

<b>Item:</b> ${itemName}
<b>Amount:</b> GH₵ ${amount}
`.trim()
  };
}

/**
 * Returns the action buttons for an Escrow based on its live status
 */
export function getEscrowActionKeyboard(escrowId, checkoutUrl, itemName, amount, options = {}) {
  const status = (options.status || 'PENDING_PAYMENT').toUpperCase();
  const whatsappShareText = encodeURIComponent(
    `Hello! Here is your TrustLink protected payment link for ${itemName} (GH₵ ${Number(amount).toFixed(2)}):\n\n${checkoutUrl}\n\nYour money is held safely until you receive and check your package.`
  );

  const smsButtonText = options.smsSent ? 'Resend SMS to Buyer' : 'Send SMS to Buyer';

  if (['FUNDS_ESCROWED', 'FUNDED', 'PAID', 'PAYMENT_PROTECTED'].includes(status)) {
    return {
      inline_keyboard: [
        [
          { text: 'I Have Sent the Item', callback_data: `btn_ship:${escrowId}` }
        ],
        [
          { text: 'Check Payment Status', callback_data: `btn_status:${escrowId}` }
        ],
        [
          { text: 'Create Another Link', callback_data: 'btn_new' }
        ]
      ]
    };
  }

  if (['ITEM_SHIPPED', 'DISPATCHED', 'SHIPPED'].includes(status)) {
    return {
      inline_keyboard: [
        [
          { text: 'Check Payment Status', callback_data: `btn_status:${escrowId}` }
        ],
        [
          { text: 'Create Another Link', callback_data: 'btn_new' }
        ]
      ]
    };
  }

  if (['COMPLETED', 'CONFIRMED', 'RELEASED'].includes(status)) {
    return {
      inline_keyboard: [
        [
          { text: 'My Money / Balance', callback_data: 'btn_balance' }
        ],
        [
          { text: 'Create Payment Link', callback_data: 'btn_new' }
        ]
      ]
    };
  }

  // Default: PENDING_PAYMENT (Unpaid)
  return {
    inline_keyboard: [
      [
        { text: smsButtonText, callback_data: `btn_sms:${escrowId}` }
      ],
      [
        {
          text: 'Send on WhatsApp',
          url: `https://api.whatsapp.com/send?text=${whatsappShareText}`
        }
      ],
      [
        { text: 'Check Payment Status', callback_data: `btn_status:${escrowId}` }
      ],
      [
        { text: 'Create Another Link', callback_data: 'btn_new' }
      ]
    ]
  };
}

/**
 * Dispatches an instant Push Notification to a Seller on Telegram when their buyer completes MoMo payment
 */
export async function sendOrderPaymentNotification(chatId, escrow) {
  const amount = Number(escrow.amount || escrow.totalAmount || 0).toFixed(2);
  const itemName = escrow.description || escrow.itemName || 'Order Item';
  const escrowId = escrow.id || escrow.escrowId || 'N/A';
  const buyerPhone = escrow.buyerPhone || 'Buyer';

  const message = `
<b>Good news! Your Buyer Has Paid!</b>

<b>Item:</b> ${itemName}
<b>Amount:</b> GH₵ ${amount}
<b>Buyer:</b> ${buyerPhone}
<b>Order ID:</b> <code>${escrowId}</code>

The money is now held safely in TrustLink. You can now deliver or send the item to the buyer!
`.trim();

  const keyboard = {
    inline_keyboard: [
      [
        { text: 'I Have Sent the Item', callback_data: `btn_ship:${escrowId}` }
      ],
      [
        { text: 'Check Payment Status', callback_data: `btn_status:${escrowId}` }
      ],
      [
        { text: 'View on Web Dashboard', url: `https://www.trustlinkgh.online/dashboard.html` }
      ]
    ]
  };

  return await sendTelegramMessage(chatId, message, {
    reply_markup: keyboard
  });
}
