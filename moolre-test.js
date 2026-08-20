require('dotenv').config();

async function testMoolre() {
    const MOOLRE_API_USER = process.env.MOOLRE_API_USER;
    const MOOLRE_PUBKEY   = process.env.MOOLRE_PUBLIC_KEY;
    const MOOLRE_ACCOUNT  = process.env.MOOLRE_ACCOUNT_NUMBER;

    console.log("Using credentials:", MOOLRE_API_USER ? "YES" : "NO");

    const payload = {
        type: 1,
        channel: '13',
        currency: 'GHS',
        payer: '0550000000', // I will use a dummy number to see the response
        amount: '1.00',
        externalref: 'TEST-' + Date.now(),
        accountnumber: MOOLRE_ACCOUNT
    };

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
    console.log("Status:", response.status);
    console.log("Response:", text);
}

testMoolre();
