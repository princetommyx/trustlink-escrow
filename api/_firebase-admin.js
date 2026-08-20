import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

let app;
let initError = null;

if (!admin.apps.length) {
    try {
        if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
            let keyString = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
            if (keyString.includes('\\n')) keyString = keyString.replace(/\\n/g, '\n');
            if (!keyString.startsWith('{')) {
                try { keyString = Buffer.from(keyString, 'base64').toString('utf8'); } catch(e) {}
            }
            const serviceAccount = JSON.parse(keyString);
            app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        } else {
            app = admin.initializeApp();
        }
    } catch (error) {
        initError = error;
        console.error('Firebase admin initialization error:', error.message);
    }
} else {
    app = admin.apps[0];
}

const getDb = () => {
    if (initError) throw new Error("Firebase Admin failed to initialize: " + initError.message);
    return admin.firestore();
};

const getAuthService = () => {
    if (initError) throw new Error("Firebase Admin failed to initialize: " + initError.message);
    return admin.auth();
};

const db = new Proxy({}, { get: (target, prop) => getDb()[prop] });

const authenticateToken = async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized: No token provided' });
        return null;
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        return await getAuthService().verifyIdToken(idToken);
    } catch (error) {
        res.status(403).json({ error: 'Unauthorized: Invalid token' });
        return null;
    }
};

const normalizeGhanaPhone = (phone) => {
    if (!phone) return { local: '', intl: '', raw: '' };
    let clean = phone.replace(/^whatsapp:/i, '').replace(/[^\d+]/g, '');
    let digits = clean.replace(/\+/g, '');
    let local = digits;
    if (digits.startsWith('233') && digits.length === 12) local = '0' + digits.slice(3);
    else if (!digits.startsWith('0') && digits.length === 9) local = '0' + digits;
    return { local, intl: '+233' + local.slice(1), raw: phone };
};

export { admin, db, authenticateToken, normalizeGhanaPhone };
