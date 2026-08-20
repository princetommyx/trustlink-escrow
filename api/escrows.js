const cors = require('cors')({ origin: true });
const { db, admin } = require('./firebase-admin');
const twilio = require('twilio');

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://www.trustlinkgh.online';

const authenticateApi = async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
        res.status(401).json({ error: 'Missing x-api-key header' });
        return null;
    }
    try {
        const usersSnapshot = await db.collection('users').where('apiKey', '==', apiKey).limit(1).get();
        if (usersSnapshot.empty) {
            res.status(403).json({ error: 'Invalid API Key' });
            return null;
        }
        return { vendorId: usersSnapshot.docs[0].id, vendorData: usersSnapshot.docs[0].data() };
    } catch (error) {
        console.error('Auth Error in API middleware', error);
        res.status(500).json({ error: 'Internal Server Error' });
        return null;
    }
};

const getTwilioClient = () => {
    const accountSid = process.env.TWILIO_SID;
    const authToken = process.env.TWILIO_TOKEN;
    if (!accountSid || !authToken) return null;
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

    const vendorInfo = await authenticateApi(req, res);
    if (!vendorInfo) return; // response already sent

    const { amount, description, buyerEmail, buyerPhone, deliveryDate, redirectUrl, cancelUrl, customReference } = req.body;

    if (!amount || !description) {
        return res.status(400).json({ error: 'Missing required fields: amount, description' });
    }

    try {
        const escrowData = {
            amount: parseFloat(amount),
            description: description,
            buyerEmail: buyerEmail || '',
            buyerPhone: buyerPhone || '',
            deliveryDate: deliveryDate || '',
            redirectUrl: redirectUrl || '',
            cancelUrl: cancelUrl || '',
            customReference: customReference || '',
            sellerId: vendorInfo.vendorId,
            sellerEmail: vendorInfo.vendorData.email || '',
            status: 'PENDING_PAYMENT',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            apiCreated: true
        };

        const escrowRef = await db.collection('escrows').add(escrowData);
        const checkoutUrl = `${APP_BASE_URL}/checkout.html?id=${escrowRef.id}`;

        if (escrowData.buyerPhone) {
            try {
                const client = getTwilioClient();
                if (client) {
                    const twilioNumber = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+16624904332";
                    const toWhatsAppNumber = escrowData.buyerPhone.startsWith('whatsapp:') ? escrowData.buyerPhone : `whatsapp:${escrowData.buyerPhone}`;
                    const messageBody = `TRUSTLINK ESCROW PAYMENT INVOICE\n\nYour escrow payment (ID: ${escrowRef.id}) is ready for checkout.\n\nYour payment remains securely protected in TrustLink Escrow until you receive and verify your order.\n\nPay securely here:\n${checkoutUrl}\n\nProtected by TrustLink Escrow Ghana`;
                    
                    await client.messages.create({
                        body: messageBody,
                        from: twilioNumber,
                        to: toWhatsAppNumber
                    });
                }
            } catch (twilioError) {
                console.error("Failed to send WhatsApp message", twilioError);
            }
        }

        return res.status(201).json({
            id: escrowRef.id,
            status: 'PENDING_PAYMENT',
            checkoutUrl: checkoutUrl,
            customReference: escrowData.customReference
        });
    } catch (error) {
        console.error('Error creating escrow via API', error);
        return res.status(500).json({ error: 'Failed to create escrow' });
    }
};
