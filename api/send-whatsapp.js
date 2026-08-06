import { validateGhanaPhone, sanitizeString, validateAmount, isValidId } from './_utils/validator.js';
import { enforceRateLimit } from './_utils/rate-limiter.js';
import { createRequestLogger } from './_utils/logger.js';

export default async function handler(req, res) {
  const logger = createRequestLogger(req, 'whatsapp-dispatch');

  // Set Security & CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    logger.warn('INVALID_METHOD', `Method ${req.method} not allowed`);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 1. Enforce Rate Limiting (max 15 WhatsApp requests per 10 minutes per IP)
  const allowed = enforceRateLimit(req, res, {
    maxRequests: 15,
    windowSeconds: 600,
    keyPrefix: 'whatsapp-send'
  });
  if (!allowed) {
    logger.warn('RATE_LIMITED', 'Rate limit exceeded for WhatsApp dispatch');
    return;
  }

  try {
    const { to, description, amount, sellerName, checkoutUrl, escrowId } = req.body || {};

    // 2. Validate Recipient Phone Number
    const phoneValidation = validateGhanaPhone(to);
    if (!phoneValidation.isValid) {
      logger.warn('INVALID_PHONE', 'Invalid recipient phone number', { to, error: phoneValidation.error });
      return res.status(400).json({ error: phoneValidation.error || 'Recipient phone number is invalid' });
    }

    // 3. Validate Amount
    const amountValidation = validateAmount(amount);
    if (!amountValidation.isValid) {
      logger.warn('INVALID_AMOUNT', 'Invalid transaction amount', { amount, error: amountValidation.error });
      return res.status(400).json({ error: amountValidation.error || 'Invalid transaction amount' });
    }

    // 4. Sanitize Strings
    const orderTitle = sanitizeString(description || 'Escrow Transaction', 120);
    const creator = sanitizeString(sellerName || 'TrustLink User', 60);
    const cleanEscrowId = sanitizeString(escrowId || '', 64);
    const payLink = sanitizeString(checkoutUrl || `https://www.trustlinkgh.online/checkout.html?id=${cleanEscrowId}`, 300);
    const formattedAmount = amountValidation.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const cleanNumber = phoneValidation.intl;

    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '1211218685412737';

    if (!token) {
      logger.error('SECRET_MISSING', 'WHATSAPP_ACCESS_TOKEN is not configured on server');
      return res.status(500).json({ error: 'WHATSAPP_ACCESS_TOKEN is not configured on the server' });
    }

    const messageText = 
`🔒 *TrustLink Escrow Payment Notification*

Hello! An escrow payment request has been generated for you by *${creator}*.

📦 *Order:* ${orderTitle}
💰 *Amount Due:* GH₵ ${formattedAmount}
🆔 *Escrow ID:* #${cleanEscrowId || 'N/A'}

🔗 *Pay Securely via Mobile Money / Card:*
${payLink}

🛡️ _Your money remains safe in TrustLink Escrow and will only be released when you receive and approve your item._`;

    const directWhatsAppUrl = `https://wa.me/${cleanNumber}?text=${encodeURIComponent(messageText)}`;

    logger.info('WHATSAPP_DISPATCH_ATTEMPT', 'Sending WhatsApp message to buyer', {
      recipient: cleanNumber,
      escrowId: cleanEscrowId,
      amount: formattedAmount
    });

    // Try sending rich text message first
    let metaResponse = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanNumber,
        type: 'text',
        text: {
          preview_url: true,
          body: messageText
        }
      })
    });

    let data = await metaResponse.json().catch(() => ({}));

    // If text message fails due to 24-hr customer care window (#131047 / #131030), try template fallback
    if (!metaResponse.ok && (data.error?.code === 131047 || data.error?.code === 131030 || data.error?.code === 100)) {
      logger.info('WHATSAPP_TEMPLATE_FALLBACK', 'Falling back to approved Meta utility template', { recipient: cleanNumber });
      
      const templateResponse = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanNumber,
          type: 'template',
          template: {
            name: 'trustlink_escrow_invoice',
            language: { code: 'en_US' },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: creator },
                  { type: 'text', text: orderTitle },
                  { type: 'text', text: formattedAmount },
                  { type: 'text', text: cleanEscrowId || 'N/A' }
                ]
              },
              {
                type: 'button',
                sub_type: 'url',
                index: '0',
                parameters: [
                  { type: 'text', text: cleanEscrowId || '' }
                ]
              }
            ]
          }
        })
      });

      const templateData = await templateResponse.json().catch(() => ({}));
      if (templateResponse.ok) {
        logger.audit('WHATSAPP_SENT_TEMPLATE', 'WhatsApp template sent successfully', { messageId: templateData.messages?.[0]?.id, recipient: cleanNumber });
        return res.status(200).json({
          success: true,
          messageId: templateData.messages?.[0]?.id,
          type: 'template',
          directWhatsAppUrl,
          data: templateData
        });
      }
    }

    if (!metaResponse.ok) {
      logger.error('WHATSAPP_API_ERROR', 'Meta WhatsApp API returned error', { error: data.error });
      return res.status(metaResponse.status || 500).json({ 
        error: data.error?.message || 'Failed to send WhatsApp message', 
        errorCode: data.error?.code,
        directWhatsAppUrl,
        details: data 
      });
    }

    logger.audit('WHATSAPP_SENT_TEXT', 'WhatsApp message sent successfully', { messageId: data.messages?.[0]?.id, recipient: cleanNumber });
    return res.status(200).json({ 
      success: true, 
      messageId: data.messages?.[0]?.id, 
      type: 'text',
      directWhatsAppUrl,
      data 
    });

  } catch (error) {
    logger.error('WHATSAPP_HANDLER_EXCEPTION', 'Exception in WhatsApp dispatch handler', { error: error.message });
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
