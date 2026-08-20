const cors = require('cors')({ origin: true });
const { db, admin, normalizeGhanaPhone } = require('./firebase-admin');

// Helper: Send Buyer SMS Alert via SasuSync
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
    await new Promise((resolve, reject) => {
        cors(req, res, (result) => {
            if (result instanceof Error) return reject(result);
            resolve(result);
        });
    });

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const data = req.body.data || req.body;
    const { escrowId } = data;
    
    if (!escrowId) return res.status(400).json({ error: 'Missing escrowId.' });

    try {
        const escrowRef = db.collection('escrows').doc(escrowId);
        const escrowSnap = await escrowRef.get();
        if (!escrowSnap.exists) {
            return res.status(404).json({ error: 'Escrow record not found.' });
        }

        const esc = escrowSnap.data();

        // Idempotency check
        if (['FUNDS_ESCROWED', 'ITEM_SHIPPED', 'COMPLETED'].includes(esc.status)) {
            return res.status(200).json({ data: { success: true, status: esc.status, paid: true } });
        }

        const apiUser = process.env.MOOLRE_API_USER;
        const privKey = process.env.MOOLRE_PRIVATE_KEY;

        if (!apiUser || !privKey) {
            return res.status(500).json({ error: 'Payment gateway configuration error.' });
        }

        const response = await fetch(`https://api.moolre.com/open/transact/status?externalref=${escrowId}`, {
            method: 'GET',
            headers: {
                'X-API-USER': apiUser,
                'X-API-KEY': privKey
            }
        });

        const resData = await response.json();
        if (response.ok && (resData.status == 1 || resData.transaction_status === 'SUCCESS')) {
            await escrowRef.update({
                status: 'FUNDS_ESCROWED',
                paidAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // Dispatch SMS alert to seller
            if (esc.sellerPhone) {
                sendBuyerSmsAlert(
                    esc.sellerPhone,
                    `TrustLink: Payment of GH₵ ${esc.amount} for "${esc.description}" has been secured in escrow! Please dispatch the item.`
                );
            }

            return res.status(200).json({ data: { success: true, status: 'FUNDS_ESCROWED', paid: true } });
        }

        return res.status(200).json({ data: { success: false, status: esc.status, paid: false } });
    } catch (err) {
        console.error("Payment verification error", err);
        return res.status(500).json({ error: 'Payment status verification failed.' });
    }
};
