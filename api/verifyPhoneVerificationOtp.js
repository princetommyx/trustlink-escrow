const cors = require('cors')({ origin: true });
const { db, admin, normalizeGhanaPhone, authenticateToken } = require('./firebase-admin');

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
    const { phone, otpCode } = data;
    const { local } = normalizeGhanaPhone(phone);
    if (!local || !otpCode) {
        return res.status(400).json({ error: 'Phone number and verification code are required.' });
    }

    const apiKey = process.env.SASUSYNC_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'SMS gateway configuration error.' });
    }

    const intlPhone = '233' + local.slice(1);
    const baseUrl = process.env.SASUSYNC_BASE_URL || 'https://sms.sasusync.com';

    try {
        const response = await fetch(`${baseUrl}/otp/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey
            },
            body: JSON.stringify({
                number: intlPhone,
                code: otpCode
            })
        });

        const resData = await response.json();

        if (!response.ok || !resData.success || !resData.verified) {
            if (response.status === 429) {
                return res.status(403).json({ error: 'Too many failed attempts. Please request a new code.' });
            }
            if (response.status === 410 || (resData.detail && resData.detail.includes('expired'))) {
                return res.status(408).json({ error: 'Verification code expired. Please request a new code.' });
            }
            return res.status(400).json({ error: resData.detail || 'Invalid verification code.' });
        }

        const otpDocRef = db.collection('phone_otps').doc(local);
        await otpDocRef.delete().catch(() => {});

        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const decodedToken = await authenticateToken(req, res);
            if (decodedToken && decodedToken.uid) {
                await db.collection('users').doc(decodedToken.uid).update({
                    phone: local,
                    phoneVerified: true,
                    phoneVerifiedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        }

        return res.status(200).json({ data: { success: true, verified: true } });
    } catch (err) {
        console.error("OTP verification error", err);
        return res.status(500).json({ error: 'Verification service error.' });
    }
};
