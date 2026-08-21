'use strict';

// Pure CommonJS - no external dependencies needed for payment actions

async function sendBuyerSmsAlert(phone, message) {
    try {
        const apiKey = process.env.SASUSYNC_API_KEY;
        if (!apiKey) return;
        let clean = String(phone).replace(/[^\d]/g, '');
        if (clean.startsWith('233') && clean.length === 12) clean = '0' + clean.slice(3);
        if (!clean) return;
        const baseUrl = process.env.SASUSYNC_BASE_URL || 'https://sms.sasusync.com';
        await fetch(`${baseUrl}/api/v1/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ sender: 'TrustLink', recipients: [clean], message })
        });
    } catch (e) { console.error('SMS Alert Error:', e.message); }
}

async function handleCreateMoolreCheckout(data) {
    const { amount, email, orderId, metadata } = data || {};
    if (!amount) throw new Error('Missing amount.');

    const reference = orderId || ('ESCROW-' + Date.now());

    const MOOLRE_PUBLIC_KEY  = process.env.MOOLRE_PUBLIC_KEY;  // X-API-PUBKEY
    const MOOLRE_API_USER    = process.env.MOOLRE_API_USER;    // X-API-USER
    const MOOLRE_ACCOUNT_NUM = process.env.MOOLRE_ACCOUNT_NUMBER; // accountnumber
    const MOOLRE_EMAIL       = process.env.MOOLRE_MERCHANT_EMAIL || email;

    if (!MOOLRE_PUBLIC_KEY || !MOOLRE_API_USER || !MOOLRE_ACCOUNT_NUM) {
        throw new Error('Payment gateway not fully configured. Contact support.');
    }

    const callbackUrl  = 'https://trustlinkgh.online/api/webhook/moolre';
    const redirectUrl  = `https://trustlinkgh.online/checkout.html?id=${reference}&payment=success`;

    const payload = {
        type: 1,
        amount: String(parseFloat(amount).toFixed(2)),
        email: MOOLRE_EMAIL,
        externalref: reference,
        reusable: '0',
        currency: 'GHS',
        accountnumber: MOOLRE_ACCOUNT_NUM,
        callback: callbackUrl,
        redirect: redirectUrl,
        metadata: [{ escrowId: reference, ...(metadata || {}) }]
    };

    const response = await fetch('https://api.moolre.com/embed/link', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-USER': MOOLRE_API_USER,
            'X-API-PUBKEY': MOOLRE_PUBLIC_KEY
        },
        body: JSON.stringify(payload)
    });

    const text = await response.text();
    let resData;
    try { resData = JSON.parse(text); } catch (e) { throw new Error('Payment gateway error: ' + text.slice(0, 300)); }

    // Log full response for debugging
    console.log('[Moolre] status:', response.status, 'body:', JSON.stringify(resData));

    if (!response.ok || resData.status !== 1) {
        const detail = resData.message || resData.error || resData.description || JSON.stringify(resData);
        throw new Error('Moolre: ' + detail);
    }

    return { checkoutUrl: resData.data.authorization_url, reference };
}

async function handleSendUssdPush(data) {
    const { phone, amount, network, orderId, otpcode } = data || {};
    if (!phone) throw new Error('Phone number is required for USSD push.');
    if (!amount)  throw new Error('Amount is required.');

    const reference = orderId || ('ESCROW-' + Date.now());

    const MOOLRE_API_USER = process.env.MOOLRE_API_USER;
    const MOOLRE_PUBKEY   = process.env.MOOLRE_PUBLIC_KEY;
    const MOOLRE_ACCOUNT  = process.env.MOOLRE_ACCOUNT_NUMBER;

    if (!MOOLRE_API_USER || !MOOLRE_PUBKEY || !MOOLRE_ACCOUNT) {
        throw new Error('USSD push not configured. Contact support.');
    }

    // Normalize phone to local 10-digit format (e.g. 0551234567)
    let cleanPhone = String(phone).replace(/[^\d]/g, '');
    if (cleanPhone.startsWith('233') && cleanPhone.length === 12) cleanPhone = '0' + cleanPhone.slice(3);

    // Map network to Moolre channel IDs
    const net = (network || 'MTN').toUpperCase();
    let channelId = '13'; // Default to MTN
    if (net.includes('TELECEL') || net.includes('VODAFONE')) channelId = '6';
    if (net.includes('AIRTEL') || net.includes('TIGO') || net.includes('AT')) channelId = '7';

    const payload = {
        type: 1,
        channel: channelId,
        currency: 'GHS',
        payer: cleanPhone,
        amount: String(parseFloat(amount).toFixed(2)),
        externalref: reference,
        accountnumber: MOOLRE_ACCOUNT
    };

    if (otpcode) {
        payload.otpcode = otpcode;
    }

    const response = await fetch('https://api.moolre.com/open/transact/payment', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-USER': MOOLRE_API_USER,
            'X-API-PUBKEY': MOOLRE_PUBKEY
        },
        body: JSON.stringify(payload)
    });

    const text = await response.text();
    let resData;
    try { resData = JSON.parse(text); } catch (e) { throw new Error('USSD push error: ' + text.slice(0, 300)); }

    console.log('[Moolre USSD] status:', response.status, 'body:', JSON.stringify(resData));

    if (!response.ok || (resData.status !== 1 && resData.status !== true && resData.status !== 'success')) {
        const detail = resData.message || resData.error || resData.description || JSON.stringify(resData);
        throw new Error('USSD push failed: ' + detail);
    }

    // resData.data usually contains a transaction/reference UUID on success
    return { 
        sent: true, 
        reference: typeof resData.data === 'string' ? resData.data : reference, 
        message: resData.message || 'Prompt sent successfully.',
        code: resData.code
    };
}

