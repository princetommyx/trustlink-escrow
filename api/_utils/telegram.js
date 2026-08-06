/**
 * Telegram Bot API Dispatcher & Formatting Utility
 * Provides helpers for sending rich Markdown messages, inline keyboards,
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
 * @param {string} text - Message text (Markdown formatted)
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
        { text: '✨ Create New Escrow', callback_data: 'btn_new' },
        { text: '💼 My Balance', callback_data: 'btn_balance' }
      ],
      [
        { text: '📋 Recent Orders', callback_data: 'btn_orders' },
        { text: '❓ How It Works', callback_data: 'btn_help' }
      ],
      [
        { text: '🌐 Open TrustLink Dashboard', url: 'https://www.trustlinkgh.online/dashboard.html' }
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
        { text: '🤝 50/50 Split (1.5% each)', callback_data: 'btn_fee_split:50/50' }
      ],
      [
        { text: '🛒 Buyer Pays (3%)', callback_data: 'btn_fee_split:buyer' }
      ],
      [
        { text: '🏪 Seller Pays (3%)', callback_data: 'btn_fee_split:seller' }
      ],
      [
        { text: '❌ Cancel', callback_data: 'btn_cancel' }
      ]
    ]
  };
}

/**
 * Returns the action buttons for an created or active Escrow
 */
export function getEscrowActionKeyboard(escrowId, checkoutUrl, itemName, amount) {
  const whatsappShareText = encodeURIComponent(
    `Hello! Here is your TrustLink Escrow protected payment link for ${itemName} (GH₵ ${amount.toFixed(2)}):\n\n${checkoutUrl}\n\nYour payment is protected until you inspect and confirm delivery!`
  );

  return {
    inline_keyboard: [
      [
        {
          text: '📲 Share on WhatsApp',
          url: `https://api.whatsapp.com/send?text=${whatsappShareText}`
        }
      ],
      [
        { text: '🚚 Mark as Shipped', callback_data: `btn_ship:${escrowId}` },
        { text: '🔄 Check Status', callback_data: `btn_status:${escrowId}` }
      ],
      [
        { text: '➕ Create Another Link', callback_data: 'btn_new' }
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
🔔 <b>PAYMENT RECEIVED IN ESCROW!</b>

💰 <b>Amount:</b> GH₵ ${amount}
📦 <b>Item:</b> ${itemName}
📱 <b>Buyer:</b> ${buyerPhone}
🆔 <b>Escrow ID:</b> <code>${escrowId}</code>

🛡️ <i>Funds are now securely locked in TrustLink Escrow. You can now ship the package safely to the buyer!</i>
`.trim();

  const keyboard = {
    inline_keyboard: [
      [
        { text: '🚚 Mark as Shipped', callback_data: `btn_ship:${escrowId}` }
      ],
      [
        { text: '🌐 View on Dashboard', url: `https://www.trustlinkgh.online/dashboard.html` }
      ]
    ]
  };

  return await sendTelegramMessage(chatId, message, {
    reply_markup: keyboard
  });
}
