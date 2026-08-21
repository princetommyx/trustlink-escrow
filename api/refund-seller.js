module.exports = async (req, res) => {
    try {
        const { db, admin } = require('./_firebase-admin.js');
        if (!db) return res.status(500).json({ error: 'DB not initialized' });
        
        const usersRef = db.collection('users');
        const querySnapshot = await usersRef.where('momoNumber', '==', '0208842410').get();

        if (querySnapshot.empty) {
            return res.status(404).json({ success: false, message: "Seller not found" });
        }

        const userDoc = querySnapshot.docs[0];
        const userData = userDoc.data();
        
        const txSnap = await db.collection('transactions')
                               .where('userId', '==', userDoc.id)
                               .limit(20)
                               .get();

        const transactions = txSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        let refunded = false;
        if (req.query.execute === 'true') {
            const refundAmount = parseFloat(req.query.amount || 0);
            if (refundAmount > 0) {
                await userDoc.ref.update({
                    walletBalance: (parseFloat(userData.walletBalance) || 0) + refundAmount
                });
                const { FieldValue } = require('firebase-admin/firestore');
                await db.collection('transactions').add({
                    userId: userDoc.id,
                    type: 'deposit',
                    amount: refundAmount,
                    fee: 0,
                    status: 'completed',
                    description: 'Refund: Automated Withdrawal Failed (System Recovery)',
                    createdAt: FieldValue.serverTimestamp()
                });
                refunded = true;
            }
        }

        return res.status(200).json({
            success: true,
            user: { id: userDoc.id, walletBalance: userData.walletBalance },
            refunded: refunded,
            transactions: transactions
        });
    } catch (e) {
        console.error("Endpoint Error:", e);
        return res.status(500).json({ error: e.message || String(e), stack: e.stack });
    }
};
