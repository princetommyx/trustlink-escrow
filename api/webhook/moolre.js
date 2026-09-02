'use strict';

// Reuse the shared server-side actions instead of duplicating them: the
// payment re-verification call (Moolre's own API, server-held secret) and
// the atomic Firestore transition are both defined once in api/core.js.
const { verifyMoolrePayment, markEscrowFundsEscrowed } = require('../core.js');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin','*');
    if (req.method==='OPTIONS') return res.status(200).end();
    if (req.method!=='POST') return res.status(405).json({error:'Method Not Allowed'});
    try {
        const payload = req.body||{};
        if (!payload.externalref) return res.status(400).json({error:'Missing externalref'});

        // The webhook body is untrusted input - anyone who finds this public
        // URL can POST an arbitrary payload. Moolre does not document a
        // signature scheme for us to check here, so instead of trusting
        // payload.status we call Moolre's own verify endpoint (server-to-
        // server, with our secret key) for this exact reference and only
        // act on what Moolre itself reports.
        let verification;
        try {
            verification = await verifyMoolrePayment({ reference: payload.externalref });
        } catch (verifyErr) {
            console.warn('[moolre webhook] verification call failed:', verifyErr.message);
            return res.status(200).json({ success: true, note: 'Verification failed, no action taken.' });
        }
        const isVerified = !!(verification && (verification.paid === true || verification.status === 'success' || verification.status === 1));

        if (isVerified) {
            // Extract original escrowId if reference contains the unique '-P-' suffix
            let docId = payload.externalref;
            if (docId.includes('-P-')) {
                docId = docId.split('-P-')[0];
            }
            try {
                await markEscrowFundsEscrowed(docId, payload.externalref);
            } catch (writeErr) {
                console.warn('[moolre webhook] could not mark escrow escrowed:', writeErr.message);
            }
        }
        return res.status(200).json({success:true});
    } catch(e) { console.error('[moolre webhook]',e.message); return res.status(500).json({error:'Server error'}); }
};
