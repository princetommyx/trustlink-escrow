// Removed external dependencies to bypass Vercel ncc bundler crashes

async function sendBuyerSmsAlert(phone, message) {
    try {
        const apiKey = process.env.SASUSYNC_API_KEY;
        if (!apiKey) return;
        const clean = phone.replace(/^whatsapp:/i, '').replace(/[^\d+]/g, '');
        const digits = clean.replace(/\+/g, '');
        let local = digits;
        if (digits.startsWith('233') && digits.length === 12) local = '0' + digits.slice(3);
        else if (!digits.startsWith('0') && digits.length === 9) local = '0' + digits;
        if (!local) return;
        const baseUrl = process.env.SASUSYNC_BASE_URL || 'https://sms.sasusync.com';
        await fetch(`${baseUrl}/api/v1/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ sender: 'TrustLink', recipients: [local], message })
        });
    } catch (e) { console.error('SMS Alert Error:', e); }
}

const handleGetPosPaymentLink = async (data) => {
    const { amount, phone, email } = data;
    if (!amount || (!phone && !email)) throw new Error('Amount and phone/email are required.');
    
    let transactionId = 'TXN-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const posLink = `https://trustlinkgh.online/checkout.html?orderId=${transactionId}`;
    
    if (phone) await sendBuyerSmsAlert(phone, `Pay GHC ${amount} via POS:\n${posLink}`);
    
    return { success: true, paymentLink: posLink, transactionId };
};

const handleCreateMoolreCheckout = async (data) => {
    const { amount, phone, email, metadata } = data;
    if (!amount || (!phone && !email)) throw new Error('Missing amount, phone, or email.');
    
    let transactionId = 'ESCROW-' + Date.now();
    const MOOLRE_PUBLIC_KEY = process.env.MOOLRE_PUBLIC_KEY;
    if (!MOOLRE_PUBLIC_KEY) throw new Error('Moolre keys not configured on server.');

    const payload = {
        amount: parseFloat(amount),
        customer_email: email || 'buyer@trustlink.online',
        customer_phone: phone || '',
        reference: transactionId,
        metadata: metadata || {}
    };

    const response = await fetch('https://api.moolre.com/v1/payments/initialize', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${MOOLRE_PUBLIC_KEY}`
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error('Moolre initialize failed: ' + text);
    }
    const resData = await response.json();
    if (!resData.status) throw new Error('Moolre initialize returned false status.');

    return { checkoutUrl: resData.data.authorization_url, reference: transactionId };
};

const handleVerifyMoolrePayment = async (data) => {
    const { reference } = data;
    if (!reference) throw new Error('Missing payment reference.');

    const MOOLRE_SECRET_KEY = process.env.MOOLRE_SECRET_KEY;
    if (!MOOLRE_SECRET_KEY) throw new Error('Moolre keys not configured.');

    const response = await fetch(`https://api.moolre.com/v1/payments/verify/${reference}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${MOOLRE_SECRET_KEY}` }
    });

    if (!response.ok) throw new Error('Verification request failed.');
    const resData = await response.json();
    return resData;
};

const handleRequestPhoneVerificationOtp = async (data) => {
    return { success: false, message: 'OTP verification via SMS is disabled. Use WhatsApp.' };
};

const handleVerifyPhoneVerificationOtp = async (data, decodedToken) => {
    return { success: false, message: 'OTP verification via SMS is disabled.' };
};

const handleProcessPayout = async (data, decodedToken) => {
    if (!decodedToken) throw new Error('Unauthorized');
    const { amount, bankCode, accountNumber, accountName } = data;
    if (!amount || !bankCode || !accountNumber) throw new Error('Missing payout details');
    return { success: true, transferCode: 'TRF-' + Date.now(), message: 'Payout simulated successfully' };
};

const handleSendPaymentLinkViaWhatsApp = async (data) => {
    throw new Error('WhatsApp sending is currently disabled.');
};

export default async (req, res) => {
    // Manually set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { action, data } = req.body;
    if (!action) return res.status(400).json({ error: 'Missing action in request body.' });

    let decodedToken = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        // Disabled firebase-admin auth temporarily to prevent Vercel crashes
        decodedToken = { uid: 'temporary' }; 
    }

    try {
        let result;
        switch (action) {
            case 'ping': result = { success: true, time: Date.now() }; break;
            case 'getPosPaymentLink': result = await handleGetPosPaymentLink(data); break;
            case 'createMoolreCheckout': result = await handleCreateMoolreCheckout(data); break;
            case 'verifyMoolrePayment': result = await handleVerifyMoolrePayment(data); break;
            case 'requestPhoneVerificationOtp': result = await handleRequestPhoneVerificationOtp(data); break;
            case 'verifyPhoneVerificationOtp': result = await handleVerifyPhoneVerificationOtp(data, decodedToken); break;
            case 'processPayout': result = await handleProcessPayout(data, decodedToken); break;
            case 'sendPaymentLinkViaWhatsApp': result = await handleSendPaymentLinkViaWhatsApp(data); break;
            default: return res.status(404).json({ error: 'Action not found.' });
        }
        return res.status(200).json({ data: result });
    } catch (err) {
        console.error(`Error executing action ${action}:`, err);
        return res.status(400).json({ error: err.message });
    }
};
