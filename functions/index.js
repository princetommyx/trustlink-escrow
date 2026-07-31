const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// Middleware to authenticate via x-api-key header
const authenticateApi = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
        return res.status(401).json({ error: 'Missing x-api-key header' });
    }

    try {
        // Query users collection for this API key
        const usersSnapshot = await db.collection('users').where('apiKey', '==', apiKey).limit(1).get();
        if (usersSnapshot.empty) {
            return res.status(403).json({ error: 'Invalid API Key' });
        }
        req.vendorId = usersSnapshot.docs[0].id;
        req.vendorData = usersSnapshot.docs[0].data();
        next();
    } catch (error) {
        console.error('Auth Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Create a new Escrow
app.post('/v1/escrows', authenticateApi, async (req, res) => {
    const { amount, description, buyerEmail, buyerPhone, deliveryDate, redirectUrl, cancelUrl, customReference } = req.body;

    if (!amount || !description) {
        return res.status(400).json({ error: 'Missing required fields: amount, description' });
    }

    try {
        // The vendor is the seller in B2B API context
        const escrowData = {
            amount: parseFloat(amount),
            description: description,
            buyerEmail: buyerEmail || '',
            buyerPhone: buyerPhone || '',
            deliveryDate: deliveryDate || '',
            redirectUrl: redirectUrl || '',
            cancelUrl: cancelUrl || '',
            customReference: customReference || '', // E.g., WooCommerce order ID
            sellerId: req.vendorId,
            sellerEmail: req.vendorData.email || '',
            status: 'PENDING_PAYMENT',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            apiCreated: true // Flag to identify API-created escrows
        };

        const escrowRef = await db.collection('escrows').add(escrowData);
        
        // Return a checkout URL for the buyer to visit
        const checkoutUrl = `https://trustlink.co/checkout.html?id=${escrowRef.id}`; // Assuming trustlink.co is the domain

        res.status(201).json({
            id: escrowRef.id,
            status: 'PENDING_PAYMENT',
            checkoutUrl: checkoutUrl,
            customReference: escrowData.customReference
        });
    } catch (error) {
        console.error('Error creating escrow:', error);
        res.status(500).json({ error: 'Failed to create escrow' });
    }
});

// Check Escrow Status
app.get('/v1/escrows/:id', authenticateApi, async (req, res) => {
    try {
        const escrowRef = db.collection('escrows').doc(req.params.id);
        const escrowSnap = await escrowRef.get();

        if (!escrowSnap.exists) {
            return res.status(404).json({ error: 'Escrow not found' });
        }

        const escrowData = escrowSnap.data();

        // Verify that this escrow belongs to the authenticated vendor
        if (escrowData.sellerId !== req.vendorId) {
            return res.status(403).json({ error: 'Access denied to this escrow' });
        }

        res.status(200).json({
            id: escrowSnap.id,
            status: escrowData.status,
            amount: escrowData.amount,
            description: escrowData.description,
            customReference: escrowData.customReference || '',
            createdAt: escrowData.createdAt ? escrowData.createdAt.toDate().toISOString() : null
        });
    } catch (error) {
        console.error('Error fetching escrow:', error);
        res.status(500).json({ error: 'Failed to fetch escrow' });
    }
});

exports.api = functions.https.onRequest(app);

// Webhook Dispatcher
exports.onEscrowStatusChange = functions.firestore
    .document('escrows/{escrowId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();
        const escrowId = context.params.escrowId;

        // If status hasn't changed, ignore
        if (before.status === after.status) {
            return null;
        }

        // Only trigger for API-created escrows or vendors with webhooks configured
        const vendorId = after.sellerId;
        if (!vendorId) return null;

        const vendorSnap = await db.collection('users').doc(vendorId).get();
        if (!vendorSnap.exists) return null;

        const vendorData = vendorSnap.data();
        const webhookUrl = vendorData.webhookUrl;

        if (!webhookUrl) {
            return null; // Vendor has not set up a webhook
        }

        // Prepare webhook payload
        const payload = {
            event: 'escrow.status_changed',
            data: {
                id: escrowId,
                status: after.status,
                previousStatus: before.status,
                amount: after.amount,
                customReference: after.customReference || ''
            },
            timestamp: new Date().toISOString()
        };

        try {
            console.log(`Dispatching webhook for escrow ${escrowId} to ${webhookUrl}`);
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-trustlink-signature': vendorData.apiKey // Simple verification header
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                console.warn(`Webhook to ${webhookUrl} failed with status ${response.status}`);
            }
        } catch (error) {
            console.error(`Failed to dispatch webhook to ${webhookUrl}:`, error);
        }

        return null;
    });

// Process Payout (Admin Only)
exports.processPayout = functions.https.onCall(async (data, context) => {
    // 1. Ensure the user is authenticated
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to process payouts.');
    }
    
    // 2. Verify the user's role is 'admin'
    const adminSnap = await db.collection('users').doc(context.auth.uid).get();
    if (!adminSnap.exists || adminSnap.data().role !== 'admin') {
        throw new functions.https.HttpsError('permission-denied', 'Only administrators can process payouts.');
    }

    const { transactionId } = data;
    if (!transactionId) {
        throw new functions.https.HttpsError('invalid-argument', 'Transaction ID is required.');
    }

    const txRef = db.collection('transactions').doc(transactionId);
    
    try {
        const result = await db.runTransaction(async (t) => {
            const txSnap = await t.get(txRef);
            if (!txSnap.exists) {
                throw new functions.https.HttpsError('not-found', 'Transaction not found.');
            }
            
            const txData = txSnap.data();
            if (txData.status !== 'pending' || txData.type !== 'withdrawal') {
                throw new functions.https.HttpsError('failed-precondition', 'Transaction is not a pending withdrawal.');
            }

            // Moolre API Secrets
            // IMPORTANT: In a real production setup, these should be loaded from functions.config() or Secrets Manager
            const MOOLRE_API_USER = "sasulabs";
            const MOOLRE_PUBLIC_KEY = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyaWQiOjEwNzgzNCwiZXhwIjoxOTU2NTQ1OTk5fQ.ZPgxaR7PP6FZH5msdXkWSQX6lbjp27mTywLgMhAeaPc";
            const MOOLRE_PRIVATE_KEY = "tDA79UwhA1PLoCsBNXzcmk08qOXNvd25xKVjKPN93i2RVqa1VNoUWN7jXR91v39C";
            const MOOLRE_ACCOUNT_NUMBER = "10783406072616";

            // Make the payout request to Moolre
            // Using a standard/presumed endpoint for disbursements. Adjust if Moolre documentation specifies a different endpoint.
            const response = await fetch("https://api.moolre.com/open/transact/disburse", {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-USER': MOOLRE_API_USER,
                    'X-API-KEY': MOOLRE_PRIVATE_KEY,
                    'X-API-PUBKEY': MOOLRE_PUBLIC_KEY
                },
                body: JSON.stringify({
                    type: 1, 
                    accountnumber: MOOLRE_ACCOUNT_NUMBER,
                    amount: txData.amount.toString(),
                    recipient: txData.momoNumber,
                    network: txData.network,
                    currency: "GHS",
                    externalref: transactionId
                })
            });

            const moolreData = await response.json();

            if (!response.ok || moolreData.status == 0) {
                console.error("Moolre Payout Error:", moolreData);
                throw new functions.https.HttpsError('internal', moolreData.message || 'Moolre API payout failed.');
            }

            // Payout successful, update the transaction status
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
        console.error("Error processing payout:", error);
        throw new functions.https.HttpsError('internal', error.message || 'Failed to process payout.');
    }
});
