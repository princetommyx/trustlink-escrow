import { db } from "./firebase-config.js";
import { doc, getDoc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initiateMoolreCheckout, MOOLRE_STATIC_POS_LINK, verifyMoolrePayment, initiateUSSDPushPayment } from "./moolre-service.js";

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
        
        // Handle Moolre Callback / Redirect
        const paymentStatus = urlParams.get('payment');
        if (paymentStatus === 'success' && escrow.status === 'PENDING_PAYMENT') {
            document.getElementById('loading-text').textContent = "Verifying Payment with Moolre...";
            try {
                // Verify the transaction securely with Moolre
                const verificationResult = await verifyMoolrePayment(escrowId);
                
                // Moolre txstatus: 1 means Success
                if (verificationResult && verificationResult.txstatus == 1) {
                    // Update Firestore
                    await updateDoc(docRef, { status: 'FUNDED' });
                    escrow.status = 'FUNDED';
                    alert("Payment Successful! Your funds are now securely held in escrow.");
                } else {
                    throw new Error("Moolre says the transaction is not fully successful yet.");
                }
                
                // Clear URL params to prevent re-triggering on reload
                window.history.replaceState({}, document.title, window.location.pathname + "?id=" + escrowId);
            } catch (err) {
                console.error("Payment Verification Failed:", err);
                alert("Payment verification failed or is still processing. If you have been charged, please wait a moment and refresh.");
            }
        }
        
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
                    <button id="btn-pay" class="btn btn-primary btn-large" style="width: 100%; margin-bottom: 8px;">Pay securely via Moolre</button>
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
                        // We are explicitly setting the callback URL to the Render backend /callback route
                        // so the backend can handle Moolre's redirect and then forward the user back to Vercel.
                        const callbackUrl = "https://trustlinkbackend.onrender.com/callback?id=" + escrowId;
                        const checkout = await initiateMoolreCheckout(escrow.amount, escrow.description, customer, escrowId, callbackUrl);
                        const payUrl = checkout && (checkout.authorization_url || checkout.url || checkout.link);
                        if (!payUrl) throw new Error("Moolre response did not include a checkout URL.");
                        
                        // Open Moolre POS in a new tab so TrustLink can listen for the webhook!
                        window.open(payUrl, "_blank");
                        btn.textContent = "Awaiting Payment Confirmation...";
                    } catch(err) {
                        console.warn("Moolre API Failed, falling back to static POS link.", err.message);
                        window.open(MOOLRE_STATIC_POS_LINK, "_blank");
                        btn.disabled = true;
                        btn.textContent = "Awaiting Payment Confirmation...";
                    }
                });

                // Handle USSD Push Payment
                const btnUssd = document.getElementById('btn-pay-ussd');
                if (btnUssd) {
                    btnUssd.addEventListener('click', async () => {
                        const network = document.getElementById('ussd-network').value;
                        const phone = document.getElementById('ussd-phone').value;
                        
                        if(!phone) {
                            alert("Please enter a valid phone number.");
                            return;
                        }
                        
                        btnUssd.textContent = "Sending Prompt...";
                        btnUssd.disabled = true;
                        
                        try {
                            await initiateUSSDPushPayment(phone, escrow.amount, network, escrowId);
                            alert(`A prompt has been sent to ${phone}. Please check your phone and enter your PIN to approve the payment.\n\nClick OK once you have paid.`);
                            
                            document.getElementById('loading-text').textContent = "Verifying Payment with Moolre...";
                            document.getElementById('loader').style.display = 'block';
                            document.getElementById('loading-text').style.display = 'block';
                            document.getElementById('escrow-content').classList.add('hidden');
                            
                            // Check status after they click OK
                            let verificationResult = await verifyMoolrePayment(escrowId);
                            
                            if (verificationResult && verificationResult.txstatus == 1) {
                                await updateDoc(docRef, { status: 'FUNDED' });
                                alert("Payment Successful! Funds are now securely held in escrow.");
                                window.location.reload();
                            } else {
                                // Let's poll for up to 30 seconds
                                let attempts = 0;
                                let interval = setInterval(async () => {
                                    attempts++;
                                    try {
                                        verificationResult = await verifyMoolrePayment(escrowId);
                                        if (verificationResult && verificationResult.txstatus == 1) {
                                            clearInterval(interval);
                                            await updateDoc(docRef, { status: 'FUNDED' });
                                            alert("Payment Successful! Funds are now securely held in escrow.");
                                            window.location.reload();
                                        }
                                    } catch(e) { }
                                    
                                    if (attempts > 6) {
                                        clearInterval(interval);
                                        alert("Payment verification timed out. If you already paid, the status will automatically update shortly.");
                                        window.location.reload();
                                    }
                                }, 5000);
                            }
                        } catch (error) {
                            btnUssd.textContent = "Send USSD Prompt to Phone";
                            btnUssd.disabled = false;
                            alert("Failed to send USSD Prompt: " + error.message);
                        }
                    });
                }

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
                        try {
                            const sellerId = escrow.sellerId;
                            const amount = parseFloat(escrow.amount);
                            
                            // 1. Complete the Escrow
                            await updateDoc(docRef, { status: 'COMPLETED' });
                            
                            // 2. Add to Seller Wallet Balance
                            const sellerRef = doc(db, "users", sellerId);
                            const sellerSnap = await getDoc(sellerRef);
                            if (sellerSnap.exists()) {
                                const currentBalance = parseFloat(sellerSnap.data().walletBalance || 0);
                                await updateDoc(sellerRef, { walletBalance: currentBalance + amount });
                            }
                            
                            alert("Funds Released! Thank you for using TrustLink Escrow.");
                            window.location.reload();
                        } catch (err) {
                            alert("Error releasing funds: " + err.message);
                        }
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
                actionButtons.innerHTML = `<p style="color: var(--success); font-weight: 600;">This escrow has been successfully completed and funds were released to the seller.</p>`;
            } else if (status === 'DISPUTED') {
                statusBadge.textContent = 'Status: Disputed';
                statusBadge.classList.add('status-pending'); // Yellow/warning
                actionButtons.innerHTML = `<p style="color: var(--warning); font-weight: 600;">This escrow is currently under dispute review.</p>`;
            }
        };

        updateStatusUI(escrow.status);

        // Listen for real-time updates (e.g. from the Moolre Webhook)
        onSnapshot(docRef, (snap) => {
            if (snap.exists()) {
                const updatedData = snap.data();
                if (updatedData.status !== escrow.status) {
                    escrow.status = updatedData.status;
                    updateStatusUI(escrow.status);
                    
                    if (escrow.status === 'FUNDED') {
                        alert("Payment Successful! Your funds are now securely held in escrow.");
                    }
                }
            }
        });

    } catch (error) {
        console.error("Error fetching escrow:", error);
        document.getElementById('loading-text').textContent = "Database Error: " + error.message;
        document.getElementById('loader').style.display = 'none';
    }
});
