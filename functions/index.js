const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fetch = typeof globalThis.fetch === 'function' ? globalThis.fetch : (...args) => import('node-fetch').then(({default: f}) => f(...args));
const twilio = require('twilio');
const { defineSecret } = require('firebase-functions/params');

admin.initializeApp();
const db = admin.firestore();
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://www.trustlinkgh.online';

// ------------------------------------------------------------------
// Firebase Secret Manager Bindings (First-Generation Pattern)
// ------------------------------------------------------------------
// SasuSync SMS/OTP Gateway
const SASUSYNC_API_KEY = defineSecret('SASUSYNC_API_KEY');

// Moolre Payment Gateway (USSD, disbursement — NOT SMS)
const MOOLRE_SECRET_KEY = defineSecret('MOOLRE_SECRET_KEY');
const MOOLRE_PUBLIC_KEY = defineSecret('MOOLRE_PUBLIC_KEY');
const MOOLRE_PRIVATE_KEY = defineSecret('MOOLRE_PRIVATE_KEY');
const MOOLRE_API_USER = defineSecret('MOOLRE_API_USER');
const MOOLRE_ACCOUNT_NUMBER = defineSecret('MOOLRE_ACCOUNT_NUMBER');

const allMoolrePaymentSecrets = [
    MOOLRE_SECRET_KEY,
    MOOLRE_PUBLIC_KEY,
    MOOLRE_PRIVATE_KEY,
    MOOLRE_API_USER,
    MOOLRE_ACCOUNT_NUMBER
];

const allSecrets = [
    SASUSYNC_API_KEY,
    ...allMoolrePaymentSecrets
];

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Helper: Get SasuSync API Key with fallback to process.env
function getSasuSyncApiKey() {
    try {
        if (SASUSYNC_API_KEY && typeof SASUSYNC_API_KEY.value === 'function') {
            const v = SASUSYNC_API_KEY.value();
            if (v) return v;
        }
    } catch (_) {}
    return process.env.SASUSYNC_API_KEY || '';
}

// Helper: SHA256 Hash
function hashString(val) {
    return crypto.createHash('sha256').update(String(val || '')).digest('hex');
}

// Helper: Normalize Ghana Phone Numbers
function normalizeGhanaPhone(phone) {
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
}

// Middleware to authenticate via x-api-key header
const authenticateApi = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
        return res.status(401).json({ error: 'Missing x-api-key header' });
    }

    try {
        const usersSnapshot = await db.collection('users').where('apiKey', '==', apiKey).limit(1).get();
        if (usersSnapshot.empty) {
            return res.status(403).json({ error: 'Invalid API Key' });
        }
        req.vendorId = usersSnapshot.docs[0].id;
        req.vendorData = usersSnapshot.docs[0].data();
        next();
    } catch (error) {
        console.error('Auth Error in API middleware');
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
// ------------------------------------------------------------------
// Meta WhatsApp Cloud API Webhook Verification & Receiver
// ------------------------------------------------------------------
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'trustlink_secret_token_2026';

// Meta Webhook Challenge Verification (GET)
app.get(['/webhook/whatsapp', '/api/webhook/whatsapp', '/webhook', '/api/webhook'], (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
        console.log('WhatsApp Webhook verified successfully by Meta');
        return res.status(200).send(challenge);
    } else {
        console.warn('WhatsApp Webhook verification failed. Received token:', token);
        return res.status(403).json({ error: 'Verification token mismatch' });
    }
});

// Meta Webhook Event Notifications (POST)
app.post(['/webhook/whatsapp', '/api/webhook/whatsapp', '/webhook', '/api/webhook'], async (req, res) => {
    const body = req.body;
    
    // Check if this is a WhatsApp API event
    if (body.object === 'whatsapp_business_account' || body.entry) {
        console.log('Received WhatsApp Webhook Event:', JSON.stringify(body, null, 2));
        // Return 200 OK fast to acknowledge receipt to Meta
        return res.status(200).send('EVENT_RECEIVED');
    }

    return res.status(404).send('Not Found');
});

