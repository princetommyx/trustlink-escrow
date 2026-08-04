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
    } else if (cleanNumber.length === 9 && !cleanNumber.startsWith('233')) {
      cleanNumber = '233' + cleanNumber;
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

    const directWhatsAppUrl = `https://wa.me/${cleanNumber}?text=${encodeURIComponent(messageText)}`;

    // Try sending rich text message first
    let metaResponse = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
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

    let data = await metaResponse.json();

    // If text message fails due to 24-hr window (#131047), try sending template
    if (!metaResponse.ok && (data.error?.code === 131047 || data.error?.code === 131030 || data.error?.code === 100)) {
      console.log('Attempting template message fallback for:', cleanNumber);
      
      const templateResponse = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanNumber,
          type: 'template',
          template: {
            name: 'trustlink_escrow_invoice',
            language: { code: 'en_US' },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: creator },
                  { type: 'text', text: orderTitle },
                  { type: 'text', text: formattedAmount },
                  { type: 'text', text: escrowId || 'N/A' }
                ]
              },
              {
                type: 'button',
                sub_type: 'url',
                index: '0',
                parameters: [
                  { type: 'text', text: escrowId || '' }
                ]
              }
            ]
          }
        })
      });

      const templateData = await templateResponse.json();
      if (templateResponse.ok) {
        return res.status(200).json({
          success: true,
          messageId: templateData.messages?.[0]?.id,
          type: 'template',
          directWhatsAppUrl,
          data: templateData
        });
      }
    }

    if (!metaResponse.ok) {
      console.error('Meta WhatsApp API Error:', data);
      return res.status(metaResponse.status).json({ 
        error: data.error?.message || 'Failed to send WhatsApp message', 
        errorCode: data.error?.code,
        directWhatsAppUrl,
        details: data 
      });
    }

    return res.status(200).json({ 
      success: true, 
      messageId: data.messages?.[0]?.id, 
      type: 'text',
      directWhatsAppUrl,
      data 
    });
  } catch (error) {
    console.error('Error in send-whatsapp handler:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
