const cors = require('cors')({ origin: true });
const { db, normalizeGhanaPhone } = require('./firebase-admin');

module.exports = async (req, res) => {
    await new Promise((resolve, reject) => {
        cors(req, res, (result) => {
            if (result instanceof Error) return reject(result);
            resolve(result);
        });
    });

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const data = req.body.data || req.body;
    const { phone } = data;
    const { local } = normalizeGhanaPhone(phone);
    if (!local || local.length < 10) {
        return res.status(400).json({ error: 'Valid 10-digit Ghanaian phone number required.' });
    }

    const apiKey = process.env.SASUSYNC_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'SMS gateway configuration error.' });
    }

    const intlPhone = '233' + local.slice(1);
    const baseUrl = process.env.SASUSYNC_BASE_URL || 'https://sms.sasusync.com';

    try {
        const response = await fetch(`${baseUrl}/otp/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey
            },
            body: JSON.stringify({
                number: intlPhone,
                sender_id: "TrustEscrow",
                message: "Your TrustLink verification code is %otp_code%. Valid for 5 minutes.",
                medium: "sms",
                otp_type: "numeric",
                expiry: 5,
                length: 6
            })
        });

        const resData = await response.json();
        if (!response.ok || !resData.success) {
            if (response.status === 429) {
                return res.status(429).json({ error: 'Please wait before requesting another verification code.' });
            }
            return res.status(503).json({ error: resData.detail || 'SMS delivery failed. Please try again.' });
        }

        if (resData.otp_id) {
            await db.collection('phone_otps').doc(local).set({
                phone: local,
                otpId: resData.otp_id,
                createdAt: Date.now(),
                provider: 'sasusync'
            });
        }

        return res.status(200).json({ data: { success: true, message: 'Verification OTP sent via SMS.' } });
    } catch (err) {
        console.error("OTP delivery error", err);
        return res.status(500).json({ error: 'SMS gateway delivery error.' });
    }
};
