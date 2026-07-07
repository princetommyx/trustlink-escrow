// moolre-service.js

// WARNING: In a real production application, these keys MUST be hidden on a backend server.
// They are exposed here strictly for MVP/Prototype demonstration purposes.
export const MOOLRE_SECRET_KEY = "dcef1bbe-49aa-4416-8934-b9983a3c42a2";
export const MOOLRE_PUBLIC_KEY = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyaWQiOjEwOTIzMiwiZXhwIjoxOTU2NTQ1OTk5fQ.RvCuvZoYLSLl2BqqwoKDDg_55N3Xj0elQHp5pc44Pns";
export const MOOLRE_PRIVATE_KEY = "dZGZS7cYLxCjWRyAwy3g4J2GFuqFkkQL2DG0ZTbQFIkNaX50M6B46qzEzsmrqa8F";
export const MOOLRE_API_URL = "https://api.moolre.com/v1/checkout"; // Standardized checkout endpoint

/**
 * Sends a One-Time Password (OTP) via Moolre SMS API.
 * @param {string} phone - The recipient's phone number.
 * @param {string} otp - The OTP code to send.
 */
export async function sendMoolreOTP(phone, otp) {
    try {
        console.log(`[MOOLRE API] Sending OTP ${otp} to ${phone}`);
        // Remove any '+' or spaces for the API if necessary
        const cleanPhone = phone.replace(/[^0-9]/g, '');

        const response = await fetch("https://api.moolre.com/open/sms/send", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-VASKEY': MOOLRE_VAS_KEY
            },
            body: JSON.stringify({
                type: 1,
                senderid: MOOLRE_SENDER_ID,
                messages: [{
                    recipient: cleanPhone,
                    message: `Your TrustLink OTP is ${otp}`
                }]
            })
        });

        if (!response.ok) {
            console.warn(`[MOOLRE API] OTP endpoint returned ${response.status}. Simulating success.`);
            return { status: 'mock_success', message: 'OTP message simulated.' };
        }

        return await response.json();
    } catch (error) {
        console.error("Moolre OTP integration error:", error);
        return { status: 'mock_success', message: 'OTP message simulated on error.' };
    }
}
export const MOOLRE_API_USER = "DreamersCode";
export const MOOLRE_ACCOUNT_NUMBER = "10783406072616"; // User-provided real account number

// Fallback checkout used while the dynamic /embed/link API returns AIN01 (see HANDOFF.md).
// NOTE: payments through this link cannot carry an externalref, so the webhook
// cannot auto-match them to an escrow — it exists purely to keep the buyer flow testable.
export const MOOLRE_STATIC_POS_LINK = "https://pos.moolre.com/k91Dp2VHFArnB0uCUytiNfW7ls5daw";
export const MOOLRE_VAS_KEY = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ2YXNpZCI6OTc5NywiZXhwIjoxOTU2NTI3OTk5fQ.rV4eU8maadNobhcBmr2GJMyb9BxsGK23InEL97pR3xg"; 
export const MOOLRE_SENDER_ID = "Trustlink"; // Must be an approved Sender ID on Moolre

/**
 * Initiates a Moolre payment gateway checkout session.
 * 
 * @param {number} amount - The total escrow amount to charge.
 * @param {string} description - The description of the escrow transaction.
 * @param {object} customer - The customer details { email, name }.
 * @param {string} externalRef - The unique escrow ID for tracking.
 * @param {string} callbackUrl - The URL to redirect to after successful payment.
 * @returns {Promise<object>} - The Moolre API response containing the checkout URL.
 */