// Create a new Escrow via API
app.post('/v1/escrows', authenticateApi, async (req, res) => {
    const { amount, description, buyerEmail, buyerPhone, deliveryDate, redirectUrl, cancelUrl, customReference } = req.body;

    if (!amount || !description) {
        return res.status(400).json({ error: 'Missing required fields: amount, description' });
    }

    try {
        const escrowData = {
            amount: parseFloat(amount),
            description: description,
            buyerEmail: buyerEmail || '',
            buyerPhone: buyerPhone || '',
            deliveryDate: deliveryDate || '',
            redirectUrl: redirectUrl || '',
            cancelUrl: cancelUrl || '',
            customReference: customReference || '',
            sellerId: req.vendorId,
            sellerEmail: req.vendorData.email || '',
            status: 'PENDING_PAYMENT',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            apiCreated: true
        };

        const escrowRef = await db.collection('escrows').add(escrowData);
        const checkoutUrl = `${APP_BASE_URL}/checkout.html?id=${escrowRef.id}`;

        if (escrowData.buyerPhone) {
            try {
                const client = getTwilioClient();
                if (client) {
                    const twilioNumber = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+16624904332";
                    const toWhatsAppNumber = escrowData.buyerPhone.startsWith('whatsapp:') ? escrowData.buyerPhone : `whatsapp:${escrowData.buyerPhone}`;
                    const messageBody = `TRUSTLINK ESCROW PAYMENT INVOICE\n\nYour escrow payment (ID: ${escrowRef.id}) is ready for checkout.\n\nYour payment remains securely protected in TrustLink Escrow until you receive and verify your order.\n\nPay securely here:\n${checkoutUrl}\n\nProtected by TrustLink Escrow Ghana`;
                    
                    await client.messages.create({
                        body: messageBody,
                        from: twilioNumber,
                        to: toWhatsAppNumber
                    });
                }
            } catch (twilioError) {
                console.error("Failed to send WhatsApp message");
            }
        }

        res.status(201).json({
            id: escrowRef.id,
            status: 'PENDING_PAYMENT',
            checkoutUrl: checkoutUrl,
            customReference: escrowData.customReference
        });
    } catch (error) {
        console.error('Error creating escrow via API');
        res.status(500).json({ error: 'Failed to create escrow' });
    }
});

// Helper: Get or Provision Vendor User
async function getOrCreateVendorByPhone(phoneInfo, profileName = 'WhatsApp Seller') {
    const { local, intl } = phoneInfo;
    
    let querySnap = await db.collection('users').where('phone', '==', local).limit(1).get();
    if (querySnap.empty) {
        querySnap = await db.collection('users').where('phone', '==', intl).limit(1).get();
    }

    if (!querySnap.empty) {
        return { vendorId: querySnap.docs[0].id, vendorData: querySnap.docs[0].data() };
    }

    const newVendorRef = await db.collection('users').add({
        displayName: profileName || 'WhatsApp Seller',
        phone: local,
        intlPhone: intl,
        role: 'seller',
        walletBalance: 0,
        escrowBalance: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'whatsapp_bot'
    });

    const newSnap = await newVendorRef.get();
    return { vendorId: newVendorRef.id, vendorData: newSnap.data() };
}

// Helper: Send Buyer SMS Alert via SasuSync
async function sendBuyerSmsAlert(phone, message) {
    try {
        const apiKey = getSasuSyncApiKey();
        if (!apiKey) return;

        const { local } = normalizeGhanaPhone(phone);
        if (!local) return;

        await fetch("https://sms.sasulabs.me/api/v1/send", {
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
        console.error("SMS notification delivery error");
    }
}

// Export Express API
exports.api = functions.runWith({ secrets: allSecrets }).https.onRequest(app);

// ------------------------------------------------------------------
// Authenticated & Transaction-Scoped Cloud Functions for Moolre Payments
// ------------------------------------------------------------------

/**
 * Server-Side Moolre USSD Payment Creation
 */
exports.createMoolreCheckout = functions.runWith({ secrets: allMoolrePaymentSecrets }).https.onCall(async (data, context) => {
    const { escrowId, buyerPhone, channel } = data || {};
    if (!escrowId || !buyerPhone) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing escrowId or buyerPhone.');
    }

    const escrowRef = db.collection('escrows').doc(escrowId);
    const escrowSnap = await escrowRef.get();
    if (!escrowSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Escrow record not found.');
    }

    const esc = escrowSnap.data();
    if (esc.status !== 'PENDING_PAYMENT') {
        throw new functions.https.HttpsError('failed-precondition', `Escrow is in state ${esc.status}, not PENDING_PAYMENT.`);
    }

    const apiUser = MOOLRE_API_USER.value();
    const privKey = MOOLRE_PRIVATE_KEY.value();
    const accountNum = MOOLRE_ACCOUNT_NUMBER.value();

    if (!apiUser || !privKey || !accountNum) {
        console.error("Missing Moolre secret configuration");
        throw new functions.https.HttpsError('internal', 'Payment gateway configuration error.');
    }

    const { local } = normalizeGhanaPhone(buyerPhone);

    try {
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
        if (!response.ok || resData.status == 0) {
            throw new functions.https.HttpsError('unavailable', resData.message || 'Payment prompt failed.');
        }

        await escrowRef.update({
            moolrePromptTriggered: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, message: 'USSD prompt dispatched to buyer phone.' };
    } catch (err) {
        console.error("USSD Push error");
        throw new functions.https.HttpsError('internal', err.message || 'Failed to dispatch USSD payment.');
    }
});

/**
 * Server-Side Moolre Payment Status Verification
 */
exports.verifyMoolrePayment = functions.runWith({ secrets: allMoolrePaymentSecrets }).https.onCall(async (data, context) => {
    const { escrowId } = data || {};
    if (!escrowId) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing escrowId.');
    }

    const escrowRef = db.collection('escrows').doc(escrowId);
    const escrowSnap = await escrowRef.get();
    if (!escrowSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Escrow record not found.');
    }

    const esc = escrowSnap.data();

    // Idempotency check: If already funded or completed, return current status
    if (['FUNDS_ESCROWED', 'ITEM_SHIPPED', 'COMPLETED'].includes(esc.status)) {
        return { success: true, status: esc.status, paid: true };
    }

    const apiUser = MOOLRE_API_USER.value();
    const privKey = MOOLRE_PRIVATE_KEY.value();

    if (!apiUser || !privKey) {
        throw new functions.https.HttpsError('internal', 'Payment gateway configuration error.');
    }

    try {
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

            // Dispatch SMS alert to seller
            if (esc.sellerPhone) {
                sendBuyerSmsAlert(
                    esc.sellerPhone,
                    `TrustLink: Payment of GH₵ ${esc.amount} for "${esc.description}" has been secured in escrow! Please dispatch the item.`
                );
            }

            return { success: true, status: 'FUNDS_ESCROWED', paid: true };
        }

        return { success: false, status: esc.status, paid: false };
    } catch (err) {
        console.error("Payment verification error");
        throw new functions.https.HttpsError('internal', 'Payment status verification failed.');
    }
});

