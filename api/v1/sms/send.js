import { validateGhanaPhone, sanitizeString } from '../../_utils/validator.js';
import { enforceRateLimit } from '../../_utils/rate-limiter.js';
import { createRequestLogger } from '../../_utils/logger.js';

export default async function handler(req, res) {
  const logger = createRequestLogger(req, 'sms-dispatch');

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

  // 1. Enforce Rate Limiting (max 10 SMS requests per 10 minutes per IP)
  const allowed = enforceRateLimit(req, res, {
    maxRequests: 10,
    windowSeconds: 600,
    keyPrefix: 'sms-send'
  });
  if (!allowed) {
    logger.warn('RATE_LIMITED', 'Rate limit exceeded for SMS dispatch');
    return;
  }

  try {
    const { phone, message, referenceId } = req.body || {};

    // 2. Validate and Normalize Ghana Phone Number
    const phoneValidation = validateGhanaPhone(phone);
    if (!phoneValidation.isValid) {
      logger.warn('INVALID_INPUT', 'Phone number validation failed', { phone, error: phoneValidation.error });
      return res.status(400).json({ error: phoneValidation.error || 'Invalid Ghanaian phone number' });
    }

    // 3. Sanitize Message Content
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message content is required.' });
    }
    const cleanMessage = sanitizeString(message, 320); // standard 2-segment SMS max length
    const cleanRef = sanitizeString(referenceId || `sms-${Date.now()}`, 64);
    const recipient = phoneValidation.intl;

    logger.info('SMS_DISPATCH_ATTEMPT', 'Dispatching transactional SMS', {
      recipient,
      messageLength: cleanMessage.length,
      ref: cleanRef
    });

    const sasuSyncKey = process.env.SASUSYNC_API_KEY;
    const arkeselKey = process.env.ARKESEL_API_KEY;
    const senderId = process.env.SASUSYNC_SENDER_ID || "TrustEscrow";

    // Step 1: Try Primary SasuSync SMS Gateway
    if (sasuSyncKey) {
      try {
        const sasuRes = await fetch("https://sms.sasulabs.me/api/v1/send", {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': sasuSyncKey
          },
          body: JSON.stringify({
            sender: senderId,
            recipients: [recipient],
            message: cleanMessage,
            metadata: { ref: cleanRef }
          })
        });

        const data = await sasuRes.json().catch(() => ({}));
        if (sasuRes.ok && data.success) {
          logger.audit('SMS_SENT_SASUSYNC', 'SMS successfully sent via SasuSync', { recipient, ref: cleanRef });
          return res.status(200).json({ success: true, provider: 'sasusync', data });
        } else {
          logger.warn('SASUSYNC_REJECTED', 'SasuSync delivery rejected, attempting fallback', { status: sasuRes.status, data });
        }
      } catch (err) {
        logger.error('SASUSYNC_NETWORK_ERROR', 'Network error reaching SasuSync', { error: err.message });
      }
    }

    // Step 2: Try Secondary Arkesel SMS Gateway
    if (arkeselKey) {
      try {
        const arkeselRes = await fetch(`https://sms.arkesel.com/api/v2/sms/send`, {
          method: 'POST',
          headers: {
            'api-key': arkeselKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            sender: "TrustEscrow",
            message: cleanMessage,
            recipients: [recipient]
          })
        });

        const data = await arkeselRes.json().catch(() => ({}));
        if (arkeselRes.ok) {
          logger.audit('SMS_SENT_ARKESEL', 'SMS successfully sent via Arkesel fallback', { recipient, ref: cleanRef });
          return res.status(200).json({ success: true, provider: 'arkesel', data });
        }
      } catch (err) {
        logger.error('ARKESEL_NETWORK_ERROR', 'Network error reaching Arkesel', { error: err.message });
      }
    }

    // Step 3: Return graceful response if no SMS provider key configured in environment
    logger.warn('SMS_GATEWAY_NOT_CONFIGURED', 'No active SMS gateway API key configured');
    return res.status(503).json({
      error: 'No active SMS Gateway credentials configured (SASUSYNC_API_KEY / ARKESEL_API_KEY).',
      recipient: phoneValidation.local,
      nativeSmsLink: `sms:${phoneValidation.local}?&body=${encodeURIComponent(cleanMessage)}`
    });

  } catch (err) {
    logger.error('SMS_HANDLER_EXCEPTION', 'Unhandled exception in SMS dispatch handler', { error: err.message });
    return res.status(500).json({ error: 'Internal server error processing SMS dispatch.' });
  }
}
