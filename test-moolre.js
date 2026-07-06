async function testMoolre() {
    const MOOLRE_PRIVATE_KEY = "Zo5h0DYYzWwmtcwZicvQQWkU3X7KIeQ2P5mU8KQKxk6Ayb1uMR8bC0dokt8715ez";
    const MOOLRE_PUBLIC_KEY = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyaWQiOjEwOTIzMiwiZXhwIjoxOTU2NTQ1OTk5fQ.RvCuvZoYLSLl2BqqwoKDDg_55N3Xj0elQHp5pc44Pns";
    const MOOLRE_API_USER = "uyahya566";
    const MOOLRE_ACCOUNT_NUMBER = "10783406072616";

    const payload = {
        type: 1,
        amount: "100.00",
        email: "test@example.com",
        externalref: "TEST_123",
        reusable: "0",
        currency: "GHS",
        accountnumber: MOOLRE_ACCOUNT_NUMBER,
        metadata: { description: "Test Transaction" }
    };

    console.log("Testing with Live API Endpoint...");
    try {
        const response = await fetch("https://api.moolre.com/embed/link", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': MOOLRE_PRIVATE_KEY,
                'X-API-PUBKEY': MOOLRE_PUBLIC_KEY,
                'X-API-USER': MOOLRE_API_USER
            },
            body: JSON.stringify(payload)
        });
        const text = await response.text();
        console.log("Live API Status Code:", response.status);
        console.log("Live API Response:", text);
    } catch(err) {
        console.error(err);
    }
}

testMoolre();
