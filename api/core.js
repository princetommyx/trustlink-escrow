'use strict';

// Pure CommonJS - no external dependencies needed for payment actions

const { db, admin } = require('./_firebase-admin.js');

// ---------------------------------------------------------------------
// Shared server-side helpers for financial state transitions.
// Firestore Security Rules deny clients from writing wallet balances or
// jumping an escrow straight to a funded/completed state (see
// firestore.rules + docs/SECURITY_SETUP.md: "Client applications can never
// directly alter user wallet balances"). Everything that moves money or
// finalizes an escrow's state therefore happens here, using the Admin SDK,
// never via a client-side updateDoc().
// ---------------------------------------------------------------------

const ESCROW_STATES = {
    PENDING_PAYMENT: 'PENDING_PAYMENT',
    FUNDS_ESCROWED: 'FUNDS_ESCROWED',
    DISPATCHED: 'DISPATCHED',
    ITEM_SHIPPED: 'ITEM_SHIPPED',
    COMPLETED: 'COMPLETED',
    DISPUTED: 'DISPUTED',
    REFUNDED: 'REFUNDED'
};

// Mirrors moolre-service.js's computeFeeSplit() (client-side pure helper).
// Duplicated here because api/core.js is CommonJS and moolre-service.js is
// an ES module meant for the browser; the math itself must stay identical.
function computeFeeSplit(amount, feePercent = 1.5, allocation = 'split') {
    const amt = parseFloat(amount) || 0;
    const pct = (parseFloat(feePercent) || 0) / 100;
    const totalFee = Math.round(amt * pct * 100) / 100;
    let buyerFee = 0, sellerFee = 0;
    if (allocation === 'buyer') buyerFee = totalFee;
    else if (allocation === 'seller') sellerFee = totalFee;
    else {
        buyerFee = Math.round(totalFee / 2 * 100) / 100;
        sellerFee = Math.round((totalFee - buyerFee) * 100) / 100;
    }
    return {
        totalFee,
        buyerFee,
        sellerFee,
        buyerTotal: Math.round((amt + buyerFee) * 100) / 100,
        sellerNet: Math.round((amt - sellerFee) * 100) / 100
    };
}

// Moolre collection channel IDs: 13 = MTN, 6 = Telecel, 7 = AT.
// checkout.html's network <select> already submits the numeric channel id,
// while bots and API callers pass a network name - accept either. The old
// version only string-matched names, so the numeric ids from the UI never
// matched and every push silently went out on the MTN channel.
function resolveMoolreChannel(network) {
    const raw = String(network == null ? '' : network).trim();
    if (/^\d+$/.test(raw)) return raw;

    const net = raw.toUpperCase();
    if (net.includes('TELECEL') || net.includes('VODAFONE')) return '6';
    if (net.includes('AIRTELTIGO') || net.includes('AIRTEL') || net.includes('TIGO') ||
        net === 'AT' || net.startsWith('AT ') || net.startsWith('AT-')) return '7';
    return '13';
}

function detectGhanaNetwork(phone) {
    let digits = String(phone || '').replace(/[^\d]/g, '');
    if (digits.startsWith('233') && digits.length === 12) digits = '0' + digits.slice(3);
    const prefix = digits.slice(0, 3);
    const map = {
        '024': 'MTN', '025': 'MTN', '053': 'MTN', '054': 'MTN', '055': 'MTN', '059': 'MTN',
        '020': 'TELECEL', '050': 'TELECEL',
        '026': 'AT', '027': 'AT', '056': 'AT', '057': 'AT', '028': 'AT'
    };
    return { local: digits.length === 10 ? digits : '', network: map[prefix] || null };
}

