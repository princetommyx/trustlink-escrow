const cors = require('cors')({ origin: true });
const { db, admin, normalizeGhanaPhone } = require('../_firebase-admin');

async function sendBuyerSmsAlert(phone, message) {
    try {
        const apiKey = process.env.SASUSYNC_API_KEY;
        if (!apiKey) return;

        const { local } = normalizeGhanaPhone(phone);
        if (!local) return;

        const baseUrl = process.env.SASUSYNC_BASE_URL || 'https://sms.sasusync.com';
        await fetch(`${baseUrl}/api/v1/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey
            },
            body: JSON.stringify({
                sender: "TrustEscrow",
                recipients: ['233' + local.slice(1)],
                message: message
            })
        });
    } catch (err) {
        console.error("SMS notification delivery error", err);
    }
}

module.exports = async (req, res) => {
    // Enable CORS for Moolre
    await new Promise((resolve, reject) => {
        cors(req, res, (result) => {
            if (result instanceof Error) return reject(result);
            resolve(result);
        });
    });

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed. Must be POST.' });
    }

    try {
        const payload = req.body;
        console.log("Moolre Webhook Received:", JSON.stringify(payload, null, 2));

        // Basic payload validation - Moolre usually sends status and externalref
        if (!payload || !payload.externalref) {
            return res.status(400).json({ error: 'Missing externalref in payload' });
        }

        const escrowId = payload.externalref;
        
        // Moolre uses status = 1 or transaction_status = 'SUCCESS' for successful payments
        const isSuccess = payload.status == 1 || payload.transaction_status === 'SUCCESS';

        if (isSuccess) {
            const escrowRef = db.collection('escrows').doc(escrowId);
            const escSnap = await escrowRef.get();
            
            if (escSnap.exists) {
                const esc = escSnap.data();
                
                // Only transition if it's currently pending payment
                if (esc.status === 'PENDING_PAYMENT') {
                    await escrowRef.update({
                        status: 'FUNDS_ESCROWED',
                        paidAt: admin.firestore.FieldValue.serverTimestamp(),
                        moolreWebhookReceived: true
                    });

                    // Notify the seller to dispatch
                    if (esc.sellerPhone) {
                        await sendBuyerSmsAlert(esc.sellerPhone, `TrustLink: Payment of GH₵ ${esc.amount} for "${esc.description}" has been secured in escrow! Please dispatch the item.`);
                    }
                    console.log(`[Moolre Webhook] Escrow ${escrowId} marked as FUNDS_ESCROWED`);
                } else {
                    console.log(`[Moolre Webhook] Escrow ${escrowId} is already in state: ${esc.status}`);
                }
            } else {
                console.log(`[Moolre Webhook] Escrow ${escrowId} not found in database.`);
            }
        }

        // Always return 200 OK so Moolre knows we received it
        return res.status(200).json({ success: true, message: 'Webhook received and processed' });

    } catch (err) {
        console.error("Moolre webhook processing error:", err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