export async function initiateMoolreCheckout(amount, description, customer, externalRef, callbackUrl) {
    try {
        const response = await fetch("https://api.moolre.com/embed/link", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': MOOLRE_PRIVATE_KEY,
                'X-API-PUBKEY': MOOLRE_PUBLIC_KEY,
                'X-API-USER': MOOLRE_API_USER
            },
            body: JSON.stringify({
                type: 1,
                amount: parseFloat(amount).toFixed(2),
                email: customer.email,
                externalref: externalRef || `ESC-${Date.now()}`,
                reusable: "0",
                currency: "GHS",
                accountnumber: MOOLRE_ACCOUNT_NUMBER,
                callback_url: callbackUrl || "",
                metadata: { description }
            })
        });

        // Parse and return the real response
        const data = await response.json();
        
        // If the API fails due to bad keys or missing account number, throw error
        if (!response.ok || data.status == 0) {
            console.error("Moolre Checkout API Error:", data);
            throw new Error(data.message || "Failed to generate Moolre payment link.");
        }

        return data.data; // Should contain { authorization_url, reference }
    } catch (error) {
        console.error("Moolre integration error:", error);
        throw error;
    }
}

/**
 * Verifies a Moolre payment status using the Moolre transaction status API.
 * 
 * @param {string} escrowId - The escrow ID used as the externalref.
 * @returns {Promise<object>} - The verification result.
 */
export async function verifyMoolrePayment(escrowId) {
    try {
        const response = await fetch(`https://api.moolre.com/open/transact/status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-USER': MOOLRE_API_USER,
                'X-API-PUBKEY': MOOLRE_PUBLIC_KEY
            },
            body: JSON.stringify({
                type: 1,
                idtype: "1", // 1 = Unique externalref
                id: escrowId,
                accountnumber: MOOLRE_ACCOUNT_NUMBER
            })
        });

        const data = await response.json();
        
        if (!response.ok || data.status == 0) {
            console.error("Moolre Verification Error:", data);
            throw new Error(data.message || "Failed to verify Moolre payment.");
        }

        // Return the inner data object
        return data.data; 
    } catch (error) {
        console.error("Moolre verification integration error:", error);
        throw error;
    }
}

/**
 * Sends an SMS notification using the Moolre API.
 * 
 * @param {string} phone - The buyer's phone number.
 * @param {string} checkoutUrl - The secure POS checkout link.
 * @param {string} escrowId - The escrow ID for reference.
 * @param {string} paymentId - (Optional) The Moolre Payment ID for USSD pull.
 * @returns {Promise<object>}
 */
export async function sendSMSNotification(phone, checkoutUrl, escrowId, paymentId = "") {
    try {
        console.log(`[MOOLRE API] Sending SMS link for ${escrowId} to ${phone}`);
        
        const ussdText = paymentId ? ` or dial *203*${paymentId}# to pay via USSD` : "";
        const message = `TrustLink: A new secure escrow (#${escrowId.substring(0, 8)}) has been created for you. Click here to pay securely: ${checkoutUrl}${ussdText}.`;
        
        // Remove any '+' or spaces for the API if necessary
        const cleanPhone = phone.replace(/[^0-9]/g, '');

        const response = await fetch("https://api.moolre.com/open/sms/send", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-VASKEY': MOOLRE_VAS_KEY
            },
            body: JSON.stringify({
                type: 1,
                senderid: MOOLRE_SENDER_ID,
                messages: [{
                    recipient: cleanPhone,
                    ref: escrowId,
                    message: message
                }]
            })
        });

        const data = await response.json();
        
        if (!response.ok || data.status == 0) {
            console.error(`[MOOLRE API] SMS error:`, data);
            throw new Error(data.message || "Failed to send SMS message.");
        }

        return data;
    } catch (error) {
        console.error("Moolre SMS integration error:", error);
        throw error;
    }
}

/**
 * Sends a WhatsApp notification using the Moolre API.
 * NOTE: The exact endpoint URL and payload structure must be confirmed with Moolre API documentation.
 * 
 * @param {string} phone - The buyer's phone number.
 * @param {string} checkoutUrl - The secure POS checkout link.
 * @param {string} escrowId - The escrow ID for reference.
 * @param {string} paymentId - (Optional) The Moolre Payment ID for USSD pull.
 * @returns {Promise<object>}
 */
