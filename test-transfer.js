
// Wait, moolre keys are likely configured in Vercel. But let's check .env.local first.
// I will just use fetch without real keys to see validation errors.

async function testMoolreTransfer() {
    const payload = {
        amount: 1,
        bankCode: 'MTN',
        accountNumber: '0208842410',
        externalref: 'TEST-' + Date.now()
    };

    const response = await fetch('https://api.moolre.com/open/transact/transfer', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-USER': 'test',
            'X-API-PRIKEY': 'test'
        },
        body: JSON.stringify(payload)
    });

    const text = await response.text();
    console.log("Status:", response.status);
    console.log("Response:", text);
}

testMoolreTransfer();
