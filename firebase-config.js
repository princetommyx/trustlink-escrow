import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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
