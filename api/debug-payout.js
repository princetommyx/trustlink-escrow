'use strict';

// TEMPORARY DEBUG ENDPOINT - DELETE AFTER FIXING
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const MOOLRE_SECRET_KEY  = process.env.MOOLRE_SECRET_KEY;
    const MOOLRE_API_USER    = process.env.MOOLRE_API_USER;
    const MOOLRE_ACCOUNT_NUM = process.env.MOOLRE_ACCOUNT_NUMBER;
    const MOOLRE_PUBLIC_KEY  = process.env.MOOLRE_PUBLIC_KEY;

    // Show which env vars are set (not their values)
    const envCheck = {
        MOOLRE_SECRET_KEY:  MOOLRE_SECRET_KEY  ? `SET (${MOOLRE_SECRET_KEY.length} chars)` : 'MISSING',
        MOOLRE_API_USER:    MOOLRE_API_USER    ? `SET (${MOOLRE_API_USER.length} chars)`    : 'MISSING',
        MOOLRE_ACCOUNT_NUM: MOOLRE_ACCOUNT_NUM ? `SET (${MOOLRE_ACCOUNT_NUM.length} chars)` : 'MISSING',
        MOOLRE_PUBLIC_KEY:  MOOLRE_PUBLIC_KEY  ? `SET (${MOOLRE_PUBLIC_KEY.length} chars)`  : 'MISSING',
    };

    if (!MOOLRE_SECRET_KEY || !MOOLRE_API_USER || !MOOLRE_ACCOUNT_NUM) {
        return res.status(200).json({ error: 'Missing env vars', envCheck });
    }

    const basePayload = {
        type: 1,
        amount: 1,
        receiver: '0208842410',
        channel: '6',
        currency: 'GHS',
        accountnumber: MOOLRE_ACCOUNT_NUM,
    };

    async function tryHeader(headerName) {
        const payload = { ...basePayload, externalref: 'DBG-' + headerName.replace(/[^A-Z]/g,'') + '-' + Date.now() };
        try {
            const r = await fetch('https://api.moolre.com/open/transact/transfer', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-USER': MOOLRE_API_USER,
                    [headerName]: MOOLRE_SECRET_KEY
                },
                body: JSON.stringify(payload)
            });
            const text = await r.text();
            let json;
            try { json = JSON.parse(text); } catch(e) { json = text; }
            return { headerUsed: headerName, httpStatus: r.status, response: json };
        } catch(e) {
            return { headerUsed: headerName, error: e.message };
        }
    }

    // Also try with PUBLIC key using X-API-PUBKEY
    async function tryPubKey() {
        const payload = { ...basePayload, externalref: 'DBG-PUBKEY-' + Date.now() };
        try {
            const r = await fetch('https://api.moolre.com/open/transact/transfer', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-USER': MOOLRE_API_USER,
                    'X-API-PUBKEY': MOOLRE_PUBLIC_KEY
                },
                body: JSON.stringify(payload)
            });
            const text = await r.text();
            let json;
            try { json = JSON.parse(text); } catch(e) { json = text; }
            return { headerUsed: 'X-API-PUBKEY (public key)', httpStatus: r.status, response: json };
        } catch(e) {
            return { headerUsed: 'X-API-PUBKEY', error: e.message };
        }
    }

    const results = await Promise.all([
        tryHeader('X-API-KEY'),
        tryHeader('X-API-PRIKEY'),
        tryHeader('X-API-PRIVATE'),
        tryPubKey()
    ]);

    return res.status(200).json({ envCheck, results });
};