async function sendServerSms(phone, message) {
    try {
        const apiKey = process.env.SASUSYNC_API_KEY;
        if (!apiKey || !phone) return;
        let local = String(phone).replace(/[^\d]/g, '');
        if (local.startsWith('233') && local.length === 12) local = '0' + local.slice(3);
        await fetch(`${process.env.SASUSYNC_BASE_URL || 'https://sms.sasusync.com'}/api/v1/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
            body: JSON.stringify({ sender: 'TrustLink', recipients: [local], message })
        });
    } catch (e) { console.error('SMS:', e.message); }
}

async function writeAuditLog(event, fields) {
    if (!db) return;
    try {
        await db.collection('audit_logs').add({
            event,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            ...fields
        });
    } catch (e) { console.error('Audit log write failed:', e.message); }
}

async function isAdminCaller(decoded) {
    if (!decoded) return false;
    if (decoded.role === 'admin') return true;
    if (decoded.email === 'admin@trustlink.com' || decoded.email === 'trustlinkescrow@gmail.com') return true;
    try {
        const snap = await db.collection('users').doc(decoded.uid).get();
        return snap.exists && snap.data().role === 'admin';
    } catch (e) { return false; }
}

async function verifyCaller(req) {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || !admin.auth) return null;
    try {
        return await admin.auth().verifyIdToken(token);
    } catch (e) {
        return null;
    }
}

// Performs the actual "pay the seller and close the escrow" transaction.
// Shared by the buyer-facing release action and admin dispute resolution.
// `fromStatuses` gates which current escrow states are allowed to transition
// (prevents double-release and out-of-order transitions). When the caller
// supplies a `confirmToken` (confirm.html's single-use SHA-256 link, minted
// by dashboard.js's dispatchItem), it is validated and consumed here - not
// just checked client-side as before. checkout.html's own release button
// has no token to send (same trust level it always had - "possession of the
// escrow ID/link"); that path is unaffected and still protected by the
// state-machine + idempotency checks below.
async function performEscrowRelease(escrowId, fromStatuses, resolvedBy, confirmToken, skipTokenCheck) {
    if (!db) throw new Error('Database not available.');
    const escrowRef = db.collection('escrows').doc(escrowId);

    const result = await db.runTransaction(async (t) => {
        const snap = await t.get(escrowRef);
        if (!snap.exists) throw new Error('Escrow not found.');
        const d = snap.data();

        if (d.status === ESCROW_STATES.COMPLETED) {
            return { performed: false, alreadyCompleted: true, sellerId: d.sellerId };
        }
        if (!fromStatuses.includes(d.status)) {
            throw new Error(`Escrow cannot be released from its current status (${d.status}).`);
        }

        let consumeToken = false;
        if (confirmToken && d.confirmTokenHash && !skipTokenCheck) {
            if (d.confirmTokenUsed) throw new Error('This confirmation link has already been used.');
            if (d.confirmTokenExpiresAt && Date.now() > d.confirmTokenExpiresAt) throw new Error('This confirmation link has expired.');
            const tokenHash = require('crypto').createHash('sha256').update(confirmToken).digest('hex');
            if (tokenHash !== d.confirmTokenHash) throw new Error('Invalid confirmation token.');
            consumeToken = true;
        }

        const fees = computeFeeSplit(d.amount, d.feePercent || 0, d.feeAllocation || 'split');
        const sellerRef = db.collection('users').doc(d.sellerId);
        const sellerSnap = await t.get(sellerRef);

        t.update(escrowRef, {
            status: ESCROW_STATES.COMPLETED,
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...(consumeToken ? { confirmTokenUsed: true } : {}),
            ...(resolvedBy ? { resolvedAt: admin.firestore.FieldValue.serverTimestamp(), resolvedBy } : {})
        });

        let sellerPhone = '';
        if (sellerSnap.exists) {
            const sellerData = sellerSnap.data();
            const currentBalance = parseFloat(sellerData.walletBalance || 0);
            t.update(sellerRef, { walletBalance: currentBalance + fees.sellerNet });
            sellerPhone = sellerData.phone || sellerData.momoNumber || '';
        }

        const txRef = db.collection('transactions').doc();
        t.set(txRef, {
            userId: d.sellerId,
            type: 'deposit',
            amount: fees.sellerNet,
            fee: fees.totalFee,
            status: 'completed',
            description: `Escrow release: ${d.description || escrowId}`,
            escrowId,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return {
            performed: true,
            sellerId: d.sellerId,
            sellerNet: fees.sellerNet,
            sellerPhone,
            description: d.description || ''
        };
    });

    if (result.performed) {
        if (result.sellerPhone) {
            const itemLabel = (result.description || 'your item').replace(/\s+/g, ' ').trim().substring(0, 60);
            sendServerSms(result.sellerPhone, `TrustLink: Payment released for "${itemLabel}". GH₵ ${result.sellerNet.toFixed(2)} has been credited to your TrustLink wallet. Withdraw anytime from your dashboard.`);
        }
        writeAuditLog('ESCROW_RELEASE_CONFIRMED', {
            escrowId, sellerId: result.sellerId, amount: result.sellerNet,
            status: ESCROW_STATES.COMPLETED, actor: resolvedBy ? 'admin' : 'buyer'
        });
    }

    return result;
}

// Atomically transitions PENDING_PAYMENT -> FUNDS_ESCROWED. Does NOT verify
// payment itself - callers (the buyer-facing action below, and both Moolre
// webhooks) must independently confirm success with Moolre's own API first.
// Idempotent: a second call after the transition already happened is a
// harmless no-op, so the buyer-side confirm and the webhook can race safely.
async function markEscrowFundsEscrowed(escrowId, reference) {
    if (!db) throw new Error('Database not available.');
    const escrowRef = db.collection('escrows').doc(escrowId);

    const result = await db.runTransaction(async (t) => {
        const snap = await t.get(escrowRef);
        if (!snap.exists) throw new Error('Escrow not found.');
        const d = snap.data();
        if (d.status === ESCROW_STATES.FUNDS_ESCROWED || d.status === 'FUNDED') {
            return { performed: false };
        }
        if (d.status !== ESCROW_STATES.PENDING_PAYMENT) {
            throw new Error(`Escrow is not awaiting payment (current status: ${d.status}).`);
        }
        t.update(escrowRef, {
            status: ESCROW_STATES.FUNDS_ESCROWED,
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
            moolreReference: reference || ''
        });
        return { performed: true, sellerPhone: d.sellerPhone || '', amount: d.amount, description: d.description || '' };
    });

    if (result.performed) {
        if (result.sellerPhone) {
            sendServerSms(result.sellerPhone, `TrustLink: GH₵${result.amount} secured. Please dispatch "${result.description}".`);
        }
        writeAuditLog('ESCROW_FUNDS_ESCROWED', { escrowId, amount: result.amount, status: ESCROW_STATES.FUNDS_ESCROWED, actor: 'buyer' });
    }

    return result;
}

async function handleConfirmEscrowFundsEscrowed(data) {
    const { escrowId, reference } = data || {};
    if (!escrowId || !reference) throw new Error('Missing escrowId or reference.');

    // Never trust the client's claim that payment succeeded - re-verify
    // directly against Moolre using our server-held secret key.
    const verification = await handleVerifyMoolrePayment({ reference });
    const isVerified = !!(verification && (verification.paid === true || verification.status === 'success' || verification.status === 1));
    if (!isVerified) {
        throw new Error('Payment could not be verified as successful with the payment gateway.');
    }

    await markEscrowFundsEscrowed(escrowId, reference);
    return { success: true, status: ESCROW_STATES.FUNDS_ESCROWED };
}

async function handleReleaseEscrowFunds(data) {
    const { escrowId, confirmToken } = data || {};
    if (!escrowId) throw new Error('Missing escrowId.');
    const result = await performEscrowRelease(escrowId, [ESCROW_STATES.DISPATCHED, ESCROW_STATES.ITEM_SHIPPED], null, confirmToken, false);
    return { success: true, alreadyCompleted: !!result.alreadyCompleted };
}

async function handleRaiseEscrowDispute(data) {
    const { escrowId, reason, confirmToken } = data || {};
    if (!escrowId) throw new Error('Missing escrowId.');
    if (!db) throw new Error('Database not available.');

    const escrowRef = db.collection('escrows').doc(escrowId);
    const validFrom = [ESCROW_STATES.DISPATCHED, ESCROW_STATES.ITEM_SHIPPED, ESCROW_STATES.FUNDS_ESCROWED, 'FUNDED'];

    const result = await db.runTransaction(async (t) => {
        const snap = await t.get(escrowRef);
        if (!snap.exists) throw new Error('Escrow not found.');
        const d = snap.data();
        if (d.status === ESCROW_STATES.DISPUTED) return { performed: false };
        if (!validFrom.includes(d.status)) {
            throw new Error(`Escrow cannot be disputed from its current status (${d.status}).`);
        }

        // Same optional token-gating as release: if the caller supplies
        // confirm.html's single-use token, it must actually match (raising a
        // dispute doesn't consume it, since the buyer may still need it).
        if (confirmToken && d.confirmTokenHash) {
            const tokenHash = require('crypto').createHash('sha256').update(confirmToken).digest('hex');
            if (tokenHash !== d.confirmTokenHash) throw new Error('Invalid confirmation token.');
        }

        t.update(escrowRef, {
            status: ESCROW_STATES.DISPUTED,
            disputedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...(reason ? { disputeReason: String(reason).slice(0, 500) } : {})
        });
        return { performed: true, sellerId: d.sellerId, amount: d.amount };
    });

    if (result.performed) {
        writeAuditLog('ESCROW_DISPUTE_RAISED', { escrowId, sellerId: result.sellerId, amount: result.amount, status: ESCROW_STATES.DISPUTED, actor: 'buyer' });
    }
    return { success: true };
}

async function handleAdminResolveDispute(data, req) {
    const decoded = await verifyCaller(req);
    if (!(await isAdminCaller(decoded))) {
        const err = new Error('Admin authorization required.');
        err.statusCode = 403;
        throw err;
    }

    const { escrowId, resolution } = data || {};
    if (!escrowId || !['RELEASE', 'REFUND'].includes(resolution)) {
        throw new Error('Missing escrowId or invalid resolution (must be RELEASE or REFUND).');
    }
    if (!db) throw new Error('Database not available.');

    const resolvedBy = decoded.email || decoded.uid;

    if (resolution === 'RELEASE') {
        const result = await performEscrowRelease(escrowId, [ESCROW_STATES.DISPUTED, ESCROW_STATES.DISPATCHED, ESCROW_STATES.ITEM_SHIPPED], resolvedBy, null, true);
        return { success: true, alreadyCompleted: !!result.alreadyCompleted };
    }

    // REFUND: the buyer's money never entered a TrustLink wallet (it sits
    // with the payment gateway/merchant account), so refunding means
    // triggering a real Moolre disbursement back to the buyer's mobile
    // money number, not a Firestore balance edit.
    const escrowRef = db.collection('escrows').doc(escrowId);
    const snap = await escrowRef.get();
    if (!snap.exists) throw new Error('Escrow not found.');
    const d = snap.data();
    if (d.status === ESCROW_STATES.REFUNDED) return { success: true, alreadyRefunded: true };
    if (![ESCROW_STATES.DISPUTED, ESCROW_STATES.FUNDS_ESCROWED, 'FUNDED', ESCROW_STATES.DISPATCHED, ESCROW_STATES.ITEM_SHIPPED].includes(d.status)) {
        throw new Error(`Escrow cannot be refunded from its current status (${d.status}).`);
    }

    const { local, network } = detectGhanaNetwork(d.buyerPhone);
    if (!local || !network) {
        throw new Error('Cannot auto-refund: no valid Ghanaian mobile money number on file for the buyer. Process this refund manually with Moolre support.');
    }

    const payout = await handleProcessPayout({ amount: d.amount, bankCode: network, accountNumber: local });
    if (!payout.success) {
        throw new Error('Refund payout failed at the payment gateway: ' + (payout.message || 'Unknown error'));
    }

    await escrowRef.update({
        status: ESCROW_STATES.REFUNDED,
        resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        resolvedBy,
        refundReference: payout.transferCode || ''
    });

    writeAuditLog('ESCROW_REFUNDED', { escrowId, sellerId: d.sellerId, amount: d.amount, status: ESCROW_STATES.REFUNDED, actor: 'admin', resolvedBy });

    return { success: true };
}

// Withdrawals have the same class of bug as escrow release: dashboard.js
// tries updateDoc(users/{uid}, { walletBalance: currentBalance - amount })
// from the client, but firestore.rules excludes walletBalance from the
// fields a user is allowed to write on their own doc (by design - see
// docs/SECURITY_SETUP.md), so that debit is silently rejected for every
// real user. This moves the debit, the Moolre payout, the refund-on-failure,
// and the transaction ledger entry server-side (Admin SDK), atomically.
async function handleRequestWithdrawal(data, req) {
    const decoded = await verifyCaller(req);
    if (!decoded) {
        const err = new Error('You must be signed in to request a withdrawal.');
        err.statusCode = 401;
        throw err;
    }
    if (!db) throw new Error('Database not available.');

    const { amount, phone, network } = data || {};
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) throw new Error('Enter a valid withdrawal amount.');
    if (!phone || !network) throw new Error('A mobile money number and network are required.');

    const userId = decoded.uid;
    const userRef = db.collection('users').doc(userId);

    // 1. Lock the funds: atomically verify sufficient balance and debit it.
    await db.runTransaction(async (t) => {
        const snap = await t.get(userRef);
        if (!snap.exists) throw new Error('User account not found.');
        const currentBalance = parseFloat(snap.data().walletBalance || 0);
        if (amt > currentBalance) {
            throw new Error(`Insufficient balance. You can withdraw up to GH₵ ${currentBalance.toFixed(2)}.`);
        }
        t.update(userRef, { walletBalance: currentBalance - amt });
    });

    // 2. Attempt the real Moolre payout (an external HTTP call - deliberately
    // outside the Firestore transaction above, which must stay side-effect-free).
    const internalTxId = 'WD-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    try {
        const payoutRes = await handleProcessPayout({ amount: amt, bankCode: network, accountNumber: phone });
        if (!payoutRes || !payoutRes.success) {
            throw new Error((payoutRes && payoutRes.message) || 'Payout failed at the payment gateway.');
        }

        await db.collection('transactions').add({
            userId, type: 'withdrawal', amount: amt, fee: 0, status: 'completed',
            description: `Withdrawal to ${phone}`, momoNumber: phone, network,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
            processedBy: 'auto', reference: internalTxId
        });

        return { success: true, reference: internalTxId };
    } catch (payoutError) {
        // 3. Refund: the debit already happened, so undo it on failure.
        await db.runTransaction(async (t) => {
            const snap = await t.get(userRef);
            const latestBal = parseFloat((snap.exists && snap.data().walletBalance) || 0);
            t.update(userRef, { walletBalance: latestBal + amt });
        });

        await db.collection('transactions').add({
            userId, type: 'withdrawal', amount: amt, fee: 0, status: 'failed',
            description: `Failed withdrawal to ${phone}`, momoNumber: phone, network,
            error: payoutError.message,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
            processedBy: 'auto'
        });

        throw new Error(`Withdrawal failed: ${payoutError.message}. Your funds have been refunded to your wallet.`);
    }
}

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

    const channelId = resolveMoolreChannel(network);

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

    // TP14 is not a failure: Moolre has SMSed the payer a verification code and
    // wants the same request resubmitted with `otpcode`. checkout.js has an OTP
    // modal loop waiting on exactly this code - throwing here (as the previous
    // version did for any non-1 status) made that loop unreachable and surfaced
    // a "USSD push failed" alert instead of the verification prompt.
    if (resData.code === 'TP14') {
        return {
            sent: false,
            otpRequired: true,
            code: 'TP14',
            reference,
            message: resData.message || 'A verification code was sent to the payer by SMS.'
        };
    }

    if (!response.ok || (resData.status !== 1 && resData.status !== true && resData.status !== 'success')) {
        const detail = resData.message || resData.error || resData.description || JSON.stringify(resData);
        const err = new Error('USSD push failed: ' + detail);
        err.moolreCode = resData.code || '';
        throw err;
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

        // Route through Fixie static IP proxy using undici ProxyAgent
        const FIXIE_URL = process.env.FIXIE_URL;
        let moolreFetch = fetch;
        let fetchOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-USER': MOOLRE_API_USER,
                'X-API-KEY': MOOLRE_SECRET_KEY
            },
            body: JSON.stringify(payload)
        };
        if (FIXIE_URL) {
            const { fetch: undiciFetch, ProxyAgent } = require('undici');
            moolreFetch = undiciFetch;
            fetchOptions.dispatcher = new ProxyAgent(FIXIE_URL);
        }
        const response = await moolreFetch('https://api.moolre.com/open/transact/transfer', fetchOptions);

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
            case 'confirmEscrowFundsEscrowed':
                result = await handleConfirmEscrowFundsEscrowed(data);
                break;
            case 'releaseEscrowFunds':
                result = await handleReleaseEscrowFunds(data);
                break;
            case 'raiseEscrowDispute':
                result = await handleRaiseEscrowDispute(data);
                break;
            case 'adminResolveDispute':
                result = await handleAdminResolveDispute(data, req);
                break;
            case 'requestWithdrawal':
                result = await handleRequestWithdrawal(data, req);
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
        return res.status(err.statusCode || 400).json({ error: err.message });
    }
};

// Named exports so the Moolre webhook handlers (api/webhook/moolre.js,
// api/webhook/moolre-settlement.js) can independently re-verify a payment
// with Moolre and reuse the same atomic Firestore transition, instead of
// trusting whatever the webhook request body claims.
module.exports.verifyMoolrePayment = handleVerifyMoolrePayment;
module.exports.markEscrowFundsEscrowed = markEscrowFundsEscrowed;
