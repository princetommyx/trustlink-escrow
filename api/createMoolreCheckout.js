const cors = require('cors')({ origin: true });
const { db, normalizeGhanaPhone, admin } = require('./firebase-admin');

module.exports = async (req, res) => {
    // Run cors middleware
    await new Promise((resolve, reject) => {
        cors(req, res, (result) => {
            if (result instanceof Error) return reject(result);
            resolve(result);
        });
    });

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const data = req.body.data || req.body;
    const { escrowId, buyerPhone, channel } = data;
    
    if (!escrowId || !buyerPhone) {
        return res.status(400).json({ error: 'Missing escrowId or buyerPhone.' });
    }

    try {
        const escrowRef = db.collection('escrows').doc(escrowId);
        const escrowSnap = await escrowRef.get();
        if (!escrowSnap.exists) {
            return res.status(404).json({ error: 'Escrow record not found.' });
        }

        const esc = escrowSnap.data();
        if (esc.status !== 'PENDING_PAYMENT') {
            return res.status(400).json({ error: `Escrow is in state ${esc.status}, not PENDING_PAYMENT.` });
        }

        const apiUser = process.env.MOOLRE_API_USER;
        const privKey = process.env.MOOLRE_PRIVATE_KEY;
        const accountNum = process.env.MOOLRE_ACCOUNT_NUMBER;

        if (!apiUser || !privKey || !accountNum) {
            console.error("Missing Moolre secret configuration");
            return res.status(500).json({ error: 'Payment gateway configuration error.' });
        }

        const { local } = normalizeGhanaPhone(buyerPhone);

        const response = await fetch("https://api.moolre.com/open/transact/payment", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-USER': apiUser,
                'X-API-KEY': privKey
            },
            body: JSON.stringify({
                type: 1,
                channel: parseInt(channel || 13),
                currency: "GHS",
                payer: '233' + local.slice(1),
                amount: esc.amount.toString(),
                externalref: escrowId,
                accountnumber: accountNum
            })
        });

        const resData = await response.json();
        if (!response.ok || resData.status == 0) {
            return res.status(503).json({ error: resData.message || 'Payment prompt failed.' });
        }

        await escrowRef.update({
            moolrePromptTriggered: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.status(200).json({ data: { success: true, message: 'USSD prompt dispatched to buyer phone.' } });
    } catch (err) {
        console.error("USSD Push error", err);
        return res.status(500).json({ error: err.message || 'Failed to dispatch USSD payment.' });
    }
};
