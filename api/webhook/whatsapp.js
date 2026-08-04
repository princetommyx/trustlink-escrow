export default function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Meta Webhook Verification (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'trustlink_secret_token_2026';

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('WhatsApp Webhook verified successfully by Meta');
      return res.status(200).send(challenge);
    }

    console.warn('WhatsApp Webhook verification mismatch. Received token:', token);
    return res.status(403).json({ error: 'Verification token mismatch' });
  }

  // Meta Webhook Event Notification (POST)
  if (req.method === 'POST') {
    const body = req.body;
    console.log('Received WhatsApp Webhook Event:', JSON.stringify(body, null, 2));
    return res.status(200).send('EVENT_RECEIVED');
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
