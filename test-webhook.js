const payload = {
    status: 1,
    data: {
        externalref: "FAKE_TEST_ESCROW_123"
    }
};

fetch("https://trustlinkbackend.onrender.com/api/moolre-webhook", {
    method: "POST",
    headers: {
        "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
})
.then(res => res.text().then(text => ({ status: res.status, text })))
.then(({ status, text }) => {
    console.log(`Response Code: ${status}`);
    console.log(`Response Body: ${text}`);
})
.catch(err => console.error("Fetch error:", err));