export async function sendWhatsAppNotification(phone, checkoutUrl, escrowId, paymentId = "") {
    try {
        console.log(`[MOOLRE API] Sending WhatsApp link for ${escrowId} to ${phone}`);
        
        const ussdText = paymentId ? `\n\nAlternatively, you can dial *203*${paymentId}# to pay via USSD.` : "";
        const message = `TrustLink Escrow\n\nA new secure escrow transaction (#${escrowId.substring(0, 8)}) has been initiated for you.\n\nPlease complete your payment securely using the following link:\n${checkoutUrl}${ussdText}`;

        // Remove any '+' or spaces for the API if necessary
        const cleanPhone = phone.replace(/[^0-9]/g, '');

        // Assuming endpoint based on SMS endpoint structure. 
        // User/Moolre must confirm the exact WhatsApp endpoint.
        const response = await fetch("https://api.moolre.com/open/whatsapp/send", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-VASKEY': MOOLRE_VAS_KEY
            },
            body: JSON.stringify({
                type: 1, 
                senderid: MOOLRE_SENDER_ID,
                messages: [{
                    recipient: cleanPhone,
                    ref: escrowId,
                    message: `TrustLink: An escrow payment has been initiated for you (Ref: ${escrowId}).\n\nPlease securely pay and track your escrow here:\n${checkoutUrl}`
                }]
            })
        });

        const data = await response.json();
        
        if (!response.ok || data.status == 0) {
            console.warn(`[MOOLRE API] WhatsApp error:`, data);
            throw new Error(data.message || "Failed to send WhatsApp message.");
        }

        return data;
    } catch (error) {
        console.error("Moolre WhatsApp integration error:", error);
        throw error;
    }
}

/**
 * Generates a unique Moolre Payment ID for USSD dial payments (*203*paymentid#)
 * 
 * @param {string} phone - Buyer's phone number
 * @param {string} name - Buyer's name or a unique ID
 * @param {string} escrowId - The escrow ID used as externalref
 * @returns {Promise<string>} - The generated payment ID
 */
export async function generateMoolrePaymentID(phone, name, escrowId) {
    try {
        const response = await fetch("https://api.moolre.com/open/account/create", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-USER': MOOLRE_API_USER,
                'X-API-PUBKEY': MOOLRE_PUBLIC_KEY
            },
            body: JSON.stringify({
                type: 2,
                phone: phone,
                name: name,
                currency: "GHS",
                externalref: escrowId,
                accountnumber: MOOLRE_ACCOUNT_NUMBER
            })
        });

        const data = await response.json();
        if (!response.ok || data.status == 0) {
            console.error("Moolre Payment ID Error:", data);
            throw new Error(data.message || "Failed to create Moolre Payment ID");
        }
        
        return data.data.paymentid;
    } catch (error) {
        console.error("Error creating Moolre Payment ID:", error);
        throw error;
    }
}

/**
 * Initiates a Push USSD Payment prompt on the buyer's phone.
 * 
 * @param {string} phone - Buyer's phone number
 * @param {string} amount - Amount to collect
 * @param {string} channel - Network channel (13=MTN, 6=Telecel, 7=AT)
 * @param {string} escrowId - Escrow ID (externalref)
 * @returns {Promise<object>} - Response indicating prompt was sent
 */
export async function initiateUSSDPushPayment(phone, amount, channel, escrowId) {
    try {
        const response = await fetch("https://api.moolre.com/open/transact/payment", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-USER': MOOLRE_API_USER,
                'X-API-KEY': MOOLRE_PRIVATE_KEY
            },
            body: JSON.stringify({
                type: 1,
                channel: channel,
                currency: "GHS",
                payer: phone,
                amount: amount.toString(),
                externalref: escrowId,
                accountnumber: MOOLRE_ACCOUNT_NUMBER
            })
        });

        const data = await response.json();
        // status 1 with code TR099 or TP14 usually indicates success/prompt sent
        if (!response.ok || data.status == 0) {
            console.error("Moolre USSD Push Error:", data);
            throw new Error(data.message || "Failed to push USSD prompt");
        }
        
        return data;
    } catch (error) {
        console.error("Error initiating USSD push:", error);
        throw error;
    }
}
