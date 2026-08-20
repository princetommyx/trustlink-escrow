'use strict';
const { db, admin, normalizeGhanaPhone } = require('../_firebase-admin.js');

async function sendSmsAlert(phone, message) {
    try {
        const apiKey = process.env.SASUSYNC_API_KEY;
        if (!apiKey || !phone) return;
        const { local } = normalizeGhanaPhone(phone);
        if (!local) return;
        const baseUrl = process.env.SASUSYNC_BASE_URL || 'https://sms.sasusync.com';
        await fetch(`${baseUrl}/api/v1/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
            body: JSON.stringify({ sender: 'TrustLink', recipients: [local], message })
        });
    } catch (err) { console.error('SMS error:', err.message); }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const payload = req.body;
        console.log('[Moolre Webhook]', JSON.stringify(payload));
        if (!payload || !payload.externalref) return res.status(400).json({ error: 'Missing externalref' });

        const escrowId = payload.externalref;
        const isSuccess = payload.status == 1 || payload.transaction_status === 'SUCCESS';

        if (isSuccess && db) {
            const escrowRef = db.collection('escrows').doc(escrowId);
            const snap = await escrowRef.get();
            if (snap.exists && snap.data().status === 'PENDING_PAYMENT') {
                await escrowRef.update({
                    status: 'FUNDS_ESCROWED',
                    paidAt: admin.firestore.FieldValue.serverTimestamp(),
                    moolreWebhookReceived: true
                });
                const esc = snap.data();
                if (esc.sellerPhone) {
                    await sendSmsAlert(esc.sellerPhone, `TrustLink: Payment of GH\u20b5${esc.amount} for "${esc.description}" secured. Please dispatch the item.`);
                }
            }
        }
        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('[Moolre Webhook] Error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
