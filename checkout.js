import { db } from "./firebase-config.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initiateMoolreCheckout, MOOLRE_STATIC_POS_LINK } from "./moolre-service.js";

document.addEventListener('DOMContentLoaded', async () => {
    // Extract ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const escrowId = urlParams.get('id');
    
    if (!escrowId) {
        document.getElementById('loading-text').textContent = "Error: Invalid Checkout Link";
        document.getElementById('loader').style.display = 'none';
        return;
    }

    try {
        const docRef = doc(db, "escrows", escrowId);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            document.getElementById('loading-text').textContent = "Error: Escrow not found";
            document.getElementById('loader').style.display = 'none';
            return;
        }

        const escrow = docSnap.data();
        
        // Hide loader, show content
        document.getElementById('loader').style.display = 'none';
        document.getElementById('loading-text').style.display = 'none';
        document.getElementById('escrow-content').classList.remove('hidden');

        // Populate Data
        document.getElementById('escrow-amount').textContent = `GH₵ ${parseFloat(escrow.amount).toFixed(2)}`;
        document.getElementById('seller-name').textContent = escrow.sellerName || 'Verified Vendor';
        document.getElementById('escrow-desc').textContent = escrow.description || 'Secure Transaction';
        document.getElementById('escrow-id-display').textContent = escrowId;

        // Render based on Status
        const statusBadge = document.getElementById('escrow-status');
        const actionButtons = document.getElementById('action-buttons');
        
        const updateStatusUI = (status) => {
            statusBadge.className = 'status-badge'; // reset
            if (status === 'PENDING_PAYMENT') {
                statusBadge.textContent = 'Status: Pending Payment';
                statusBadge.classList.add('status-pending');
                
                actionButtons.innerHTML = `
                    <button id="btn-pay" class="btn btn-primary btn-large" style="width: 100%;">Pay securely via Moolre</button>
                `;
                
                document.getElementById('btn-pay').addEventListener('click', async (e) => {
                    const btn = e.target;
                    btn.disabled = true;
                    btn.textContent = "Connecting to Moolre...";

                    // Try the dynamic checkout API first: it carries the escrow ID as
                    // externalref, which lets the webhook auto-mark this escrow FUNDED.
                    // While Moolre keeps returning AIN01 (see HANDOFF.md) we fall back
                    // to the static POS link so the buyer flow stays testable.
                    try {
                        const customer = {
                            email: escrow.buyerEmail || "buyer@trustlink.com",
                            name: escrow.sellerName || "TrustLink Buyer"
                        };
                        const checkout = await initiateMoolreCheckout(escrow.amount, escrow.description, customer, escrowId);
                        const payUrl = checkout && (checkout.authorization_url || checkout.url || checkout.link);
                        if (!payUrl) throw new Error("Moolre response did not include a checkout URL.");
                        window.location.href = payUrl;
                    } catch(err) {
                        console.warn("Dynamic Moolre checkout unavailable, falling back to static POS link:", err.message);
                        window.location.href = MOOLRE_STATIC_POS_LINK;
                    }
                });

            } else if (status === 'FUNDED') {
                statusBadge.textContent = 'Status: Paid (Awaiting Dispatch)';
                statusBadge.classList.add('status-funded');
                actionButtons.innerHTML = `<p style="color: rgba(255,255,255,0.7); font-size: 0.9rem;">Your funds are securely locked in TrustLink Escrow. The seller has been notified to dispatch the item.</p>`;
                
            } else if (status === 'DISPATCHED') {
                statusBadge.textContent = 'Status: Dispatched';
                statusBadge.classList.add('status-dispatched');
                
                actionButtons.innerHTML = `
                    <p style="color: rgba(255,255,255,0.7); font-size: 0.9rem; margin-bottom: 12px;">The seller has dispatched the item. Once you receive and inspect it, confirm to release the funds.</p>
                    <button id="btn-release" class="btn btn-primary btn-large" style="width: 100%; margin-bottom: 8px;">Confirm & Release Funds</button>
                    <button id="btn-dispute" class="btn btn-outline" style="width: 100%; border-color: var(--danger); color: var(--danger);">Raise Dispute</button>
                `;
                
                document.getElementById('btn-release').addEventListener('click', async () => {
                    if(confirm("Are you sure you want to release the funds to the seller? This action cannot be undone.")) {
                        await updateDoc(docRef, { status: 'COMPLETED' });
                        alert("Funds Released! Thank you for using TrustLink Escrow.");
                        window.location.reload();
                    }
                });
                
                document.getElementById('btn-dispute').addEventListener('click', async () => {
                    if(confirm("Are you sure you want to raise a dispute? Escrow funds will remain locked while an admin reviews the case.")) {
                        await updateDoc(docRef, { status: 'DISPUTED' });
                        alert("Dispute Raised. Support will contact you shortly.");
                        window.location.reload();
                    }
                });

            } else if (status === 'COMPLETED') {
                statusBadge.textContent = 'Status: Completed';
                statusBadge.classList.add('status-completed');
                actionButtons.innerHTML = `<p style="color: var(--success); font-weight: 600;">This escrow has been successfully completed and funds were released.</p>`;
            } else if (status === 'DISPUTED') {
                statusBadge.textContent = 'Status: Disputed';
                statusBadge.classList.add('status-pending'); // Yellow/warning
                actionButtons.innerHTML = `<p style="color: var(--warning); font-weight: 600;">This escrow is currently under dispute review.</p>`;
            }
        };

        updateStatusUI(escrow.status);

    } catch (error) {
        console.error("Error fetching escrow:", error);
        document.getElementById('loading-text').textContent = "Database Error: " + error.message;
        document.getElementById('loader').style.display = 'none';
    }
});
