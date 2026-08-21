import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, where, getDocs, doc, updateDoc, addDoc, getDoc, serverTimestamp } from "firebase/firestore";

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

async function refund() {
    try {
        const txRef = collection(db, 'transactions');
        const q = query(txRef, where('momoNumber', '==', '0208842410'), where('type', '==', 'withdrawal'), where('status', '==', 'completed'));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            console.log("No such transaction found!");
            process.exit(0);
        }
        
        for (const docSnap of querySnapshot.docs) {
            const data = docSnap.data();
            const amount = parseFloat(data.amount);
            console.log("Refunding transaction:", docSnap.id, "amount:", amount);
            
            // Mark transaction as failed
            await updateDoc(docSnap.ref, {
                status: 'failed',
                error: 'Moolre Payout API not configured properly',
                processedAt: serverTimestamp(),
                processedBy: 'system'
            });
            
            // Refund wallet
            const userSnap = await getDoc(doc(db, "users", data.userId));
            if (userSnap.exists()) {
                const latestBal = parseFloat(userSnap.data().walletBalance || 0);
                await updateDoc(doc(db, "users", data.userId), {
                    walletBalance: latestBal + amount
                });
                
                await addDoc(collection(db, "transactions"), {
                    userId: data.userId,
                    type: 'deposit',
                    amount: amount,
                    fee: 0,
                    status: 'completed',
                    description: 'Refund: Automated Withdrawal Failed (API Pending)',
                    createdAt: serverTimestamp()
                });
                console.log("Refund successful for user:", data.userId);
            }
        }
        
        process.exit(0);
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}

refund();
