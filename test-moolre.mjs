// IMPORTANT: username and keys MUST come from the SAME Moolre account,
// otherwise every endpoint returns AIN01 (Authentication Error).
// Working pair verified July 8, 2026: sasulabs account (user ID 107834).
const MOOLRE_PUBLIC_KEY = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyaWQiOjEwNzgzNCwiZXhwIjoxOTU2NTQ1OTk5fQ.ZPgxaR7PP6FZH5msdXkWSQX6lbjp27mTywLgMhAeaPc";
const MOOLRE_PRIVATE_KEY = "tDA79UwhA1PLoCsBNXzcmk08qOXNvd25xKVjKPN93i2RVqa1VNoUWN7jXR91v39C";
const MOOLRE_API_USER = "sasulabs";
const MOOLRE_ACCOUNT_NUMBER = "10783406072616";

async function initiateMoolreCheckout(amount, description, customer, externalRef, callbackUrl) {
    const response = await fetch("https://api.moolre.com/embed/link", {
        method: 'POST',
        headers: {
            // Per docs.moolre.com /embed/link wants ONLY username + public key
            'Content-Type': 'application/json',
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
            // Per docs.moolre.com /open/transact/payment wants username + PRIVATE key
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

    // USSD push sends a REAL payment prompt to a REAL phone, so it only runs
    // if you pass a phone number: node test-moolre.mjs 05XXXXXXXX
    const testPhone = process.argv[2];
    if (testPhone) {
        try {
            console.log(`\n2. Testing /open/transact/payment (USSD Push) to ${testPhone}...`);
            const ussd = await initiateUSSDPushPayment(testPhone, 1, 13, "TEST-ESC-" + Date.now());
            console.log("✅ Success! USSD Data:", ussd);
        } catch (err) {
            console.log("❌ Failed:", err.message);
        }
    } else {
        console.log("\n2. Skipping USSD Push test (pass a phone number to run it: node test-moolre.mjs 05XXXXXXXX)");
    }
}

runTests();
