import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyA2kBaKsu5WtboFBmOWJTLzESkbh776ij0",
  authDomain: "trustlink-escrow.firebaseapp.com",
  projectId: "trustlink-escrow",
  storageBucket: "trustlink-escrow.firebasestorage.app",
  messagingSenderId: "83259022776",
  appId: "1:83259022776:web:37148a3f1060f50ac2c34d"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function fixEscrow() {
    try {
        const escrowRef = doc(db, 'escrows', 'OyjDHvTdGIQreJ9CcGdE');
        const escrowSnap = await getDoc(escrowRef);
        if (!escrowSnap.exists()) {
            console.log("No such document!");
            return;
        }
        
        console.log("Current status:", escrowSnap.data().status);
        console.log("Description:", escrowSnap.data().description);
        
        await updateDoc(escrowRef, {
            status: 'FUNDED',
            paidAt: serverTimestamp(),
            moolreWebhookReceived: true
        });
        
        console.log("Updated escrow successfully to FUNDED!");
        process.exit(0);
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}

fixEscrow();
