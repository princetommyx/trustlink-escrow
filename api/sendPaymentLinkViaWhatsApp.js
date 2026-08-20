const cors = require('cors')({ origin: true });
const twilio = require('twilio');
const { authenticateToken } = require('./firebase-admin');

const getTwilioClient = () => {
    const accountSid = process.env.TWILIO_SID;
    const authToken = process.env.TWILIO_TOKEN;
    if (!accountSid || !authToken) {
        return null;
    }
    return twilio(accountSid, authToken);
};

module.exports = async (req, res) => {
    await new Promise((resolve, reject) => {
        cors(req, res, (result) => {
            if (result instanceof Error) return reject(result);
            resolve(result);
        });
    });

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const data = req.body.data || req.body;
    const { buyerPhone, transactionId, paymentLink } = data;

    if (!buyerPhone || !paymentLink) {
        return res.status(400).json({ error: 'The function must be called with a buyerPhone and paymentLink.' });
    }

    const client = getTwilioClient();
    if (!client) {
         return res.status(500).json({ error: 'Twilio client not configured properly.' });
    }

    const twilioNumber = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+16624904332";
    const toWhatsAppNumber = buyerPhone.startsWith('whatsapp:') ? buyerPhone : `whatsapp:${buyerPhone}`;

    const messageBody = `TRUSTLINK ESCROW PAYMENT INVOICE\n\nYour escrow payment (ID: ${transactionId}) is ready for checkout.\n\nYour payment remains securely protected in TrustLink Escrow until you receive and verify your order.\n\nPay securely here:\n${paymentLink}\n\nProtected by TrustLink Escrow Ghana`;

    try {
        const message = await client.messages.create({
            body: messageBody,
            from: twilioNumber,
            to: toWhatsAppNumber
        });

        return res.status(200).json({ data: { success: true, messageId: message.sid } });
    } catch (error) {
        console.error("Error sending WhatsApp message", error);
        return res.status(500).json({ error: 'Failed to send WhatsApp message.' });
    }
};
