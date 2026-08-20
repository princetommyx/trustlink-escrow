'use strict';
const admin = require('firebase-admin');

if (!admin.apps.length) {
    try {
        let key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '';
        if (key.includes('\\n')) key = key.replace(/\\n/g, '\n');
        if (key && !key.startsWith('{')) {
            try { key = Buffer.from(key, 'base64').toString('utf8'); } catch(e) {}
        }
        const cred = key ? admin.credential.cert(JSON.parse(key)) : admin.credential.applicationDefault();
        admin.initializeApp({ credential: cred });
    } catch (err) {
        console.error('[firebase-admin] init error:', err.message);
    }
}

const db = admin.apps.length ? admin.firestore() : null;

function normalizeGhanaPhone(phone) {
    if (!phone) return { local: '', intl: '' };
    let digits = String(phone).replace(/[^\d]/g, '');
    if (digits.startsWith('233') && digits.length === 12) digits = '0' + digits.slice(3);
    if (!digits.startsWith('0') && digits.length === 9) digits = '0' + digits;
    return { local: digits, intl: '+233' + digits.slice(1) };
}

module.exports = { admin, db, normalizeGhanaPhone };
