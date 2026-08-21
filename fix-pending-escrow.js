const { initializeApp, getApps, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

async function fixEscrow() {
    try {
        let app;
        if (!getApps().length) {
            app = initializeApp();
        } else {
            app = getApps()[0];
        }
        
        const db = getFirestore(app);
        
        const escrowRef = db.collection('escrows').doc('OyjDHvTdGlQreJ9CcGdE');
        const doc = await escrowRef.get();
        if (!doc.exists) {
            console.log("No such document!");
            return;
        }
        
        console.log("Current status:", doc.data().status);
        console.log("Description:", doc.data().description);
        
        await escrowRef.update({
            status: 'FUNDS_ESCROWED',
            paidAt: FieldValue.serverTimestamp(),
            moolreWebhookReceived: true
        });
        
        console.log("Updated escrow successfully to FUNDS_ESCROWED!");
        process.exit(0);
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}

fixEscrow();
