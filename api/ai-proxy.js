// /api/ai-proxy.js
export default async function handler(req, res) {
    // 1. Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { prompt } = req.body;

        // 2. Validate and sanitize input
        if (!prompt || typeof prompt !== 'string') {
            return res.status(400).json({ error: 'Invalid prompt provided' });
        }

        const sanitizedPrompt = prompt.trim();
        
        if (sanitizedPrompt.length === 0 || sanitizedPrompt.length > 1000) {
            return res.status(400).json({ error: 'Prompt must be between 1 and 1000 characters' });
        }

        // 3. Attach secret API key from environment variables
        const AI_API_KEY = process.env.AI_PROVIDER_API_KEY;
        if (!AI_API_KEY) {
            console.error('Missing AI_PROVIDER_API_KEY in environment variables');
            return res.status(500).json({ error: 'Internal Server Error' });
        }

        // 4. Make the request to the external AI provider (e.g., OpenAI API)
        const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { 
                        role: 'system', 
                        content: 'You are a helpful assistant for TrustLink Escrow.' 
                    },
                    { 
                        role: 'user', 
                        content: sanitizedPrompt 
                    }
                ],
                max_tokens: 500,
                temperature: 0.7
            })
        });

        if (!aiResponse.ok) {
            const errorData = await aiResponse.json();
            console.error('AI Provider Error:', errorData);
            return res.status(502).json({ error: 'Failed to communicate with AI provider' });
        }

        const data = await aiResponse.json();

        // 5. Return the response to the client safely
        return res.status(200).json({ 
            success: true, 
            result: data.choices[0].message.content 
        });

    } catch (error) {
        console.error('Proxy Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
