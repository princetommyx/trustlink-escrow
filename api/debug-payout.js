'use strict';

// TEMPORARY DEBUG ENDPOINT - DELETE AFTER FIXING
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const MOOLRE_SECRET_KEY  = process.env.MOOLRE_SECRET_KEY;
    const MOOLRE_API_USER    = process.env.MOOLRE_API_USER;
    const MOOLRE_ACCOUNT_NUM = process.env.MOOLRE_ACCOUNT_NUMBER;
    const MOOLRE_PUBLIC_KEY  = process.env.MOOLRE_PUBLIC_KEY;
    const FIXIE_URL          = process.env.FIXIE_URL;

    const envCheck = {
        MOOLRE_SECRET_KEY:  MOOLRE_SECRET_KEY  ? `SET (${MOOLRE_SECRET_KEY.length} chars)` : 'MISSING',
        MOOLRE_API_USER:    MOOLRE_API_USER    ? `SET (${MOOLRE_API_USER.length} chars)`    : 'MISSING',
        MOOLRE_ACCOUNT_NUM: MOOLRE_ACCOUNT_NUM ? `SET (${MOOLRE_ACCOUNT_NUM.length} chars)` : 'MISSING',
        MOOLRE_PUBLIC_KEY:  MOOLRE_PUBLIC_KEY  ? `SET (${MOOLRE_PUBLIC_KEY.length} chars)`  : 'MISSING',
        FIXIE_URL:          FIXIE_URL          ? 'SET' : 'MISSING (proxy not configured)',
    };

    // Build proxy agent if FIXIE_URL is set
    let proxyAgent = null;
    if (FIXIE_URL) {
        try {
            const { HttpsProxyAgent } = require('https-proxy-agent');
            proxyAgent = new HttpsProxyAgent(FIXIE_URL);
        } catch(e) {
            envCheck.FIXIE_URL = 'ERROR loading proxy agent: ' + e.message;
        }
    }

    // Get outbound IP (through proxy if available)
    let serverOutboundIP = 'unknown';
    try {
        const opts = proxyAgent ? { agent: proxyAgent } : {};
        const ipRes = await fetch('https://api.ipify.org?format=json', opts);
        const ipData = await ipRes.json();
        serverOutboundIP = ipData.ip + (proxyAgent ? ' (via Fixie proxy)' : ' (direct - no proxy)');
    } catch(e) {
        serverOutboundIP = 'Could not detect: ' + e.message;
    }

    if (!MOOLRE_SECRET_KEY || !MOOLRE_API_USER || !MOOLRE_ACCOUNT_NUM) {
        return res.status(200).json({ error: 'Missing env vars', envCheck, serverOutboundIP });
    }

    const payload = {
        type: 1,
        amount: 1,
        receiver: '0208842410',
        channel: '6',
        currency: 'GHS',
        accountnumber: MOOLRE_ACCOUNT_NUM,
        externalref: 'DBG-FIXIE-' + Date.now()
    };

    let moolreResult;
    try {
        const opts = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-USER': MOOLRE_API_USER,
                'X-API-KEY':  MOOLRE_SECRET_KEY
            },
            body: JSON.stringify(payload)
        };
        if (proxyAgent) opts.agent = proxyAgent;

        const r = await fetch('https://api.moolre.com/open/transact/transfer', opts);
        const text = await r.text();
        let json;
        try { json = JSON.parse(text); } catch(e) { json = text; }
        moolreResult = { httpStatus: r.status, response: json };
    } catch(e) {
        moolreResult = { error: e.message };
    }

    return res.status(200).json({ envCheck, serverOutboundIP, payloadSent: payload, moolreResult });
};
