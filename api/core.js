const cors = require('cors')({ origin: true });
const twilio = require('twilio');
const { db, admin, normalizeGhanaPhone, authenticateToken } = require('./_firebase-admin');

// --- Helper Functions ---
const getTwilioClient = () => {
    const accountSid = process.env.TWILIO_SID;
    const authToken = process.env.TWILIO_TOKEN;
    if (!accountSid || !authToken) return null;
    return twilio(accountSid, authToken);
};

async function sendBuyerSmsAlert(phone, message) {
    try {
        const apiKey = process.env.SASUSYNC_API_KEY;
        if (!apiKey) return;

        const { local } = normalizeGhanaPhone(phone);
        if (!local) return;

        const baseUrl = process.env.SASUSYNC_BASE_URL || 'https://sms.sasusync.com';
        await fetch(`${baseUrl}/api/v1/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey
            },
            body: JSON.stringify({
                sender: "TrustEscrow",
                recipients: ['233' + local.slice(1)],
                message: message
            })
        });
    } catch (err) {
        console.error("SMS notification delivery error", err);
    }
}

// --- Route Handlers ---

async function handleGetPosPaymentLink(data) {
    const posLink = process.env.MOOLRE_POS_LINK;
    if (!posLink) throw new Error('POS link not configured on the server.');
    return { success: true, link: posLink };
}

async function handleCreateMoolreCheckout(data) {
    const { escrowId, buyerPhone, channel } = data;
    if (!escrowId || !buyerPhone) throw new Error('Missing escrowId or buyerPhone.');

    const escrowRef = db.collection('escrows').doc(escrowId);
    const escrowSnap = await escrowRef.get();
    if (!escrowSnap.exists) throw new Error('Escrow record not found.');

    const esc = escrowSnap.data();
    if (esc.status !== 'PENDING_PAYMENT') throw new Error(`Escrow is in state ${esc.status}, not PENDING_PAYMENT.`);

    const apiUser = process.env.MOOLRE_API_USER;
    const privKey = process.env.MOOLRE_PRIVATE_KEY;
    const accountNum = process.env.MOOLRE_ACCOUNT_NUMBER;

    if (!apiUser || !privKey || !accountNum) throw new Error('Payment gateway configuration error.');

    const { local } = normalizeGhanaPhone(buyerPhone);

    const response = await fetch("https://api.moolre.com/open/transact/payment", {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-USER': apiUser,
            'X-API-KEY': privKey
        },
        body: JSON.stringify({
            type: 1,
            channel: parseInt(channel || 13),
            currency: "GHS",
            payer: '233' + local.slice(1),
            amount: esc.amount.toString(),
            externalref: escrowId,
            accountnumber: accountNum
        })
    });

    const resData = await response.json();
    if (!response.ok || resData.status == 0) throw new Error(resData.message || 'Payment prompt failed.');

    await escrowRef.update({
        moolrePromptTriggered: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, message: 'USSD prompt dispatched to buyer phone.' };
}

async function handleVerifyMoolrePayment(data) {
    const { escrowId } = data;
    if (!escrowId) throw new Error('Missing escrowId.');

    const escrowRef = db.collection('escrows').doc(escrowId);
    const escrowSnap = await escrowRef.get();
    if (!escrowSnap.exists) throw new Error('Escrow record not found.');

    const esc = escrowSnap.data();
    if (['FUNDS_ESCROWED', 'ITEM_SHIPPED', 'COMPLETED'].includes(esc.status)) {
        return { success: true, status: esc.status, paid: true };
    }

    const apiUser = process.env.MOOLRE_API_USER;
    const privKey = process.env.MOOLRE_PRIVATE_KEY;
    if (!apiUser || !privKey) throw new Error('Payment gateway configuration error.');

    const response = await fetch(`https://api.moolre.com/open/transact/status?externalref=${escrowId}`, {
        method: 'GET',
        headers: {
            'X-API-USER': apiUser,
            'X-API-KEY': privKey
        }
    });

    const resData = await response.json();
    if (response.ok && (resData.status == 1 || resData.transaction_status === 'SUCCESS')) {
        await escrowRef.update({
            status: 'FUNDS_ESCROWED',
            paidAt: admin.firestore.FieldValue.serverTimestamp()
        });
        if (esc.sellerPhone) {
            sendBuyerSmsAlert(esc.sellerPhone, `TrustLink: Payment of GH₵ ${esc.amount} for "${esc.description}" has been secured in escrow! Please dispatch the item.`);
        }
        return { success: true, status: 'FUNDS_ESCROWED', paid: true };
    }
    return { success: false, status: esc.status, paid: false };
}

