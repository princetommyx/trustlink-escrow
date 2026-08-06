import { createRequestLogger } from '../_utils/logger.js';
import { enforceRateLimit } from '../_utils/rate-limiter.js';

export default function handler(req, res) {
  const logger = createRequestLogger(req, 'whatsapp-webhook');

  // Set Security & CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Meta Webhook Verification (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!verifyToken) {
      logger.error('SECRET_MISSING', 'WHATSAPP_VERIFY_TOKEN not set on server');
      return res.status(500).json({ error: 'Webhook configuration incomplete.' });
    }

    if (mode === 'subscribe' && token === verifyToken) {
      logger.audit('WEBHOOK_CHALLENGE_VERIFIED', 'Meta WhatsApp Webhook subscription verified');
      return res.status(200).send(challenge);
    }

    logger.warn('WEBHOOK_CHALLENGE_MISMATCH', 'Webhook verification failed', { mode, tokenReceived: !!token });
    return res.status(403).json({ error: 'Verification token mismatch' });
  }

  // Meta Webhook Event Notification (POST)
  if (req.method === 'POST') {
    // Rate limit incoming event webhooks from abusive IPs (max 100/min)
    const allowed = enforceRateLimit(req, res, {
      maxRequests: 100,
      windowSeconds: 60,
      keyPrefix: 'whatsapp-webhook'
    });
    if (!allowed) return;

    const body = req.body;
    logger.info('WEBHOOK_EVENT_RECEIVED', 'Received WhatsApp Webhook notification', {
      object: body?.object,
      entryCount: body?.entry?.length || 0
    });
    return res.status(200).send('EVENT_RECEIVED');
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
