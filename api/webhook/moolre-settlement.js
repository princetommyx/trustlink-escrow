const cors = require('cors')({ origin: true });
const { db, admin, normalizeGhanaPhone } = require('../_firebase-admin');

async function sendSmsAlert(phone, message) {
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
    // Enable CORS
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
        console.log("Moolre Settlement Webhook Received:", JSON.stringify(payload, null, 2));

        if (!payload || !payload.externalref) {
            return res.status(400).json({ error: 'Missing externalref in payload' });
        }

        const transactionId = payload.externalref;
        
        // Determine status from payload
        const isSuccess = payload.status == 1 || payload.transaction_status === 'SUCCESS';
        const isFailed = payload.status == 0 || payload.transaction_status === 'FAILED';

        if (isSuccess || isFailed) {
            const txRef = db.collection('transactions').doc(transactionId);
            
            await db.runTransaction(async (t) => {
                const txSnap = await t.get(txRef);
                if (!txSnap.exists) {
                    console.log(`[Moolre Settlement] Transaction ${transactionId} not found.`);
                    return;
                }

                const txData = txSnap.data();
                
                // Process only if not already completed or failed
                if (isSuccess && txData.status !== 'completed') {
                    t.update(txRef, {
                        status: 'completed',
                        moolreSettlementReceived: true,
                        settledAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // Note: walletBalance was already deducted when the transaction was created.
                    if (txData.momoNumber) {
                        await sendSmsAlert(txData.momoNumber, `TrustLink: Your withdrawal of GH₵ ${txData.amount} has been successfully processed and sent to your account.`);
                    }
                    console.log(`[Moolre Settlement] Transaction ${transactionId} marked as completed`);

                } else if (isFailed && txData.status !== 'failed') {
                    t.update(txRef, {
                        status: 'failed',
                        moolreSettlementReceived: true,
                        failedAt: admin.firestore.FieldValue.serverTimestamp(),
                        failureReason: payload.message || 'Moolre payout failed'
                    });

                    // Refund the user's wallet
                    if (txData.userId) {
                        const userRef = db.collection('users').doc(txData.userId);
                        const userSnap = await t.get(userRef);
                        if (userSnap.exists) {
                            const currentBalance = userSnap.data().walletBalance || 0;
                            t.update(userRef, {
                                walletBalance: currentBalance + txData.amount
                            });
                        }
                    }
                    
                    if (txData.momoNumber) {
                        await sendSmsAlert(txData.momoNumber, `TrustLink: Your withdrawal of GH₵ ${txData.amount} failed and has been refunded to your TrustLink wallet.`);
                    }
                    console.log(`[Moolre Settlement] Transaction ${transactionId} marked as failed and refunded`);
                }
            });
        }

        // Return 200 OK so Moolre knows we processed it
        return res.status(200).json({ success: true, message: 'Settlement Webhook processed' });

    } catch (err) {
        console.error("Moolre settlement webhook error:", err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
