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
        console.log('[Moolre Settlement]', JSON.stringify(payload));
        if (!payload || !payload.externalref) return res.status(400).json({ error: 'Missing externalref' });

        const transactionId = payload.externalref;
        const isSuccess = payload.status == 1 || payload.transaction_status === 'SUCCESS';
        const isFailed = payload.status == 0 || payload.transaction_status === 'FAILED';

        if ((isSuccess || isFailed) && db) {
            const txRef = db.collection('transactions').doc(transactionId);
            await db.runTransaction(async (t) => {
                const snap = await t.get(txRef);
                if (!snap.exists) return;
                const txData = snap.data();
                if (isSuccess && txData.status !== 'completed') {
                    t.update(txRef, { status: 'completed', settledAt: admin.firestore.FieldValue.serverTimestamp(), moolreSettlementReceived: true });
                    if (txData.momoNumber) await sendSmsAlert(txData.momoNumber, `TrustLink: Withdrawal of GH\u20b5${txData.amount} sent to your account successfully.`);
                } else if (isFailed && txData.status !== 'failed') {
                    t.update(txRef, { status: 'failed', failedAt: admin.firestore.FieldValue.serverTimestamp(), failureReason: payload.message || 'Payout failed' });
                    if (txData.userId) {
                        const userRef = db.collection('users').doc(txData.userId);
                        const userSnap = await t.get(userRef);
                        if (userSnap.exists) t.update(userRef, { walletBalance: (userSnap.data().walletBalance || 0) + txData.amount });
                    }
                    if (txData.momoNumber) await sendSmsAlert(txData.momoNumber, `TrustLink: Withdrawal of GH\u20b5${txData.amount} failed. Amount refunded to your wallet.`);
                }
            });
        }
        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('[Moolre Settlement] Error:', err.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
