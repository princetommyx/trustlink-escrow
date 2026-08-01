const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const fetch = typeof globalThis.fetch === 'function' ? globalThis.fetch : (...args) => import('node-fetch').then(({default: f}) => f(...args));
const twilio = require('twilio');
admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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

        // Attempt to send WhatsApp message if buyerPhone is provided
        if (escrowData.buyerPhone) {
            try {
                const client = getTwilioClient(); // Function defined at bottom of file
                if (client) {
                    const twilioNumber = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+16624904332";
                    const toWhatsAppNumber = escrowData.buyerPhone.startsWith('whatsapp:') ? escrowData.buyerPhone : `whatsapp:${escrowData.buyerPhone}`;
                    const messageBody = `Hello from Trustlink Escrow! 👋\n\nYour transaction (#${escrowRef.id}) is ready for payment. Please use the secure link below to complete it:\n\n${checkoutUrl}`;
                    
                    await client.messages.create({
                        body: messageBody,
                        from: twilioNumber,
                        to: toWhatsAppNumber
                    });
                    console.log(`WhatsApp message sent to ${toWhatsAppNumber}`);
                }
            } catch (twilioError) {
                // We log the error but don't fail the overall escrow creation
                console.error("Failed to send WhatsApp message:", twilioError);
            }
        }

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

// Helper: Normalize Ghana Phone Numbers
function normalizeGhanaPhone(phone) {
    if (!phone) return { local: '', intl: '', raw: '' };
    let clean = phone.replace(/^whatsapp:/i, '').replace(/[^\d+]/g, '');
    let digits = clean.replace(/\+/g, '');
    
    // Normalize to 10-digit local (e.g., 024XXXXXXX)
    let local = digits;
    if (digits.startsWith('233') && digits.length === 12) {
        local = '0' + digits.slice(3);
    } else if (!digits.startsWith('0') && digits.length === 9) {
        local = '0' + digits;
    }

    // Normalize to E.164 international (+233XXXXXXXXX)
    let intl = '+233' + local.slice(1);
    return { local, intl, raw: phone };
}

// Helper: Get or Provision Vendor User
async function getOrCreateVendorByPhone(phoneInfo, profileName = 'WhatsApp Seller') {
    const { local, intl } = phoneInfo;
    
    // Search by local phone or international phone
    let querySnap = await db.collection('users').where('phone', '==', local).limit(1).get();
    if (querySnap.empty) {
        querySnap = await db.collection('users').where('phone', '==', intl).limit(1).get();
    }

    if (!querySnap.empty) {
        return { vendorId: querySnap.docs[0].id, vendorData: querySnap.docs[0].data() };
    }

    // Create guest vendor profile
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

// Helper: Dispatch SMS Notification to Buyer
async function sendBuyerSmsAlert(phone, message) {
    const MOOLRE_API_USER = "sasulabs";
    const MOOLRE_PUBLIC_KEY = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyaWQiOjEwNzgzNCwiZXhwIjoxOTU2NTQ1OTk5fQ.ZPgxaR7PP6FZH5msdXkWSQX6lbjp27mTywLgMhAeaPc";
    const MOOLRE_PRIVATE_KEY = "tDA79UwhA1PLoCsBNXzcmk08qOXNvd25xKVjKPN93i2RVqa1VNoUWN7jXR91v39C";

    try {
        const { local } = normalizeGhanaPhone(phone);
        const ghanaPhone = '233' + local.slice(1);

        await fetch("https://api.moolre.com/open/sms/send", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-USER": MOOLRE_API_USER,
                "X-API-KEY": MOOLRE_PRIVATE_KEY,
                "X-API-PUBKEY": MOOLRE_PUBLIC_KEY
            },
            body: JSON.stringify({
                recipient: ghanaPhone,
                sender: "TrustLink",
                message: message
            })
        });
    } catch (err) {
        console.warn("SMS alert failed:", err);
    }
}

