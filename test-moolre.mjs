const MOOLRE_SECRET_KEY = "dcef1bbe-49aa-4416-8934-b9983a3c42a2";
const MOOLRE_PUBLIC_KEY = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyaWQiOjEwOTIzMiwiZXhwIjoxOTU2NTQ1OTk5fQ.RvCuvZoYLSLl2BqqwoKDDg_55N3Xj0elQHp5pc44Pns";
const MOOLRE_PRIVATE_KEY = "dZGZS7cYLxCjWRyAwy3g4J2GFuqFkkQL2DG0ZTbQFIkNaX50M6B46qzEzsmrqa8F";
const MOOLRE_API_USER = "DreamersCode";
const MOOLRE_ACCOUNT_NUMBER = "10783406072616"; 

async function initiateMoolreCheckout(amount, description, customer, externalRef, callbackUrl) {
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
    const data = await response.json();
    if (!response.ok || data.status == 0) {
        throw new Error(data.message || "Failed to generate Moolre payment link.");
    }
    return data.data; 
}

async function initiateUSSDPushPayment(phone, amount, channel, escrowId) {
    const response = await fetch("https://api.moolre.com/open/transact/payment", {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-USER': MOOLRE_API_USER,
            'X-API-KEY': MOOLRE_PRIVATE_KEY,
            'X-API-PUBKEY': MOOLRE_PUBLIC_KEY
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
    if (!response.ok || data.status == 0) {
        throw new Error(data.message || "Failed to push USSD prompt");
    }
    return data;
}

async function runTests() {
    console.log("=== Testing Moolre APIs ===");
    
    try {
        console.log("\n1. Testing /embed/link (Dynamic Checkout)...");
        const customer = { email: "test@trustlink.com", name: "Test User" };
        const checkout = await initiateMoolreCheckout(10, "Test Transaction", customer, "TEST-ESC-123", "http://localhost");
        console.log("✅ Success! Checkout Data:", checkout);
    } catch (err) {
        console.log("❌ Failed:", err.message);
    }

    try {
        console.log("\n2. Testing /open/transact/payment (USSD Push)...");
        const ussd = await initiateUSSDPushPayment("0551234567", 5, 13, "TEST-ESC-123");
        console.log("✅ Success! USSD Data:", ussd);
    } catch (err) {
        console.log("❌ Failed:", err.message);
    }
}

runTests();
