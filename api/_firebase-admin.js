import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

let app;
if (!getApps().length) {
    try {
        if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
            // Provided in Vercel settings as a JSON string
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
            app = initializeApp({
                credential: cert(serviceAccount)
            });
        } else {
            // Fallback (might fail in Vercel without proper env vars)
            app = initializeApp();
        }
    } catch (error) {
        console.error('Firebase admin initialization error', error.stack);
    }
}

const db = getFirestore();
const auth = getAuth();
// For backwards compatibility in other files that use admin.firestore or admin.auth
const admin = {
    firestore: () => db,
    auth: () => auth,
    credential: { cert }
};

// Helper to authenticate user from Authorization Header (Bearer Token)
const authenticateToken = async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized: No token provided' });
        return null;
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await auth.verifyIdToken(idToken);
        return decodedToken; // contains uid, email, etc.
    } catch (error) {
        console.error('Error verifying auth token', error);
        res.status(403).json({ error: 'Unauthorized: Invalid token' });
        return null;
    }
};

// Helper: Normalize Ghana Phone Numbers
const normalizeGhanaPhone = (phone) => {
    if (!phone) return { local: '', intl: '', raw: '' };
    let clean = phone.replace(/^whatsapp:/i, '').replace(/[^\d+]/g, '');
    let digits = clean.replace(/\+/g, '');

    let local = digits;
    if (digits.startsWith('233') && digits.length === 12) {
        local = '0' + digits.slice(3);
    } else if (!digits.startsWith('0') && digits.length === 9) {
        local = '0' + digits;
    }

    let intl = '+233' + local.slice(1);
    return { local, intl, raw: phone };
};

export { admin, db, authenticateToken, normalizeGhanaPhone };
