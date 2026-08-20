'use strict';
let _admin = null, _db = null;
function getFirebase() {
    if (!_admin) {
        _admin = require('firebase-admin');
        if (!_admin.apps.length) {
            try {
                let key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '';
                if (key.includes('\\n')) key = key.replace(/\\n/g, '\n');
                if (key && !key.startsWith('{')) { try { key = Buffer.from(key,'base64').toString('utf8'); } catch(e){} }
                _admin.initializeApp({ credential: key ? _admin.credential.cert(JSON.parse(key)) : _admin.credential.applicationDefault() });
            } catch(e) { console.error('[firebase-admin] init:', e.message); }
        }
        _db = _admin.apps.length ? _admin.firestore() : null;
    }
    return { admin: _admin, db: _db };
}

function normalizePhone(phone) {
    let d = String(phone).replace(/[^\d]/g,'');
    if (d.startsWith('233') && d.length===12) d = '0'+d.slice(3);
    return d;
}

async function sendSms(phone, msg) {
    try {
        const apiKey = process.env.SASUSYNC_API_KEY;
        if (!apiKey||!phone) return;
        const local = normalizePhone(phone);
        await fetch(`${process.env.SASUSYNC_BASE_URL||'https://sms.sasusync.com'}/api/v1/send`, {
            method:'POST', headers:{'Content-Type':'application/json','X-API-Key':apiKey},
            body: JSON.stringify({sender:'TrustLink',recipients:[local],message:msg})
        });
    } catch(e) { console.error('SMS:',e.message); }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin','*');
    if (req.method==='OPTIONS') return res.status(200).end();
    if (req.method!=='POST') return res.status(405).json({error:'Method Not Allowed'});
    try {
        const payload = req.body||{};
        if (!payload.externalref) return res.status(400).json({error:'Missing externalref'});
        const isSuccess = payload.status==1 || payload.transaction_status==='SUCCESS';
        if (isSuccess) {
            const {admin,db} = getFirebase();
            if (db) {
                // Extract original escrowId if reference contains the unique '-P-' suffix
                let docId = payload.externalref;
                if (docId.includes('-P-')) {
                    docId = docId.split('-P-')[0];
                }
                
                const ref = db.collection('escrows').doc(docId);
                const snap = await ref.get();
                if (snap.exists && snap.data().status==='PENDING_PAYMENT') {
                    await ref.update({status:'FUNDS_ESCROWED', paidAt:admin.firestore.FieldValue.serverTimestamp(), moolreWebhookReceived:true});
                    const d = snap.data();
                    if (d.sellerPhone) await sendSms(d.sellerPhone,`TrustLink: GH₵${d.amount} secured. Please dispatch "${d.description}".`);
                }
            }
        }
        return res.status(200).json({success:true});
    } catch(e) { console.error('[moolre webhook]',e.message); return res.status(500).json({error:'Server error'}); }
};
