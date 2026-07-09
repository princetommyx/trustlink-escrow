// confirm.js - One-time buyer delivery confirmation page.
// The link carries a secret token; only its SHA-256 hash is stored on the
// escrow, so links cannot be forged. Each link is single-use and expires 72h
// after dispatch. Every failure mode gets an explicit error screen.
import { db } from "./firebase-config.js";
import { doc, getDoc, updateDoc, addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { sha256Hex, computeFeeSplit } from "./moolre-service.js";

const show = (stateId) => {
    ['state-loading', 'state-confirm', 'state-success', 'state-disputed', 'state-error'].forEach(id => {
        document.getElementById(id).classList.toggle('hidden', id !== stateId);
    });
};

const showError = (title, message) => {
    document.getElementById('error-title').textContent = title;
    document.getElementById('error-message').textContent = message;
    show('state-error');
};

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const escrowId = params.get('id');
    const token = params.get('token');

    if (!escrowId || !token) {
        showError("Invalid Link", "This confirmation link is incomplete. Please use the exact link that was sent to you by SMS.");
        return;
    }

    let escrowRef, escrow;
    try {
        escrowRef = doc(db, "escrows", escrowId);
        const snap = await getDoc(escrowRef);
        if (!snap.exists()) {
            showError("Invalid Link", "We couldn't find this escrow. The link may be broken or the transaction was removed.");
            return;
        }
        escrow = snap.data();
    } catch (err) {
        console.error("Error loading escrow:", err);
        showError("Something went wrong", "We couldn't verify your link right now. Please try again in a moment.");
        return;
    }

    // ---- Validation checks, most specific message first ----
    if (escrow.status === 'COMPLETED' || escrow.confirmTokenUsed === true) {
        showError("Link Already Used", "This delivery was already confirmed and the payment released. Each confirmation link only works once.");
        return;
    }
    if (escrow.status === 'DISPUTED') {
        showError("Escrow Under Dispute", "This escrow is currently under dispute review, so it cannot be confirmed. Our support team will contact you.");
        return;
    }
    if (!escrow.confirmTokenHash || escrow.status !== 'DISPATCHED') {
        showError("Link Not Active", "This escrow is not awaiting delivery confirmation. If you just paid, wait for the seller to dispatch your item first.");
        return;
    }
    if (escrow.confirmTokenExpiresAt && Date.now() > escrow.confirmTokenExpiresAt) {
        showError("Link Expired", "This confirmation link has expired (links are valid for 72 hours after dispatch). Please contact the seller or support to get a new one.");
        return;
    }

    const tokenHash = await sha256Hex(token);
    if (tokenHash !== escrow.confirmTokenHash) {
        showError("Invalid Link", "This confirmation link failed our security check. Please use the exact link that was sent to you by SMS.");
        return;
    }

    // ---- Link is valid: show the confirmation UI ----
    document.getElementById('confirm-amount').textContent = `GH₵ ${parseFloat(escrow.amount).toFixed(2)}`;
    document.getElementById('confirm-item').textContent = escrow.description || 'Secure Transaction';
    document.getElementById('confirm-seller').textContent = escrow.sellerName || 'Verified Vendor';
    document.getElementById('confirm-ref').textContent = escrowId.substring(0, 12).toUpperCase();
    if (escrow.confirmTokenExpiresAt) {
        const hoursLeft = Math.max(1, Math.round((escrow.confirmTokenExpiresAt - Date.now()) / 3600000));
        document.getElementById('expiry-note').textContent = `This private link expires in about ${hoursLeft} hour${hoursLeft === 1 ? '' : 's'} and can only be used once.`;
    }
    show('state-confirm');

    document.getElementById('btn-confirm-delivery').addEventListener('click', async (e) => {
        if (!confirm("Confirm you received your package? This releases the payment to the seller and cannot be undone.")) return;
        const btn = e.target;
        btn.disabled = true;
        btn.textContent = "Confirming...";
        try {
            await updateDoc(escrowRef, {
                status: 'COMPLETED',
                confirmTokenUsed: true,
                confirmedAt: serverTimestamp()
            });

            // Credit the seller's wallet and log the payout (same as the
            // dashboard's releaseFunds flow). Seller receives amount minus
            // their share of the platform fee.
            const fees = computeFeeSplit(escrow.amount, escrow.feePercent || 0, escrow.feeAllocation || 'split');
            if (escrow.sellerId && fees.sellerNet > 0) {
                try {
                    const sellerRef = doc(db, "users", escrow.sellerId);
                    const sellerSnap = await getDoc(sellerRef);
                    if (sellerSnap.exists()) {
                        const sellerBalance = parseFloat(sellerSnap.data().walletBalance || 0);
                        await updateDoc(sellerRef, { walletBalance: sellerBalance + fees.sellerNet });
                    }
                    await addDoc(collection(db, "transactions"), {
                        userId: escrow.sellerId,
                        type: 'deposit',
                        amount: fees.sellerNet,
                        fee: fees.totalFee,
                        status: 'completed',
                        description: `Escrow release: ${escrow.description || escrowId}`,
                        escrowId: escrowId,
                        createdAt: serverTimestamp()
                    });
                } catch (walletErr) {
                    // The escrow itself is completed; wallet credit is best-effort here
                    console.warn("Could not credit seller wallet from confirm page:", walletErr);
                }
            }

            show('state-success');
        } catch (err) {
            console.error("Error confirming delivery:", err);
            alert("Could not confirm right now: " + err.message);
            btn.disabled = false;
            btn.textContent = "✓ Yes, I received my package";
        }
    });

    document.getElementById('btn-report-problem').addEventListener('click', async (e) => {
        if (!confirm("Raise a dispute? Your funds stay locked in escrow while our team reviews the case.")) return;
        const btn = e.target;
        btn.disabled = true;
        try {
            await updateDoc(escrowRef, {
                status: 'DISPUTED',
                confirmTokenUsed: true,
                disputedAt: serverTimestamp()
            });
            show('state-disputed');
        } catch (err) {
            console.error("Error raising dispute:", err);
            alert("Could not raise dispute right now: " + err.message);
            btn.disabled = false;
        }
    });
});