async function handleVerifyMoolrePayment(data) {
    const { reference } = data || {};
    if (!reference) throw new Error('Missing payment reference.');

    const MOOLRE_SECRET_KEY = process.env.MOOLRE_SECRET_KEY;
    const MOOLRE_API_USER   = process.env.MOOLRE_API_USER;
    if (!MOOLRE_SECRET_KEY || !MOOLRE_API_USER) throw new Error('Payment gateway not configured.');

    const response = await fetch(`https://api.moolre.com/embed/verify/${encodeURIComponent(reference)}`, {
        headers: {
            'X-API-USER': MOOLRE_API_USER,
            'X-API-KEY': MOOLRE_SECRET_KEY
        }
    });

    const text = await response.text();
    let resData;
    try { resData = JSON.parse(text); } catch (e) { throw new Error('Verification error: ' + text.slice(0, 200)); }
    if (!response.ok) throw new Error(resData.message || 'Verification failed.');
    return resData;
}

async function handleGetPosPaymentLink(data) {
    const { amount, phone, email } = data || {};
    if (!amount || (!phone && !email)) throw new Error('Amount and contact info are required.');
    const transactionId = 'TXN-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const posLink = `https://trustlinkgh.online/checkout.html?orderId=${transactionId}`;
    if (phone) await sendBuyerSmsAlert(phone, `Pay GHC ${amount} via TrustLink:\n${posLink}`);
    return { success: true, paymentLink: posLink, transactionId };
}

async function handleProcessPayout(data) {
    const { amount, bankCode, accountNumber } = data || {};
    if (!amount || !bankCode || !accountNumber) throw new Error('Missing payout details.');
    
    const MOOLRE_SECRET_KEY = process.env.MOOLRE_SECRET_KEY;
    const MOOLRE_API_USER   = process.env.MOOLRE_API_USER;
    const MOOLRE_ACCOUNT_NUM = process.env.MOOLRE_ACCOUNT_NUMBER;
    
    if (!MOOLRE_SECRET_KEY || !MOOLRE_API_USER) {
        return { success: false, message: 'Payout API credentials missing on server.' };
    }

    let channel = '1'; // Default MTN
    if (bankCode === 'VODAFONE' || bankCode === 'TELECEL') channel = '6';
    else if (bankCode === 'TIGO' || bankCode === 'AIRTELTIGO' || bankCode === 'AT') channel = '7';

    try {
        const payload = {
            type: 1,
            amount: parseFloat(amount),
            receiver: accountNumber,
            channel: channel,
            currency: 'GHS',
            accountnumber: MOOLRE_ACCOUNT_NUM,
            externalref: 'WD-' + Date.now() + '-' + Math.floor(Math.random() * 1000)
        };

        console.log("Sending Moolre Payout:", payload);

        const response = await fetch('https://api.moolre.com/open/transact/transfer', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-USER': MOOLRE_API_USER,
                'X-API-KEY': MOOLRE_SECRET_KEY
            },
            body: JSON.stringify(payload)
        });

        const text = await response.text();
        let resData;
        try { resData = JSON.parse(text); } catch(e) { throw new Error("Invalid response from Moolre: " + text.slice(0, 100)); }

        if (!response.ok || resData.status === 0 || resData.code === 'AIN01') {
            console.error("Moolre Payout Failed:", resData);
            return { success: false, message: resData.message || 'Payout failed at gateway' };
        }

        return { success: true, transferCode: resData.data?.reference || payload.externalref, message: 'Payout initiated successfully.' };
    } catch(err) {
        console.error("Moolre Payout Error:", err.message);
        return { success: false, message: err.message };
    }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const body = req.body || {};
    const { action, data } = body;
    if (!action) return res.status(400).json({ error: 'Missing action.' });

    try {
        let result;
        switch (action) {
            case 'ping':
                result = { success: true, time: Date.now() };
                break;
            case 'getPosPaymentLink':
                result = await handleGetPosPaymentLink(data);
                break;
            case 'createMoolreCheckout':
                result = await handleCreateMoolreCheckout(data);
                break;
            case 'sendUssdPush':
                result = await handleSendUssdPush(data);
                break;
            case 'verifyMoolrePayment':
                result = await handleVerifyMoolrePayment(data);
                break;
            case 'processPayout':
                result = await handleProcessPayout(data);
                break;
            case 'sendPaymentLinkViaWhatsApp':
                result = { success: false, message: 'WhatsApp is temporarily disabled.' };
                break;
            case 'requestPhoneVerificationOtp':
            case 'verifyPhoneVerificationOtp':
                result = { success: false, message: 'OTP via SMS is disabled.' };
                break;
            default:
                return res.status(404).json({ error: `Unknown action: ${action}` });
        }
        return res.status(200).json({ data: result });
    } catch (err) {
        console.error(`[core] ${action} error:`, err.message);
        return res.status(400).json({ error: err.message });
    }
};
