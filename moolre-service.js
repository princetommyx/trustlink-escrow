// moolre-service.js

// WARNING: In a real production application, these keys MUST be hidden on a backend server.
// They are exposed here strictly for MVP/Prototype demonstration purposes.
export const MOOLRE_SECRET_KEY = "9pEmlgXWujrGG2n0k0zZs54rEJWiOlIYprKKSgALn4Vzt3jVF4MGvSzQCgEU13P6";
export const MOOLRE_API_USER = "DreamersCode";
export const MOOLRE_ACCOUNT_NUMBER = "10783406072616"; // User-provided real account number
export const MOOLRE_VAS_KEY = "9pEmlgXWujrGG2n0k0zZs54rEJWiOlIYprKKSgALn4Vzt3jVF4MGvSzQCgEU13P6"; // Assuming Private Key acts as VAS Key
export const MOOLRE_SENDER_ID = "TrustLink"; // Must be an approved Sender ID on Moolre

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
                'X-API-KEY': MOOLRE_SECRET_KEY,
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
