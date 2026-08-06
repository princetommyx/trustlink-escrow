import { db, functionsApp, httpsCallable } from "./firebase-config.js";
import { doc, getDoc, updateDoc, onSnapshot, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { computeFeeSplit, pickUserPhone } from "./moolre-service.js";

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

        // Handle Moolre Callback / Redirect Verification
        const paymentStatus = urlParams.get('payment');
        if (paymentStatus === 'success' && escrow.status === 'PENDING_PAYMENT') {
            document.getElementById('loading-text').textContent = "Verifying Payment...";
            try {
                const verifyCallable = httpsCallable(functionsApp, 'verifyMoolrePayment');
                const res = await verifyCallable({ escrowId });
                
                if (res.data && res.data.paid) {
                    alert("Payment Successful! Your funds are now securely held in escrow.");
                    if (escrow.redirectUrl) {
                        const sep = escrow.redirectUrl.includes('?') ? '&' : '?';
                        window.location.href = `${escrow.redirectUrl}${sep}escrow_id=${escrowId}&status=funded&reference=${escrow.customReference || ''}`;
                        return;
                    }
                }
                
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

        // Platform fee: buyer's share is added on top of the item amount.
        const rawAmount = Number(escrow.amount || escrow.totalAmount || escrow.price || 0);
        const fees = computeFeeSplit(rawAmount, escrow.feePercent || 0, escrow.feeAllocation || 'split');

        // Populate Data
        const formattedBuyerTotal = Number(fees.buyerTotal || rawAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const formattedRawAmount = rawAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        
        document.getElementById('escrow-amount').textContent = `GH₵ ${formattedBuyerTotal}`;
        const itemSubtotalEl = document.getElementById('item-subtotal-display');
        if (itemSubtotalEl) itemSubtotalEl.textContent = `GH₵ ${formattedRawAmount}`;
        const summarySubtotalEl = document.getElementById('summary-subtotal-display');
        if (summarySubtotalEl) summarySubtotalEl.textContent = `GH₵ ${formattedRawAmount}`;

        if (fees.buyerFee > 0) {
            document.getElementById('escrow-amount').insertAdjacentHTML('afterend',
                `<p style="color: var(--text-muted); font-size: 0.85rem; margin: -12px 0 16px;">Item: GH₵ ${formattedRawAmount} + GH₵ ${Number(fees.buyerFee).toFixed(2)} platform fee</p>`);
        }
        document.getElementById('seller-name').textContent = escrow.sellerName || 'Verified Vendor';
        document.getElementById('escrow-desc').textContent = escrow.description || 'Secure Transaction';
        document.getElementById('escrow-id-display').textContent = escrowId;

        // Display delivery window
        const deliveryFrom = escrow.deliveryDateFrom || escrow.deliveryDate;
        const deliveryTo = escrow.deliveryDateTo;
        if (deliveryFrom || deliveryTo) {
            const deliveryRow = document.getElementById('escrow-delivery-row');
            const deliverySpan = document.getElementById('escrow-delivery');
            if (deliveryRow && deliverySpan) {
                const fmtDate = (d) => {
                    if (!d) return '';
                    const dt = new Date(d + 'T00:00:00');
                    return isNaN(dt) ? d : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
                };
                const f = fmtDate(deliveryFrom);
                const t = fmtDate(deliveryTo);
                if (f && t && f !== t) {
                    deliverySpan.textContent = `${f} – ${t}`;
                } else {
                    deliverySpan.textContent = f || t;
                }
                deliveryRow.style.display = '';
            }
        }

        // Render based on Status
        const statusBadge = document.getElementById('escrow-status');
        const actionButtons = document.getElementById('action-buttons');
        
        const updateStatusUI = (status) => {
            statusBadge.className = 'status-badge';
            if (status === 'PENDING_PAYMENT') {
                statusBadge.textContent = 'Status: Pending Payment';
                statusBadge.classList.add('status-pending');
                
                actionButtons.innerHTML = `
                    <button id="btn-pay" class="btn btn-primary btn-large" style="width: 100%; margin-bottom: 8px;">Pay securely via Mobile Money</button>
                `;
                
                document.getElementById('btn-pay').addEventListener('click', async (e) => {
                    const phonePrompt = prompt("Enter your Mobile Money phone number (e.g. 0551234567):", escrow.buyerPhone || "");
                    if (!phonePrompt) return;

                    const btn = e.target;
                    btn.disabled = true;
                    btn.textContent = "Sending USSD Payment Prompt...";

                    try {
                        const createCheckout = httpsCallable(functionsApp, 'createMoolreCheckout');
                        const res = await createCheckout({
                            escrowId,
                            buyerPhone: phonePrompt,
                            channel: 13
                        });

                        if (res.data && res.data.success) {
                            alert(`USSD Payment prompt sent to ${phonePrompt}. Please enter your MoMo PIN on your phone to complete payment.`);
                            btn.textContent = "Awaiting Payment Confirmation...";
                        } else {
                            throw new Error("Failed to dispatch USSD prompt.");
                        }
                    } catch(err) {
                        btn.disabled = false;
                        btn.textContent = "Pay securely via Mobile Money";
                        alert("Payment prompt dispatch failed: " + err.message);
                    }
                });

                // Handle USSD Push Payment Form if present
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
                            const createCheckout = httpsCallable(functionsApp, 'createMoolreCheckout');
                            await createCheckout({
                                escrowId,
                                buyerPhone: phone,
                                channel: network
                            });

                            alert(`A prompt has been sent to ${phone}. Check your mobile phone and enter your PIN to approve the payment.`);
                            
                            document.getElementById('loading-text').textContent = "Verifying Payment...";
                            document.getElementById('loader').style.display = 'block';
                            document.getElementById('loading-text').style.display = 'block';
                            document.getElementById('escrow-content').classList.add('hidden');
                            
                            // Poll status via server-side Callable function
                            const verifyCallable = httpsCallable(functionsApp, 'verifyMoolrePayment');
                            let attempts = 0;
                            let interval = setInterval(async () => {
                                attempts++;
                                try {
                                    const vRes = await verifyCallable({ escrowId });
                                    if (vRes.data && vRes.data.paid) {
                                        clearInterval(interval);
                                        alert("Payment Successful! Funds are now securely held in escrow.");
                                        window.location.reload();
                                    }
                                } catch(e) { }

                                if (attempts > 6) {
                                    clearInterval(interval);
                                    alert("Payment verification pending. The status will automatically update once confirmed.");
                                    window.location.reload();
                                }
                            }, 5000);
                        } catch (error) {
                            btnUssd.textContent = "Send USSD Prompt to Phone";
                            btnUssd.disabled = false;
                            alert("Failed to send USSD Prompt: " + error.message);
                        }
                    });
                }

            } else if (status === 'FUNDS_ESCROWED' || status === 'FUNDED') {
                statusBadge.textContent = 'Status: Paid (Awaiting Dispatch)';
                statusBadge.classList.add('status-funded');
                actionButtons.innerHTML = `<p style="color: rgba(255,255,255,0.7); font-size: 0.9rem;">Your funds are securely locked in TrustLink Escrow. The seller has been notified to dispatch the item.</p>`;
                if (escrow.redirectUrl) {
                    const sep = escrow.redirectUrl.includes('?') ? '&' : '?';
                    actionButtons.innerHTML += `<button class="btn btn-primary btn-large" style="width: 100%; margin-top: 12px;" onclick="window.location.href='${escrow.redirectUrl}${sep}escrow_id=${escrowId}&status=funded&reference=${escrow.customReference || ''}'">Return to Vendor</button>`;
                }
                
            } else if (status === 'ITEM_SHIPPED' || status === 'DISPATCHED') {
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
                            
                            await updateDoc(docRef, { 
                                status: 'COMPLETED',
                                completedAt: serverTimestamp()
                            });
                            
                            const sellerRef = doc(db, "users", sellerId);
                            const sellerSnap = await getDoc(sellerRef);
                            if (sellerSnap.exists()) {
                                const currentBalance = parseFloat(sellerSnap.data().walletBalance || 0);
                                await updateDoc(sellerRef, { walletBalance: currentBalance + amount });
                            }

                            // Record audit log for financial settlement
                            try {
                                await addDoc(collection(db, "audit_logs"), {
                                    event: 'ESCROW_RELEASE_CONFIRMED',
                                    escrowId: escrowId,
                                    sellerId: sellerId,
                                    amount: amount,
                                    status: 'COMPLETED',
                                    actor: 'buyer',
                                    timestamp: serverTimestamp(),
                                    userAgent: navigator.userAgent
                                });
                            } catch (auditErr) {
                                console.warn("Audit logging error:", auditErr);
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
                        try {
                            await updateDoc(docRef, { 
                                status: 'DISPUTED',
                                disputedAt: serverTimestamp()
                            });

                            // Record audit log for dispute
                            try {
                                await addDoc(collection(db, "audit_logs"), {
                                    event: 'ESCROW_DISPUTE_RAISED',
                                    escrowId: escrowId,
                                    sellerId: escrow.sellerId || '',
                                    amount: parseFloat(escrow.amount || 0),
                                    status: 'DISPUTED',
                                    actor: 'buyer',
                                    timestamp: serverTimestamp(),
                                    userAgent: navigator.userAgent
                                });
                            } catch (auditErr) {
                                console.warn("Audit logging error:", auditErr);
                            }

                            alert("Dispute Raised. Support will contact you shortly.");
                            window.location.reload();
                        } catch (err) {
                            alert("Error raising dispute: " + err.message);
                        }
                    }
                });

            } else if (status === 'COMPLETED') {
                statusBadge.textContent = 'Status: Completed';
                statusBadge.classList.add('status-completed');
                actionButtons.innerHTML = `<p style="color: var(--success); font-weight: 600;">This escrow has been successfully completed and funds were released to the seller.</p>`;
            } else if (status === 'DISPUTED') {
                statusBadge.textContent = 'Status: Disputed';
                statusBadge.classList.add('status-pending');
                actionButtons.innerHTML = `<p style="color: var(--warning); font-weight: 600;">This escrow is currently under dispute review.</p>`;
            }
        };

        updateStatusUI(escrow.status);

        // Listen for real-time updates
        onSnapshot(docRef, (snap) => {
            if (snap.exists()) {
                const updatedData = snap.data();
                if (updatedData.status !== escrow.status) {
                    escrow.status = updatedData.status;
                    updateStatusUI(escrow.status);
                    
                    if (escrow.status === 'FUNDS_ESCROWED' || escrow.status === 'FUNDED') {
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
