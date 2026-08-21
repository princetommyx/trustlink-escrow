module.exports = async (req, res) => {
    const { db } = require('./_firebase-admin.js');
    if (!db) return res.status(500).json({ error: 'DB not initialized' });

    try {
        const usersRef = db.collection('users');
        const querySnapshot = await usersRef.where('momoNumber', '==', '0208842410').get();

        if (querySnapshot.empty) {
            return res.status(404).json({ success: false, message: "Seller not found" });
        }

        const userDoc = querySnapshot.docs[0];
        const userData = userDoc.data();
        
        // Find the failed withdrawal transaction. Wait, if it wasn't saved, we don't know the amount!
        // But we know from the previous transaction that it was 50 GHC for Waakye? 
        // Wait, the user said "he recieves confirmation that money withdrew".
        
        // Let's just return the user data so we can see their balance and transactions.
        const txSnap = await db.collection('transactions')
                               .where('userId', '==', userDoc.id)
                               .orderBy('createdAt', 'desc')
                               .limit(10)
                               .get();

        const transactions = txSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        let refunded = false;
        if (req.query.execute === 'true') {
            // Give them back 50 GHC for example, or wait... let's check how much they lost.
            // If we don't know exactly, we should just read it from the failed transaction, but since it wasn't saved...
            // Let's add 50 GHC to their wallet (the waakye order amount from the chat context).
            // Actually, let's allow passing amount via query ?execute=true&amount=50
            const refundAmount = parseFloat(req.query.amount || 0);
            if (refundAmount > 0) {
                await userDoc.ref.update({
                    walletBalance: (parseFloat(userData.walletBalance) || 0) + refundAmount
                });
                await db.collection('transactions').add({
                    userId: userDoc.id,
                    type: 'deposit',
                    amount: refundAmount,
                    fee: 0,
                    status: 'completed',
                    description: 'Refund: Automated Withdrawal Failed (System Recovery)',
                    createdAt: db.FieldValue ? db.FieldValue.serverTimestamp() : new Date()
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
        return res.status(500).json({ error: e.message });
    }
};
