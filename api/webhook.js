const cors = require('cors')({ origin: true });

module.exports = async (req, res) => {
    await new Promise((resolve, reject) => {
        cors(req, res, (result) => {
            if (result instanceof Error) return reject(result);
            resolve(result);
        });
    });

    const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'trustlink_secret_token_2026';

    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
            console.log('WhatsApp Webhook verified successfully by Meta');
            return res.status(200).send(challenge);
        } else {
            console.warn('WhatsApp Webhook verification failed. Received token:', token);
            return res.status(403).json({ error: 'Verification token mismatch' });
        }
    } else if (req.method === 'POST') {
        const body = req.body;
        
        if (body.object === 'whatsapp_business_account' || body.entry) {
            console.log('Received WhatsApp Webhook Event:', JSON.stringify(body, null, 2));
            return res.status(200).send('EVENT_RECEIVED');
        }

        return res.status(404).send('Not Found');
    }

    return res.status(405).send('Method Not Allowed');
};