/**
 * Server-Side OTP Generation & Delivery via SasuSync
 * SasuSync handles code generation, storage, expiry, and attempt limiting.
 */
exports.requestPhoneVerificationOtp = functions.runWith({ secrets: [SASUSYNC_API_KEY] }).https.onCall(async (data, context) => {
    const { phone } = data || {};
    const { local } = normalizeGhanaPhone(phone);
    if (!local || local.length < 10) {
        throw new functions.https.HttpsError('invalid-argument', 'Valid 10-digit Ghanaian phone number required.');
    }

    const apiKey = getSasuSyncApiKey();
    if (!apiKey) {
        throw new functions.https.HttpsError('internal', 'SMS gateway configuration error.');
    }

    const intlPhone = '233' + local.slice(1);

    try {
        const response = await fetch("https://sms.sasulabs.me/otp/generate", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey
            },
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
            // 429 means a code is already pending for this number
            if (response.status === 429) {
                throw new functions.https.HttpsError('resource-exhausted', 'Please wait before requesting another verification code.');
            }
            throw new functions.https.HttpsError('unavailable', resData.detail || 'SMS delivery failed. Please try again.');
        }

        // Store the otp_id for potential status checks (optional)
        if (resData.otp_id) {
            await db.collection('phone_otps').doc(local).set({
                phone: local,
                otpId: resData.otp_id,
                createdAt: Date.now(),
                provider: 'sasusync'
            });
        }

        return { success: true, message: 'Verification OTP sent via SMS.' };
    } catch (err) {
        if (err instanceof functions.https.HttpsError) throw err;
        console.error("OTP delivery error");
        throw new functions.https.HttpsError('internal', 'SMS gateway delivery error.');
    }
});

/**
 * Server-Side OTP Verification via SasuSync
 * SasuSync handles code comparison, attempt limiting, and expiry.
 */
