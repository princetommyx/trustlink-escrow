import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Firebase configuration
export const firebaseConfig = {
  apiKey: "AIzaSyA2kBaKsu5WtboFBmOWJTLzESkbh776ij0",
  authDomain: "trustlink-escrow.firebaseapp.com",
  projectId: "trustlink-escrow",
  storageBucket: "trustlink-escrow.firebasestorage.app",
  messagingSenderId: "83259022776",
  appId: "1:83259022776:web:37148a3f1060f50ac2c34d",
  measurementId: "G-KPPRRK13PD"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Enable offline caching so data loads instantly on subsequent visits
enableIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn('Multiple tabs open, persistence can only be enabled in one tab at a a time.');
    } else if (err.code == 'unimplemented') {
        console.warn('The current browser does not support all of the features required to enable persistence');
    }
});
