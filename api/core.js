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
    const { amount, phone, email, orderId } = data || {};
    if (!amount || (!phone && !email)) throw new Error('Missing amount, phone, or email.');

    const reference = orderId || ('ESCROW-' + Date.now());
    const MOOLRE_PUBLIC_KEY = process.env.MOOLRE_PUBLIC_KEY;
    if (!MOOLRE_PUBLIC_KEY) throw new Error('Payment gateway not configured. Contact support.');

    const payload = {
        amount: parseFloat(amount),
        customer_email: email || 'buyer@trustlinkgh.online',
        customer_phone: phone || '',
        reference,
        metadata: data.metadata || {}
    };

    const response = await fetch('https://api.moolre.com/v1/payments/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MOOLRE_PUBLIC_KEY}` },
        body: JSON.stringify(payload)
    });

    const text = await response.text();
    let resData;
    try { resData = JSON.parse(text); } catch (e) { throw new Error('Payment gateway error: ' + text.slice(0, 200)); }
    if (!response.ok || !resData.status) throw new Error(resData.message || 'Payment initialization failed.');

    return { checkoutUrl: resData.data.authorization_url, reference };
}

async function handleVerifyMoolrePayment(data) {
    const { reference } = data || {};
    if (!reference) throw new Error('Missing payment reference.');

    const MOOLRE_SECRET_KEY = process.env.MOOLRE_SECRET_KEY;
    if (!MOOLRE_SECRET_KEY) throw new Error('Payment gateway not configured.');

    const response = await fetch(`https://api.moolre.com/v1/payments/verify/${encodeURIComponent(reference)}`, {
        headers: { 'Authorization': `Bearer ${MOOLRE_SECRET_KEY}` }
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
    return { success: true, transferCode: 'TRF-' + Date.now(), message: 'Payout initiated successfully.' };
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