exports.verifyPhoneVerificationOtp = functions.runWith({ secrets: [SASUSYNC_API_KEY] }).https.onCall(async (data, context) => {
    const { phone, otpCode } = data || {};
    const { local } = normalizeGhanaPhone(phone);
    if (!local || !otpCode) {
        throw new functions.https.HttpsError('invalid-argument', 'Phone number and verification code are required.');
    }

    const apiKey = getSasuSyncApiKey();
    if (!apiKey) {
        throw new functions.https.HttpsError('internal', 'SMS gateway configuration error.');
    }

    const intlPhone = '233' + local.slice(1);

    try {
        const response = await fetch("https://sms.sasulabs.me/otp/verify", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey
            },
            body: JSON.stringify({
                number: intlPhone,
                code: otpCode
            })
        });

        const resData = await response.json();

        if (!response.ok || !resData.success || !resData.verified) {
            if (response.status === 429) {
                throw new functions.https.HttpsError('permission-denied', 'Too many failed attempts. Please request a new code.');
            }
            if (response.status === 410 || (resData.detail && resData.detail.includes('expired'))) {
                throw new functions.https.HttpsError('deadline-exceeded', 'Verification code expired. Please request a new code.');
            }
            throw new functions.https.HttpsError('invalid-argument', resData.detail || 'Invalid verification code.');
        }

        // Clean up local OTP tracking doc
        const otpDocRef = db.collection('phone_otps').doc(local);
        await otpDocRef.delete().catch(() => {});

        // Mark user's phone as verified
        if (context.auth && context.auth.uid) {
            await db.collection('users').doc(context.auth.uid).update({
                phone: local,
                phoneVerified: true,
                phoneVerifiedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        return { success: true, verified: true };
    } catch (err) {
        if (err instanceof functions.https.HttpsError) throw err;
        console.error("OTP verification error");
        throw new functions.https.HttpsError('internal', 'Verification service error.');
    }
});

/**
 * Admin Payout Disbursement
 */
exports.processPayout = functions.runWith({ secrets: allMoolrePaymentSecrets }).https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const callerRef = db.collection('users').doc(context.auth.uid);
    const callerSnap = await callerRef.get();
    const callerRole = (callerSnap.exists && callerSnap.data().role) || '';
    
    if (callerRole !== 'admin' && context.auth.token.email !== 'admin@trustlink.com') {
        throw new functions.https.HttpsError('permission-denied', 'Only admin users can process payouts.');
    }

    const { transactionId } = data;
    if (!transactionId) {
        throw new functions.https.HttpsError('invalid-argument', 'The function must be called with a transactionId.');
    }

    const apiUser = MOOLRE_API_USER.value();
    const pubKey = MOOLRE_PUBLIC_KEY.value();
    const privKey = MOOLRE_PRIVATE_KEY.value();
    const accountNum = MOOLRE_ACCOUNT_NUMBER.value();

    if (!apiUser || !pubKey || !privKey || !accountNum) {
        throw new functions.https.HttpsError('internal', 'Moolre secrets not configured.');
    }

    const txRef = db.collection('transactions').doc(transactionId);

    try {
        const result = await db.runTransaction(async (t) => {
            const txSnap = await t.get(txRef);
            if (!txSnap.exists) {
                throw new functions.https.HttpsError('not-found', 'Transaction does not exist.');
            }

            const txData = txSnap.data();
            if (txData.status !== 'pending' || txData.type !== 'withdrawal') {
                throw new functions.https.HttpsError('failed-precondition', 'Transaction is not a pending withdrawal.');
            }

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

            if (!response.ok || moolreData.status == 0) {
                console.error("Moolre Payout Error");
                throw new functions.https.HttpsError('internal', moolreData.message || 'Moolre API payout failed.');
            }

            t.update(txRef, {
                status: 'completed',
                processedAt: admin.firestore.FieldValue.serverTimestamp(),
                processedBy: context.auth.token.email || 'admin',
                moolreReference: moolreData.data ? moolreData.data.reference : null
            });

            return { success: true, message: 'Payout completed successfully.', amount: txData.amount, phone: txData.momoNumber, network: txData.network };
        });

        return result;

    } catch (error) {
        console.error("Error processing payout");
        throw new functions.https.HttpsError('internal', error.message || 'Failed to process payout.');
    }
});

// Twilio Setup Helper
const getTwilioClient = () => {
    const accountSid = process.env.TWILIO_SID;
    const authToken = process.env.TWILIO_TOKEN;
    if (!accountSid || !authToken) {
        return null;
    }
    return twilio(accountSid, authToken);
};

exports.sendPaymentLinkViaWhatsApp = functions.https.onCall(async (data, context) => {
    const { buyerPhone, transactionId, paymentLink } = data;

    if (!buyerPhone || !paymentLink) {
        throw new functions.https.HttpsError(
            'invalid-argument', 
            'The function must be called with a buyerPhone and paymentLink.'
        );
    }

    const client = getTwilioClient();
    if (!client) {
         throw new functions.https.HttpsError('internal', 'Twilio client not configured properly.');
    }

    const twilioNumber = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+16624904332";
    const toWhatsAppNumber = buyerPhone.startsWith('whatsapp:') ? buyerPhone : `whatsapp:${buyerPhone}`;

    const messageBody = `TRUSTLINK ESCROW PAYMENT INVOICE\n\nYour escrow payment (ID: ${transactionId}) is ready for checkout.\n\nYour payment remains securely protected in TrustLink Escrow until you receive and verify your order.\n\nPay securely here:\n${paymentLink}\n\nProtected by TrustLink Escrow Ghana`;

    try {
        const message = await client.messages.create({
            body: messageBody,
            from: twilioNumber,
            to: toWhatsAppNumber
        });

        return { success: true, messageId: message.sid };

    } catch (error) {
        console.error("Error sending WhatsApp message");
        throw new functions.https.HttpsError('internal', 'Failed to send WhatsApp message.');
    }
});
