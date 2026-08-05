export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { phone, message, referenceId } = req.body || {};

    if (!phone || !message) {
      return res.status(400).json({ error: 'Phone and message content are required' });
    }

    // Normalize Ghana phone number
    let cleanPhone = String(phone).replace(/[^\d]/g, '');
    if (cleanPhone.startsWith('0') && cleanPhone.length === 10) {
      cleanPhone = '233' + cleanPhone.slice(1);
    } else if (cleanPhone.length === 9 && !cleanPhone.startsWith('233')) {
      cleanPhone = '233' + cleanPhone;
    }

    const sasuSyncKey = process.env.SASUSYNC_API_KEY;
    const arkeselKey = process.env.ARKESEL_API_KEY;
    const senderId = process.env.SASUSYNC_SENDER_ID || "TrustEscrow";

    // 1. Try SasuSync SMS Gateway (primary)
    if (sasuSyncKey) {
      const sasuRes = await fetch("https://sms.sasulabs.me/api/v1/send", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': sasuSyncKey
        },
        body: JSON.stringify({
          sender: senderId,
          recipients: [cleanPhone],
          message: message,
          metadata: { ref: referenceId || `sms-${Date.now()}` }
        })
      });
      const data = await sasuRes.json().catch(() => ({}));
      if (sasuRes.ok && data.success) {
        return res.status(200).json({ success: true, provider: 'sasusync', data });
      } else {
        return res.status(sasuRes.status || 400).json({ 
          error: data.detail || data.message || 'SasuSync SMS delivery rejected', 
          provider: 'sasusync', 
          details: data 
        });
      }
    }

    // 2. Try Arkesel SMS Gateway (fallback)
    if (arkeselKey) {
      const arkeselRes = await fetch(`https://sms.arkesel.com/api/v2/sms/send`, {
        method: 'POST',
        headers: {
          'api-key': arkeselKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sender: "TrustEscrow",
          message: message,
          recipients: [cleanPhone]
        })
      });
      const data = await arkeselRes.json().catch(() => ({}));
      if (arkeselRes.ok) {
        return res.status(200).json({ success: true, provider: 'arkesel', data });
      }
    }

    // Fallback if no SMS provider environment variable is configured
    return res.status(503).json({
      error: 'No active SMS Gateway credentials configured (SASUSYNC_API_KEY / ARKESEL_API_KEY).',
      recipient: cleanPhone,
      nativeSmsLink: `sms:${cleanPhone}?&body=${encodeURIComponent(message)}`
    });
  } catch (err) {
    console.error('Error in SMS dispatch handler:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
