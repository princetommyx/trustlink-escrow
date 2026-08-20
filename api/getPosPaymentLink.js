const cors = require('cors')({ origin: true });
const { authenticateToken } = require('./firebase-admin');

module.exports = async (req, res) => {
    // Run cors middleware
    await new Promise((resolve, reject) => {
        cors(req, res, (result) => {
            if (result instanceof Error) return reject(result);
            resolve(result);
        });
    });

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Optional: await authenticateToken(req, res);
    
    const posLink = process.env.MOOLRE_POS_LINK;
    if (!posLink) {
        return res.status(500).json({ error: 'POS link not configured on the server.' });
    }

    return res.status(200).json({
        success: true,
        link: posLink
    });
};
