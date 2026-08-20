import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

let app;
let initError = null;

if (!getApps().length) {
    try {
        if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
            // Provided in Vercel settings as a JSON string
            let keyString = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
            
            // Handle escaped newlines if passed via certain CLI tools
            if (keyString.includes('\\n')) {
                keyString = keyString.replace(/\\n/g, '\n');
            }

            // Fallback for base64 encoded strings
            if (!keyString.startsWith('{')) {
                try {
                    keyString = Buffer.from(keyString, 'base64').toString('utf8');
                } catch(e) {}
            }

            const serviceAccount = JSON.parse(keyString);
            app = initializeApp({
                credential: cert(serviceAccount)
            });
            console.log("Firebase Admin initialized successfully using service account.");
        } else {
            // Fallback (might fail in Vercel without proper env vars)
            app = initializeApp();
            console.log("Firebase Admin initialized successfully using default credentials.");
        }
    } catch (error) {
        initError = error;
        console.error('Firebase admin initialization error:', error.message);
    }
} else {
    app = getApps()[0];
}

// Defer initialization of db and auth so the module doesn't crash on import
// if the Firebase app failed to initialize due to invalid credentials.
const getDb = () => {
    if (initError) throw new Error("Firebase Admin failed to initialize: " + initError.message);
    return getFirestore();
};

const getAuthService = () => {
    if (initError) throw new Error("Firebase Admin failed to initialize: " + initError.message);
    return getAuth();
};

const admin = {
    firestore: getDb,
    auth: getAuthService,
    credential: { cert }
};

// Proxy db to call getDb() under the hood, or just export it as a proxy
const db = new Proxy({}, {
    get: (target, prop) => {
        return getDb()[prop];
    }
});

// Helper to authenticate user from Authorization Header (Bearer Token)
const authenticateToken = async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized: No token provided' });
        return null;
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await getAuthService().verifyIdToken(idToken);
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
