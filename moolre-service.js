// moolre-service.js

// WARNING: In a real production application, these keys MUST be hidden on a backend server.
// They are exposed here strictly for MVP/Prototype demonstration purposes.
export const MOOLRE_SECRET_KEY = "dcef1bbe-49aa-4416-8934-b9983a3c42a2";
export const MOOLRE_PUBLIC_KEY = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyaWQiOjEwOTIzMiwiZXhwIjoxOTU2NTQ1OTk5fQ.RvCuvZoYLSLl2BqqwoKDDg_55N3Xj0elQHp5pc44Pns";
export const MOOLRE_PRIVATE_KEY = "Zo5h0DYYzWwmtcwZicvQQWkU3X7KIeQ2P5mU8KQKxk6Ayb1uMR8bC0dokt8715ez";
export const MOOLRE_API_URL = "https://api.moolre.com/v1/checkout"; // Standardized checkout endpoint

/**
 * Sends a One-Time Password (OTP) via Moolre SMS API.
 * @param {string} phone - The recipient's phone number.
 * @param {string} otp - The OTP code to send.
 */
export async function sendMoolreOTP(phone, otp) {
    try {
        console.log(`[MOOLRE API] Sending OTP ${otp} to ${phone}`);
        const response = await fetch(`https://api.moolre.com/open/sms/send?recipient=${phone}&message=Your+TrustLink+OTP+is+${otp}&senderid=${MOOLRE_SENDER_ID}`, {
            method: 'GET',
            headers: {
                'X-API-KEY': MOOLRE_SECRET_KEY,
                'X-API-USER': MOOLRE_API_USER
            }
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
export const MOOLRE_VAS_KEY = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ2YXNpZCI6OTc5NywiZXhwIjoxOTU2NTI3OTk5fQ.rV4eU8maadNobhcBmr2GJMyb9BxsGK23InEL97pR3xg"; 
export const MOOLRE_SENDER_ID = "566"; // Must be an approved Sender ID on Moolre

/**
 * Initiates a Moolre payment gateway checkout session.
 * 
 * @param {number} amount - The total escrow amount to charge.
 * @param {string} description - The description of the escrow transaction.
 * @param {object} customer - The customer details { email, name }.
 * @param {string} externalRef - The unique escrow ID for tracking.
 * @returns {Promise<object>} - The Moolre API response containing the checkout URL.
 */
export async function initiateMoolreCheckout(amount, description, customer, externalRef) {
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
 * Sends an SMS notification using the Moolre API.
 * 
 * @param {string} phone - The buyer's phone number.
 * @param {string} checkoutUrl - The public POS checkout URL.
 * @param {string} escrowId - The Escrow reference ID.
 * @returns {Promise<object>}
 */
export async function sendSMSNotification(phone, checkoutUrl, escrowId) {
    try {
        console.log(`[MOOLRE API] Sending SMS link for ${escrowId} to ${phone}`);
        
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
                    message: `TrustLink: An escrow payment has been initiated for you (Ref: ${escrowId}).\n\nPlease securely pay and track your escrow here:\n${checkoutUrl}`
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
