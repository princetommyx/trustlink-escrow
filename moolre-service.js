// moolre-service.js

// WARNING: In a real production application, these keys MUST be hidden on a backend server.
// They are exposed here strictly for MVP/Prototype demonstration purposes.
export const MOOLRE_SECRET_KEY = "9099172e-5333-42b6-990a-6c2d073f247b";
export const MOOLRE_API_USER = "DreamersCode";
export const MOOLRE_ACCOUNT_NUMBER = "YOUR_MOOLRE_ACCOUNT_NUMBER_HERE"; // e.g. "100000157291"
export const MOOLRE_WHATSAPP_TEMPLATE = "escrow_update"; // e.g. "update" or "promotion"

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
 * Sends a WhatsApp notification using the Moolre API Key.
 * 
 * @param {string} phone - The buyer's WhatsApp number.
 * @param {string} checkoutUrl - The public POS checkout URL.
 * @param {string} escrowId - The Escrow reference ID.
 * @returns {Promise<object>}
 */
export async function sendWhatsAppNotification(phone, checkoutUrl, escrowId) {
    try {
        console.log(`[MOOLRE API] Sending WhatsApp link for ${escrowId} to ${phone}`);
        
        // Remove any '+' or spaces for the API if necessary
        const cleanPhone = phone.replace(/[^0-9]/g, '');

        const response = await fetch("https://api.moolre.com/open/whatsapp/send", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': MOOLRE_SECRET_KEY,
                'X-API-USER': MOOLRE_API_USER
            },
            body: JSON.stringify({
                template_name: MOOLRE_WHATSAPP_TEMPLATE,
                language: "en",
                messages: [{
                    recipient: cleanPhone,
                    ref: escrowId,
                    placeholders: [ checkoutUrl, escrowId ]
                }]
            })
        });

        const data = await response.json();
        
        if (!response.ok || data.status == 0) {
            console.error(`[MOOLRE API] WhatsApp error:`, data);
            throw new Error(data.message || "Failed to send WhatsApp message.");
        }

        return data;
    } catch (error) {
        console.error("Moolre WhatsApp integration error:", error);
        throw error;
    }
}