async function handleRequestPhoneVerificationOtp(data) {
    const { phone } = data;
    const { local } = normalizeGhanaPhone(phone);
    if (!local || local.length < 10) throw new Error('Valid 10-digit Ghanaian phone number required.');

    const apiKey = process.env.SASUSYNC_API_KEY;
    if (!apiKey) throw new Error('SMS gateway configuration error.');

    const intlPhone = '233' + local.slice(1);
    const baseUrl = process.env.SASUSYNC_BASE_URL || 'https://sms.sasusync.com';

    const response = await fetch(`${baseUrl}/otp/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify({
            number: intlPhone,
            sender_id: "TrustEscrow",
            message: "Your TrustLink verification code is %otp_code%. Valid for 5 minutes.",
            medium: "sms",
            otp_type: "numeric",
            expiry: 5,
            length: 6
        })
    });
    const resData = await response.json();
    if (!response.ok || !resData.success) {
        if (response.status === 429) throw new Error('Please wait before requesting another verification code.');
        throw new Error(resData.detail || 'SMS delivery failed. Please try again.');
    }
    if (resData.otp_id) {
        await db.collection('phone_otps').doc(local).set({
            phone: local,
            otpId: resData.otp_id,
            createdAt: Date.now(),
            provider: 'sasusync'
        });
    }
    return { success: true, message: 'Verification OTP sent via SMS.' };
}

async function handleVerifyPhoneVerificationOtp(data, decodedToken) {
    const { phone, otpCode } = data;
    const { local } = normalizeGhanaPhone(phone);
    if (!local || !otpCode) throw new Error('Phone number and verification code are required.');

    const apiKey = process.env.SASUSYNC_API_KEY;
    if (!apiKey) throw new Error('SMS gateway configuration error.');

    const intlPhone = '233' + local.slice(1);
    const baseUrl = process.env.SASUSYNC_BASE_URL || 'https://sms.sasusync.com';

    const response = await fetch(`${baseUrl}/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify({ number: intlPhone, code: otpCode })
    });
    const resData = await response.json();
    if (!response.ok || !resData.success || !resData.verified) {
        if (response.status === 429) throw new Error('Too many failed attempts. Please request a new code.');
        if (response.status === 410 || (resData.detail && resData.detail.includes('expired'))) throw new Error('Verification code expired. Please request a new code.');
        throw new Error(resData.detail || 'Invalid verification code.');
    }

    await db.collection('phone_otps').doc(local).delete().catch(() => {});

    if (decodedToken && decodedToken.uid) {
        await db.collection('users').doc(decodedToken.uid).update({
            phone: local,
            phoneVerified: true,
            phoneVerifiedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }
    return { success: true, verified: true };
}

async function handleProcessPayout(data, decodedToken) {
    if (!decodedToken) throw new Error('Unauthorized');
    const callerRef = db.collection('users').doc(decodedToken.uid);
    const callerSnap = await callerRef.get();
    const callerRole = (callerSnap.exists && callerSnap.data().role) || '';
    if (callerRole !== 'admin' && decodedToken.email !== 'admin@trustlink.com') throw new Error('Only admin users can process payouts.');

    const { transactionId } = data;
    if (!transactionId) throw new Error('The function must be called with a transactionId.');

    const apiUser = process.env.MOOLRE_API_USER;
    const pubKey = process.env.MOOLRE_PUBLIC_KEY;
    const privKey = process.env.MOOLRE_PRIVATE_KEY;
    const accountNum = process.env.MOOLRE_ACCOUNT_NUMBER;
    if (!apiUser || !pubKey || !privKey || !accountNum) throw new Error('Moolre secrets not configured.');

    const txRef = db.collection('transactions').doc(transactionId);
    return await db.runTransaction(async (t) => {
        const txSnap = await t.get(txRef);
        if (!txSnap.exists) throw new Error('Transaction does not exist.');

        const txData = txSnap.data();
        if (txData.status !== 'pending' || txData.type !== 'withdrawal') throw new Error('Transaction is not a pending withdrawal.');

        const response = await fetch("https://api.moolre.com/open/transact/disburse", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-USER': apiUser,
                'X-API-KEY': privKey,
                'X-API-PUBKEY': pubKey
            },
            body: JSON.stringify({
                type: 1, 
                accountnumber: accountNum,
                amount: txData.amount.toString(),
                recipient: txData.momoNumber,
                network: txData.network,
                currency: "GHS",
                externalref: transactionId
            })
        });

        const moolreData = await response.json();
        if (!response.ok || moolreData.status == 0) throw new Error(moolreData.message || 'Moolre API payout failed.');

        t.update(txRef, {
            status: 'completed',
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
            processedBy: decodedToken.email || 'admin',
            moolreReference: moolreData.data ? moolreData.data.reference : null
        });

        return { success: true, message: 'Payout completed successfully.', amount: txData.amount, phone: txData.momoNumber, network: txData.network };
    });
}

async function handleSendPaymentLinkViaWhatsApp(data) {
    const { buyerPhone, transactionId, paymentLink } = data;
    if (!buyerPhone || !paymentLink) throw new Error('Missing buyerPhone and paymentLink.');

    const client = getTwilioClient();
    if (!client) throw new Error('Twilio client not configured properly.');

    const twilioNumber = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+16624904332";
    const toWhatsAppNumber = buyerPhone.startsWith('whatsapp:') ? buyerPhone : `whatsapp:${buyerPhone}`;
    const messageBody = `TRUSTLINK ESCROW PAYMENT INVOICE\n\nYour escrow payment (ID: ${transactionId}) is ready for checkout.\n\nYour payment remains securely protected in TrustLink Escrow until you receive and verify your order.\n\nPay securely here:\n${paymentLink}\n\nProtected by TrustLink Escrow Ghana`;

    const message = await client.messages.create({ body: messageBody, from: twilioNumber, to: toWhatsAppNumber });
    return { success: true, messageId: message.sid };
}

// --- Main Handler ---

module.exports = async (req, res) => {
    await new Promise((resolve, reject) => {
        cors(req, res, (result) => {
            if (result instanceof Error) return reject(result);
            resolve(result);
        });
    });

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { action, data } = req.body;
    if (!action) return res.status(400).json({ error: 'Missing action in request body.' });

    let decodedToken = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const idToken = authHeader.split('Bearer ')[1];
        try { decodedToken = await admin.auth().verifyIdToken(idToken); } 
        catch (e) { console.error('Token verification failed'); }
    }

    try {
        let result;
        switch (action) {
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
