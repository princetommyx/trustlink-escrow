// moolre-service.js

// WARNING: In a real production application, these keys MUST be hidden on a backend server.
// They are exposed here strictly for MVP/Prototype demonstration purposes.
export const MOOLRE_SECRET_KEY = "9099172e-5333-42b6-990a-6c2d073f247b";
export const MOOLRE_API_URL = "https://api.moolre.com/v1/checkout"; // Standardized checkout endpoint

/**
 * Initiates a Moolre payment gateway checkout session for the Escrow.
 * 
 * @param {number} amount - The total escrow amount to charge.
 * @param {string} description - The description of the escrow transaction.
 * @param {object} customer - The customer details { email, name }.
 * @returns {Promise<object>} - The Moolre API response (often containing a checkout URL).
 */
export async function initiateMoolreCheckout(amount, description, customer) {
    try {
        const response = await fetch(MOOLRE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': MOOLRE_SECRET_KEY,
                'X-API-USER': 'DreamersCode'
            },
            body: JSON.stringify({
                amount: parseFloat(amount),
                currency: "GHS",
                description: description,
                customer: customer,
                callback_url: "http://localhost/api/dr"
            })
        });

        // Since we are mocking the endpoint without the exact docs, this will likely fail 
        // with a 404 or 401 if the endpoint is slightly different. We handle it gracefully for the UI.
        if (!response.ok) {
            console.warn("Moolre API responded with an error, possibly due to a mock endpoint structure.", response.status);
            throw new Error(`API Error: ${response.status} - The Moolre endpoint requires specific configuration.`);
        }

        const data = await response.json();
        return data; 
    } catch (error) {
        console.error("Moolre integration error:", error);
        throw error;
    }
}
