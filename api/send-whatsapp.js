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
    const { to, description, amount, sellerName, checkoutUrl, escrowId } = req.body;

    if (!to) {
      return res.status(400).json({ error: 'Recipient phone number is required' });
    }

    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '1211218685412737';

    if (!token) {
      return res.status(500).json({ error: 'WHATSAPP_ACCESS_TOKEN is not configured on the server' });
    }

    // Normalize phone number to international format (e.g. 233241234567)
    let cleanNumber = String(to).replace(/[^\d]/g, '');
    if (cleanNumber.startsWith('0') && cleanNumber.length === 10) {
      cleanNumber = '233' + cleanNumber.slice(1);
    }

    const formattedAmount = Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const orderTitle = description || 'Escrow Transaction';
    const creator = sellerName || 'TrustLink User';
    const payLink = checkoutUrl || `https://www.trustlinkgh.online/checkout.html?id=${escrowId || ''}`;

    const messageText = 
`🔒 *TrustLink Escrow Payment Notification*

Hello! An escrow payment request has been generated for you by *${creator}*.

📦 *Order:* ${orderTitle}
💰 *Amount Due:* GH₵ ${formattedAmount}
🆔 *Escrow ID:* #${escrowId || 'N/A'}

🔗 *Pay Securely via Mobile Money / Card:*
${payLink}

🛡️ _Your money remains safe in TrustLink Escrow and will only be released when you receive and approve your item._`;

    const metaResponse = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanNumber,
        type: 'text',
        text: {
          preview_url: true,
          body: messageText
        }
      })
    });

    const data = await metaResponse.json();

    if (!metaResponse.ok) {
      console.error('Meta WhatsApp API Error:', data);
      return res.status(metaResponse.status).json({ 
        error: data.error?.message || 'Failed to send WhatsApp message', 
        details: data 
      });
    }

    return res.status(200).json({ 
      success: true, 
      messageId: data.messages?.[0]?.id, 
      data 
    });
  } catch (error) {
    console.error('Error in send-whatsapp handler:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
