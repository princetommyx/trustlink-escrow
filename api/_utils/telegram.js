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
 * Returns the action buttons for a created or active Escrow
 */
export function getEscrowActionKeyboard(escrowId, checkoutUrl, itemName, amount, options = {}) {
  const whatsappShareText = encodeURIComponent(
    `Hello! Here is your TrustLink protected payment link for ${itemName} (GH₵ ${Number(amount).toFixed(2)}):\n\n${checkoutUrl}\n\nYour money is held safely until you receive and check your package.`
  );

  const smsButtonText = options.smsSent ? 'Resend SMS to Buyer' : 'Send SMS to Buyer';

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
        { text: 'I Have Sent the Item', callback_data: `btn_ship:${escrowId}` },
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
  const amount = Number(escrow.amount || 0).toFixed(2);
  const itemName = escrow.description || escrow.itemName || 'Order Item';
  const escrowId = escrow.id || 'N/A';
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
        { text: 'View on Web Dashboard', url: `https://www.trustlinkgh.online/dashboard.html` }
      ]
    ]
  };

  return await sendTelegramMessage(chatId, message, {
    reply_markup: keyboard
  });
}
