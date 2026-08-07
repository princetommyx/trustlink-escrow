/**
 * TrustLink Escrow - Shared Transactional SMS Dispatcher
 * Dispatches SMS notifications to buyers and sellers with SasuSync (primary) and Arkesel (fallback).
 */

import { validateGhanaPhone, sanitizeString } from './validator.js';

/**
 * Dispatches a transactional SMS to a Ghanaian phone number
 * @param {object} params
 * @param {string} params.phone - Recipient Ghana phone number (local or intl format)
 * @param {string} params.message - SMS body text (up to 320 chars)
 * @param {string} [params.referenceId] - Unique reference / idempotency key
 * @param {string} [params.senderId] - Custom sender ID (defaults to SASUSYNC_SENDER_ID or TrustEscrow)
 * @returns {Promise<{success: boolean, provider?: string, recipient: string, message: string, error?: string, nativeSmsLink?: string}>}
 */
export async function dispatchTransactionalSMS({ phone, message, referenceId = '', senderId = '' }) {
  const phoneValidation = validateGhanaPhone(phone);
  if (!phoneValidation.isValid && !phoneValidation.valid) {
    return {
      success: false,
      error: phoneValidation.error || 'Invalid Ghanaian phone number',
      recipient: phone || '',
      message: message || ''
    };
  }

  const cleanMessage = sanitizeString(message, 320);
  const cleanRef = sanitizeString(referenceId || `sms-${Date.now()}`, 64);
  const recipient = phoneValidation.intl || (phoneValidation.cleanDigits?.startsWith('0') ? ('233' + phoneValidation.cleanDigits.slice(1)) : phoneValidation.cleanDigits);
  const activeSender = senderId || process.env.SASUSYNC_SENDER_ID || "TrustEscrow";

  const sasuSyncKey = process.env.SASUSYNC_API_KEY;
  const sasuBaseUrl = process.env.SASUSYNC_BASE_URL || "https://sms.sasusync.com";
  const arkeselKey = process.env.ARKESEL_API_KEY;

  // Step 1: Try Primary SasuSync SMS Gateway
  if (sasuSyncKey) {
    try {
      const sasuRes = await fetch(`${sasuBaseUrl}/api/v1/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': sasuSyncKey
        },
        body: JSON.stringify({
          sender: activeSender,
          recipients: [recipient],
          message: cleanMessage,
          metadata: { ref: cleanRef }
        })
      });

      const data = await sasuRes.json().catch(() => ({}));
      if (sasuRes.ok && data.success) {
        return {
          success: true,
          provider: 'sasusync',
          data,
          recipient: phoneValidation.formattedLocal || recipient,
          message: cleanMessage
        };
      }
    } catch (err) {
      console.warn('[SMS_DISPATCHER] SasuSync network notice:', err.message);
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
          sender: activeSender,
          message: cleanMessage,
          recipients: [recipient]
        })
      });

      const data = await arkeselRes.json().catch(() => ({}));
      if (arkeselRes.ok) {
        return {
          success: true,
          provider: 'arkesel',
          data,
          recipient: phoneValidation.formattedLocal || recipient,
          message: cleanMessage
        };
      }
    } catch (err) {
      console.warn('[SMS_DISPATCHER] Arkesel network notice:', err.message);
    }
  }

  // Fallback response when no cloud gateway key configured or network is offline
  return {
    success: false,
    error: 'No active SMS Gateway credentials configured (SASUSYNC_API_KEY / ARKESEL_API_KEY).',
    recipient: phoneValidation.formattedLocal || recipient,
    message: cleanMessage,
    nativeSmsLink: `sms:${phoneValidation.formattedLocal || recipient}?&body=${encodeURIComponent(cleanMessage)}`
  };
}

/**
 * Builds the exact site-standard TrustLink Escrow SMS message
 * @param {object} params
 * @param {string} params.sellerName - Name of the seller
 * @param {string} params.itemName - Title / description of item
 * @param {number|string} params.amount - Order amount
 * @param {string} params.checkoutUrl - Direct payment link
 * @param {string} [params.deliveryDate] - Optional delivery timeline
 * @returns {string} Exact SMS body matching the web dashboard
 */
export function buildEscrowOrderSMS({ sellerName, itemName, amount, checkoutUrl, deliveryDate = '' }) {
  const formattedAmount = Number(amount || 0).toFixed(2);
  const orderTitle = itemName || 'Order';
  const seller = sellerName || 'TrustLink Seller';
  const deliveryStr = deliveryDate ? ` Delivery: ${deliveryDate}.` : '';
  return `TrustLink: ${seller} created an escrow for ${orderTitle} (GH₵ ${formattedAmount}).${deliveryStr} Pay securely at: ${checkoutUrl}`;
}

