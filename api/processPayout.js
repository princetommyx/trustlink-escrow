const cors = require('cors')({ origin: true });
const { db, admin, authenticateToken } = require('./firebase-admin');

module.exports = async (req, res) => {
    await new Promise((resolve, reject) => {
        cors(req, res, (result) => {
            if (result instanceof Error) return reject(result);
            resolve(result);
        });
    });

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const decodedToken = await authenticateToken(req, res);
    if (!decodedToken) return; // Response is already sent by authenticateToken on error

    try {
        const callerRef = db.collection('users').doc(decodedToken.uid);
        const callerSnap = await callerRef.get();
        const callerRole = (callerSnap.exists && callerSnap.data().role) || '';
        
        if (callerRole !== 'admin' && decodedToken.email !== 'admin@trustlink.com') {
            return res.status(403).json({ error: 'Only admin users can process payouts.' });
        }

        const data = req.body.data || req.body;
        const { transactionId } = data;
        
        if (!transactionId) {
            return res.status(400).json({ error: 'The function must be called with a transactionId.' });
        }

        const apiUser = process.env.MOOLRE_API_USER;
        const pubKey = process.env.MOOLRE_PUBLIC_KEY;
        const privKey = process.env.MOOLRE_PRIVATE_KEY;
        const accountNum = process.env.MOOLRE_ACCOUNT_NUMBER;

        if (!apiUser || !pubKey || !privKey || !accountNum) {
            return res.status(500).json({ error: 'Moolre secrets not configured.' });
        }

        const txRef = db.collection('transactions').doc(transactionId);

        const result = await db.runTransaction(async (t) => {
            const txSnap = await t.get(txRef);
            if (!txSnap.exists) {
                throw new Error('Transaction does not exist.');
            }

            const txData = txSnap.data();
            if (txData.status !== 'pending' || txData.type !== 'withdrawal') {
                throw new Error('Transaction is not a pending withdrawal.');
            }

            const response = await fetch("https://api.moolre.com/open/transact/disburse", {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-USER': apiUser,
                    'X-API-KEY': privKey,
                    'X-API-PUBKEY': pubKey
                },
                body: JSON.stringify({
                    type: 1, 
                    accountnumber: accountNum,
                    amount: txData.amount.toString(),
                    recipient: txData.momoNumber,
                    network: txData.network,
                    currency: "GHS",
                    externalref: transactionId
                })
            });

            const moolreData = await response.json();

            if (!response.ok || moolreData.status == 0) {
                console.error("Moolre Payout Error", moolreData);
                throw new Error(moolreData.message || 'Moolre API payout failed.');
            }

            t.update(txRef, {
                status: 'completed',
                processedAt: admin.firestore.FieldValue.serverTimestamp(),
                processedBy: decodedToken.email || 'admin',
                moolreReference: moolreData.data ? moolreData.data.reference : null
            });

            return { success: true, message: 'Payout completed successfully.', amount: txData.amount, phone: txData.momoNumber, network: txData.network };
        });

        return res.status(200).json({ data: result });
    } catch (error) {
        console.error("Error processing payout", error);
        return res.status(500).json({ error: error.message || 'Failed to process payout.' });
    }
};