// Meta WhatsApp Cloud API Sender
async function sendMetaWhatsAppMessage(phoneNumberId, to, textBody) {
    const token = process.env.META_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
    const phoneId = phoneNumberId || process.env.META_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;

    if (!token || !phoneId) {
        console.warn("Meta WhatsApp Cloud API credentials not configured in environment (META_ACCESS_TOKEN / META_PHONE_NUMBER_ID).");
        return null;
    }

    let cleanTo = to.replace(/[^0-9]/g, '');
    if (cleanTo.startsWith('0') && cleanTo.length === 10) {
        cleanTo = '233' + cleanTo.substring(1);
    }

    try {
        const response = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: cleanTo,
                type: 'text',
                text: { preview_url: false, body: textBody }
            })
        });
        const data = await response.json();
        if (!response.ok) {
            console.error('Meta WhatsApp API error response:', data);
        } else {
            console.log('Meta WhatsApp message sent successfully:', data);
        }
        return data;
    } catch (err) {
        console.error('Error sending message via Meta WhatsApp Cloud API:', err);
        return null;
    }
}

// Unified Core WhatsApp Bot Engine
async function handleWhatsAppEngine(from, body, profileName) {
    const phoneInfo = normalizeGhanaPhone(from);
    const sessionRef = db.collection('whatsapp_sessions').doc(phoneInfo.local || from);
    const sessionSnap = await sessionRef.get();
    const session = sessionSnap.exists ? sessionSnap.data() : { step: 'IDLE', draft: {} };

    let reply = '';
    const upperBody = body.toUpperCase();

    try {
        // Reset / Cancel command
        if (['CANCEL', 'RESET', 'STOP', 'QUIT'].includes(upperBody)) {
            await sessionRef.set({ step: 'IDLE', draft: {}, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            reply = `❌ *Action Cancelled*\n\nYour previous session has been cleared.\n\nType *MENU* or *HI* to see what you can do!`;
        }
        // Menu / Help commands
        else if (['MENU', 'HI', 'HELLO', 'START', 'HELP', 'COMMANDS', '5'].includes(upperBody) && session.step === 'IDLE') {
            reply = `🛡️ *Welcome to TrustLink Escrow Bot!* 👋\n\nThe secure payment & escrow service for Instagram, TikTok & WhatsApp sellers.\n\n*What would you like to do?*\n\n1️⃣ *NEW* or *CREATE* — Create a new escrow checkout link (guided)\n⚡ *CREATE <Amount> <Item> <Buyer Phone>* — Instant link generation\n   _Example:_ \`CREATE 350 Nike Shoes 0244123456\`\n2️⃣ *STATUS* or *STATUS <EscrowID>* — Track order status\n3️⃣ *SHIP <EscrowID>* — Mark order as shipped\n4️⃣ *BALANCE* — Check your TrustLink wallet\n5️⃣ *HELP* — Show this menu\n\n_Reply with a command or number to get started!_`;
        }
        // Check for 1-Line Fast Create: CREATE <Amount> <Item Name> <Buyer Phone>
        else if (upperBody.startsWith('CREATE ') && session.step === 'IDLE' && upperBody.split(' ').length >= 4) {
            const parts = body.split(/\s+/);
            const amountStr = parts[1];
            const buyerPhoneRaw = parts[parts.length - 1];
            const itemName = parts.slice(2, parts.length - 1).join(' ');

            const amount = parseFloat(amountStr);
            const buyerPhoneInfo = normalizeGhanaPhone(buyerPhoneRaw);

            if (isNaN(amount) || amount <= 0) {
                reply = `⚠️ *Invalid Price*\nPlease provide a valid numeric amount.\n\n*Example:* \`CREATE 350 Nike Jordan Shoes 0244123456\``;
            } else if (!buyerPhoneInfo.local || buyerPhoneInfo.local.length !== 10) {
                reply = `⚠️ *Invalid Buyer Phone Number*\nPlease provide a valid 10-digit Ghanaian phone number (e.g. 0244123456).\n\n*Example:* \`CREATE 350 Nike Jordan Shoes 0244123456\``;
            } else {
                const { vendorId } = await getOrCreateVendorByPhone(phoneInfo, profileName);
                const fee = parseFloat((amount * 0.03).toFixed(2));
                const totalAmount = parseFloat((amount + fee / 2).toFixed(2)); // Default 50/50 split

                const escrowRef = await db.collection('escrows').add({
                    sellerId: vendorId,
                    sellerPhone: phoneInfo.local,
                    buyerPhone: buyerPhoneInfo.local,
                    amount: amount,
                    fee: fee,
                    feeSplit: '50/50',
                    totalAmount: totalAmount,
                    description: itemName,
                    status: 'PENDING_PAYMENT',
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    source: 'whatsapp_bot'
                });

                const checkoutUrl = `https://trustlink.co/checkout.html?id=${escrowRef.id}`;
                
                // Dispatch SMS Alert to Buyer
                sendBuyerSmsAlert(
                    buyerPhoneInfo.local,
                    `TrustLink: ${profileName} has created an escrow order for "${itemName}" (GH₵ ${amount.toFixed(2)}). Pay securely here: ${checkoutUrl}`
                );

                reply = `✅ *Escrow Payment Link Created!*\n\n📦 *Item:* ${itemName}\n💰 *Price:* GH₵ ${amount.toFixed(2)}\n🛡️ *Escrow Fee (3%):* GH₵ ${fee.toFixed(2)} (50/50 Split)\n📱 *Buyer Phone:* ${buyerPhoneInfo.local}\n🆔 *Escrow ID:* \`${escrowRef.id}\`\n\n🔗 *Shareable Checkout Link:*\n${checkoutUrl}\n\n📲 _We've sent an instant SMS to the buyer with payment instructions. You can also copy & paste the link above directly into your DMs!_`;
            }
        }
        // Start Step-by-Step Guided Wizard (1 or NEW or CREATE)
        else if (['1', 'NEW', 'CREATE'].includes(upperBody) && session.step === 'IDLE') {
            await sessionRef.set({
                step: 'AWAITING_ITEM_NAME',
                draft: {},
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            reply = `✨ *Create New Escrow Link (Step 1/4)*\n\n📦 What item or service are you selling?\n_Example: iPhone 13 Pro 128GB, Sneakers, Wig, etc._\n\n_(Type *CANCEL* anytime to stop)_`;
        }
        // Wizard Step 1: Item Name received
        else if (session.step === 'AWAITING_ITEM_NAME') {
            await sessionRef.update({
                step: 'AWAITING_PRICE',
                'draft.item': body,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            reply = `✨ *Step 2/4: Price*\n\n💰 How much are you selling *${body}* for in GH₵?\n_Example: 450_`;
        }
        // Wizard Step 2: Price received
        else if (session.step === 'AWAITING_PRICE') {
            const cleanPrice = parseFloat(body.replace(/[^0-9.]/g, ''));
            if (isNaN(cleanPrice) || cleanPrice <= 0) {
                reply = `⚠️ Please reply with a valid number for the price (e.g. 450).`;
            } else {
                await sessionRef.update({
                    step: 'AWAITING_BUYER_PHONE',
                    'draft.price': cleanPrice,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                reply = `✨ *Step 3/4: Buyer's Phone Number*\n\n📱 What is the buyer's 10-digit mobile number for MoMo SMS notification?\n_Example: 0244123456_`;
            }
        }
        // Wizard Step 3: Buyer Phone received
        else if (session.step === 'AWAITING_BUYER_PHONE') {
            const buyerPhoneInfo = normalizeGhanaPhone(body);
            if (!buyerPhoneInfo.local || buyerPhoneInfo.local.length !== 10) {
                reply = `⚠️ Please enter a valid 10-digit Ghana phone number (e.g. 0244123456 or 0501234567).`;
            } else {
                await sessionRef.update({
                    step: 'AWAITING_FEE_SPLIT',
                    'draft.buyerPhone': buyerPhoneInfo.local,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                reply = `✨ *Step 4/4: TrustLink Escrow Fee (3%)*\n\nWho pays the escrow fee?\n\n1️⃣ *50/50 Split* (Standard - Buyer & Seller share fee)\n2️⃣ *Buyer Pays 100%*\n3️⃣ *Seller Pays 100%*\n\n_Reply 1, 2, or 3:_`;
            }
        }
        // Wizard Step 4: Fee Split & Finalize
        else if (session.step === 'AWAITING_FEE_SPLIT') {
            let feeSplit = '50/50';
            if (['2', 'BUYER'].includes(upperBody)) feeSplit = 'BUYER_PAYS';
            if (['3', 'SELLER'].includes(upperBody)) feeSplit = 'SELLER_PAYS';

            const draft = session.draft || {};
            const amount = draft.price || 0;
            const item = draft.item || 'Item/Service';
            const buyerPhone = draft.buyerPhone || '';

            const { vendorId } = await getOrCreateVendorByPhone(phoneInfo, profileName);
            const fee = parseFloat((amount * 0.03).toFixed(2));
            let totalAmount = amount;
            if (feeSplit === '50/50') totalAmount = parseFloat((amount + fee / 2).toFixed(2));
            if (feeSplit === 'BUYER_PAYS') totalAmount = parseFloat((amount + fee).toFixed(2));

            const escrowRef = await db.collection('escrows').add({
                sellerId: vendorId,
                sellerPhone: phoneInfo.local,
                buyerPhone: buyerPhone,
                amount: amount,
                fee: fee,
                feeSplit: feeSplit,
                totalAmount: totalAmount,
                description: item,
                status: 'PENDING_PAYMENT',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                source: 'whatsapp_bot'
            });

            // Reset session
            await sessionRef.set({ step: 'IDLE', draft: {}, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

            const checkoutUrl = `https://trustlink.co/checkout.html?id=${escrowRef.id}`;
            
            // Dispatch SMS Alert to Buyer
            sendBuyerSmsAlert(
                buyerPhone,
                `TrustLink: ${profileName} created an escrow order for "${item}" (GH₵ ${amount.toFixed(2)}). Pay securely here: ${checkoutUrl}`
            );

            reply = `🎉 *Escrow Order Created Successfully!*\n\n📦 *Item:* ${item}\n💰 *Price:* GH₵ ${amount.toFixed(2)}\n🛡️ *Escrow Fee:* GH₵ ${fee.toFixed(2)} (${feeSplit})\n📱 *Buyer:* ${buyerPhone}\n🆔 *Escrow ID:* \`${escrowRef.id}\`\n\n🔗 *Shareable Checkout Link:*\n${checkoutUrl}\n\n📲 _SMS alert has been dispatched to the buyer!_`;
        }
        // Check Status: 2 or STATUS or STATUS <id>
        else if (upperBody === '2' || upperBody === 'STATUS' || upperBody.startsWith('STATUS ')) {
            const parts = body.split(/\s+/);
            if (parts.length > 1) {
                const escrowId = parts[1];
                const escrowRef = db.collection('escrows').doc(escrowId);
                const escrowSnap = await escrowRef.get();

                if (!escrowSnap.exists) {
                    reply = `⚠️ *Escrow Not Found*\nNo transaction found with ID \`${escrowId}\`.`;
                } else {
                    const esc = escrowSnap.data();
                    const statusIcons = {
                        PENDING_PAYMENT: '⏳ Awaiting Buyer Payment',
                        FUNDS_ESCROWED: '🔒 Funds Secured in Escrow (Ready to Ship)',
                        ITEM_SHIPPED: '🚚 In Transit / Delivery',
                        COMPLETED: '✅ Completed & Funds Released',
                        DISPUTED: '⚠️ Under Dispute Resolution',
                        REFUNDED: '↩️ Refunded to Buyer'
                    };
                    reply = `📋 *Order Status:* \`${escrowId}\`\n\n📦 *Item:* ${esc.description}\n💰 *Amount:* GH₵ ${esc.amount}\n📊 *Status:* ${statusIcons[esc.status] || esc.status}\n📱 *Buyer:* ${esc.buyerPhone || 'N/A'}`;
                }
            } else {
                // List last 3 escrows
                const escrowsSnap = await db.collection('escrows')
                    .where('sellerPhone', '==', phoneInfo.local)
                    .orderBy('createdAt', 'desc')
                    .limit(3)
                    .get();

                if (escrowsSnap.empty) {
                    reply = `📭 You have no active escrow transactions yet. Type *NEW* to create your first one!`;
                } else {
                    let listMsg = `📋 *Your Recent Orders:*\n`;
                    escrowsSnap.forEach(doc => {
                        const d = doc.data();
                        listMsg += `\n▪️ *${d.description}* (GH₵ ${d.amount})\n   Status: ${d.status}\n   ID: \`${doc.id}\`\n`;
                    });
                    listMsg += `\n_Type *STATUS <EscrowID>* for full details or *SHIP <EscrowID>* to mark as dispatched._`;
                    reply = listMsg;
                }
            }
        }
        // Balance check: 4 or BALANCE
        else if (['4', 'BALANCE', 'WALLET'].includes(upperBody)) {
            const { vendorData } = await getOrCreateVendorByPhone(phoneInfo, profileName);
            const balance = (vendorData && vendorData.wallet && vendorData.wallet.balance) || 0;
            const escrowLocked = (vendorData && vendorData.wallet && vendorData.wallet.escrowLocked) || 0;

            reply = `💼 *TrustLink Wallet Summary*\n\n💵 *Available Balance:* GH₵ ${balance.toFixed(2)}\n🔒 *Locked in Escrow:* GH₵ ${escrowLocked.toFixed(2)}\n\n_Log in to trustlink.co/dashboard.html to withdraw funds directly to MoMo._`;
        }
        // Ship Order: 3 or SHIP <id>
        else if (upperBody === '3' || upperBody.startsWith('SHIP')) {
            const parts = body.split(/\s+/);
            if (parts.length < 2) {
                reply = `🚚 *Mark Order as Shipped*\nPlease specify the Escrow ID.\n\n*Format:* \`SHIP <EscrowID>\`\n_Example:_ \`SHIP 8xKgT2mO9P\``;
            } else {
                const escrowId = parts[1];
                const escrowRef = db.collection('escrows').doc(escrowId);
                const escrowSnap = await escrowRef.get();

                if (!escrowSnap.exists) {
                    reply = `⚠️ *Escrow Not Found*\nNo transaction matches ID \`${escrowId}\`.`;
                } else {
                    const esc = escrowSnap.data();
                    if (esc.status === 'PENDING_PAYMENT') {
                        reply = `⚠️ *Cannot Mark as Shipped Yet*\n\nThe buyer has not completed payment for this escrow. Only ship parcels after status is *FUNDS_ESCROWED*.`;
                    } else if (['ITEM_SHIPPED', 'COMPLETED'].includes(esc.status)) {
                        reply = `ℹ️ This order is already marked as *${esc.status}*.`;
                    } else {
                        await escrowRef.update({
                            status: 'ITEM_SHIPPED',
                            shippedAt: admin.firestore.FieldValue.serverTimestamp()
                        });

                        // Dispatch SMS alert to buyer
                        if (esc.buyerPhone) {
                            sendBuyerSmsAlert(
                                esc.buyerPhone,
                                `TrustLink: The seller has marked your order "${esc.description}" as shipped! Please confirm receipt once delivered at: https://trustlink.co/confirm.html?id=${escrowId}`
                            );
                        }

                        reply = `🚚 *Order Marked as Shipped!* ✅\n\n📦 *Item:* ${esc.description}\n🆔 *Escrow ID:* \`${escrowId}\`\n\n📲 _We've alerted the buyer to inspect the parcel upon arrival and confirm receipt._`;
                    }
                }
            }
        }
        // Fallback default
        else {
            reply = `👋 *Hi there!* Type *MENU* to see available options, or *NEW* to create a secure escrow payment link for your buyer.`;
        }
    } catch (botErr) {
        console.error('WhatsApp Bot Error:', botErr);
        reply = `⚠️ Sorry, an error occurred processing your request. Please try again or type *MENU*.`;
    }

    return reply;
}

// Meta Webhook Verification (GET)
app.get(['/webhook/whatsapp', '/v1/webhook/whatsapp', '/webhook/meta'], (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const verifyToken = process.env.META_VERIFY_TOKEN || 'trustlink_meta_webhook_secret_2026';

    if (mode && token) {
        if (mode === 'subscribe' && token === verifyToken) {
            console.log('Meta WhatsApp Webhook verified successfully!');
            return res.status(200).send(challenge);
        } else {
            console.warn('Meta WhatsApp Webhook verification failed. Token mismatch.');
            return res.sendStatus(403);
        }
    }
    return res.status(400).send('Bad Request');
});

// WhatsApp Webhook Endpoint (Supports BOTH Meta Cloud API & Twilio)
app.post(['/webhook/whatsapp', '/v1/webhook/whatsapp', '/webhook/meta'], async (req, res) => {
    // 1. Check if Meta WhatsApp Cloud API Payload
    if (req.body && (req.body.object === 'whatsapp_business_account' || req.body.entry)) {
        res.status(200).send('EVENT_RECEIVED'); // Meta requires immediate 200 OK

        try {
            const entries = req.body.entry || [];
            for (const entry of entries) {
                const changes = entry.changes || [];
                for (const change of changes) {
                    const value = change.value;
                    if (value && value.messages && value.messages.length > 0) {
                        const message = value.messages[0];
                        const from = message.from; // e.g. "233244123456"
                        const phoneNumberId = value.metadata && value.metadata.phone_number_id;
                        
                        let body = '';
                        if (message.type === 'text' && message.text) {
                            body = message.text.body;
                        } else if (message.type === 'button' && message.button) {
                            body = message.button.text;
                        } else if (message.type === 'interactive') {
                            body = (message.interactive.button_reply && message.interactive.button_reply.title) ||
                                   (message.interactive.list_reply && message.interactive.list_reply.title) || '';
                        }

                        const contacts = value.contacts || [];
                        const profileName = (contacts[0] && contacts[0].profile && contacts[0].profile.name) || 'WhatsApp Seller';

                        if (body && from) {
                            const botReply = await handleWhatsAppEngine(from, body, profileName);
                            await sendMetaWhatsAppMessage(phoneNumberId, from, botReply);
                        }
                    }
                }
            }
        } catch (metaErr) {
            console.error('Error handling Meta Cloud API message:', metaErr);
        }
        return;
    }

    // 2. Handle Twilio / Standard Webhook Payload
    const from = req.body.From || req.body.from || '';
    const body = (req.body.Body || req.body.body || '').trim();
    const profileName = req.body.ProfileName || req.body.profileName || 'WhatsApp Seller';

    if (!from) {
        return res.status(400).send('Missing From field');
    }

    const reply = await handleWhatsAppEngine(from, body, profileName);

    // Build TwiML XML Response
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(reply);

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
});

exports.api = functions.https.onRequest(app);
exports.whatsappWebhook = functions.https.onRequest(app);

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

// Twilio Setup
const getTwilioClient = () => {
    const accountSid = process.env.TWILIO_SID;
    const authToken = process.env.TWILIO_TOKEN;
    if (!accountSid || !authToken) {
        console.warn("Twilio credentials not found in environment variables.");
        return null;
    }
    return twilio(accountSid, authToken);
};

/**
 * Example function that gets called when a transaction is created or updated
 * to send the payment link via WhatsApp.
 */
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

    // Format the phone number (Twilio requires the "whatsapp:" prefix and E.164 format)
    const toWhatsAppNumber = buyerPhone.startsWith('whatsapp:') ? buyerPhone : `whatsapp:${buyerPhone}`;

    // Formulate your message
    const messageBody = `Hello from Trustlink Escrow! 👋\n\nYour transaction (#${transactionId}) is ready for payment. Please use the secure link below to complete it:\n\n${paymentLink}`;

    try {
        // Send the message using Twilio
        const message = await client.messages.create({
            body: messageBody,
            from: twilioNumber,
            to: toWhatsAppNumber
        });

        console.log(`Success! WhatsApp message sent with SID: ${message.sid}`);
        return { success: true, messageId: message.sid };

    } catch (error) {
        console.error("Error sending WhatsApp message:", error);
        throw new functions.https.HttpsError('internal', 'Failed to send WhatsApp message.', error.message);
    }
});
