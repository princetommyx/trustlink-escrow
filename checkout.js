import { db } from "./firebase-config.js";
import { callApi } from "./api-client.js";
import { doc, getDoc, setDoc, updateDoc, onSnapshot, collection, addDoc, serverTimestamp, increment } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { computeFeeSplit, pickUserPhone } from "./moolre-service.js";

document.addEventListener('DOMContentLoaded', async () => {
    // Extract ID and fallback attributes from URL
    const urlParams = new URLSearchParams(window.location.search);
    const escrowId = urlParams.get('id');
    const qAmount = urlParams.get('amount') || urlParams.get('price');
    const qItem = urlParams.get('item') || urlParams.get('desc') || urlParams.get('name') || urlParams.get('title');
    const qSeller = urlParams.get('seller') || urlParams.get('vendor');
    const qBuyer = urlParams.get('buyer') || urlParams.get('phone');
    const qSplit = urlParams.get('split') || urlParams.get('feeAllocation');
    const qDelivery = urlParams.get('delivery') || urlParams.get('deliveryDate') || urlParams.get('date');
    
    if (!escrowId) {
        document.getElementById('loading-text').textContent = "Error: Invalid Checkout Link";
        document.getElementById('loader').style.display = 'none';
        return;
    }

    try {
        const docRef = doc(db, "escrows", escrowId);
        let escrow = null;

        try {
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                escrow = docSnap.data();
            }
        } catch (fetchErr) {
            console.warn("Firestore direct read notice:", fetchErr);
        }

        // If doc wasn't found in Firestore but query params provide escrow details
        if (!escrow && qAmount && !isNaN(parseFloat(qAmount)) && parseFloat(qAmount) > 0) {
            const parsedAmt = parseFloat(qAmount);
            const deliveryVal = qDelivery ? decodeURIComponent(qDelivery) : "";
            escrow = {
                amount: parsedAmt,
                totalAmount: parsedAmt,
                description: qItem ? decodeURIComponent(qItem) : "Escrow Transaction",
                sellerName: qSeller ? decodeURIComponent(qSeller) : "Verified Vendor",
                sellerId: "TELEGRAM_BOT",
                buyerPhone: qBuyer ? decodeURIComponent(qBuyer) : "",
                deliveryDate: deliveryVal,
                deliveryDateFrom: deliveryVal,
                deliveryDateTo: deliveryVal,
                feeAllocation: qSplit ? decodeURIComponent(qSplit) : "buyer",
                feePercent: 1.5,
                status: 'PENDING_PAYMENT',
                source: 'TELEGRAM_BOT'
            };

            // Auto-persist to Firestore in background so future reads & listeners sync
            try {
                await setDoc(docRef, {
                    ...escrow,
                    createdAt: serverTimestamp()
                }, { merge: true });
            } catch (persistErr) {
                console.warn("Auto-persist escrow error:", persistErr);
            }
        }

        if (!escrow) {
            document.getElementById('loading-text').textContent = "Error: Escrow not found";
            document.getElementById('loader').style.display = 'none';
            return;
        }

        // Handle Moolre Callback / Redirect Verification
        const paymentStatus = urlParams.get('payment');
        if (paymentStatus === 'success' && escrow.status === 'PENDING_PAYMENT') {
            document.getElementById('loading-text').textContent = "Verifying Payment...";
            try {
                const verifyCallable = callApi('verifyMoolrePayment');
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
        const fees = computeFeeSplit(rawAmount, escrow.feePercent || 0, escrow.feeAllocation || 'buyer');

        // Populate Data
        // Buyer total includes escrow fee (TrustLink's revenue) — no extra platform fee
        const formattedBuyerTotal = Number(fees.buyerTotal || rawAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const formattedRawAmount = rawAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        
        document.getElementById('escrow-amount').textContent = `GH₵ ${formattedBuyerTotal}`;
        const itemSubtotalEl = document.getElementById('item-subtotal-display');
        if (itemSubtotalEl) itemSubtotalEl.textContent = `GH₵ ${formattedRawAmount}`;
        const summarySubtotalEl = document.getElementById('summary-subtotal-display');
        if (summarySubtotalEl) summarySubtotalEl.textContent = `GH₵ ${formattedRawAmount}`;

        const feeRow = document.getElementById('fee-row');
        const summaryFeeEl = document.getElementById('summary-fee-display');
        if (fees.buyerFee > 0) {
            if (feeRow) feeRow.style.display = 'flex';
            if (summaryFeeEl) summaryFeeEl.textContent = `GH₵ ${Number(fees.buyerFee).toFixed(2)}`;
        } else {
            if (feeRow) feeRow.style.display = 'none';
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
                    <button id="btn-pay-link" class="btn btn-primary btn-large" style="width: 100%; margin-bottom: 16px;">Pay via Secure Web Link</button>
                `;
                
                document.getElementById('btn-pay-link').addEventListener('click', async (e) => {
                    const btn = e.target;
                    const originalText = btn.textContent;
                    btn.disabled = true;
                    btn.textContent = "Generating Secure Link...";

                    try {
                        const rawAmt = Number(escrow.amount || escrow.totalAmount || escrow.price || 0);
                        const feeSplit = computeFeeSplit(rawAmt, escrow.feePercent || 0, escrow.feeAllocation || 'buyer');
                        const totalToPay = Number(feeSplit.buyerTotal || rawAmt);

                        const createCheckout = callApi('createMoolreCheckout');
                        const res = await createCheckout({
                            orderId: escrowId,
                            amount: totalToPay,
                            email: escrow.buyerEmail || escrow.sellerEmail || 'buyer@trustlinkgh.online',
                            phone: escrow.buyerPhone || '',
                            metadata: { escrowId, description: escrow.description }
                        });

                        if (res.data && res.data.checkoutUrl) {
                            window.location.href = res.data.checkoutUrl;
                        } else {
                            throw new Error("Could not retrieve payment link");
                        }
                    } catch(err) {
                        btn.disabled = false;
                        btn.textContent = originalText;
                        alert("Failed to get payment link: " + err.message);
                    }
                });

                // Handle USSD Push Payment — only asks for MoMo number, order data comes from escrow
                const btnUssd = document.getElementById('btn-pay-ussd');
                if (btnUssd) {
                    btnUssd.addEventListener('click', async () => {
                        const network = document.getElementById('ussd-network')?.value || 'MTN';
                        const phone = document.getElementById('ussd-phone')?.value?.trim();
                        
                        if (!phone) {
                            alert("Please enter the MoMo number to send the payment prompt to.");
                            return;
                        }
                        
                        btnUssd.textContent = "Sending Prompt...";
                        btnUssd.disabled = true;
                        
                        try {
                            const rawAmt = Number(escrow.amount || escrow.totalAmount || escrow.price || 0);
                            const feeSplit = computeFeeSplit(rawAmt, escrow.feePercent || 0, escrow.feeAllocation || 'buyer');
                            const totalToPay = Number(feeSplit.buyerTotal || rawAmt);

                            // Use dedicated USSD push endpoint (vas/collect) — sends real MoMo prompt
                            const sendPush = callApi('sendUssdPush');
                            let res = await sendPush({
                                orderId: escrowId,
                                amount: totalToPay,
                                phone: phone,
                                network: network
                            });

                            if (res.data && res.data.code === 'TP14') {
                                // Moolre sent an SMS verification code
                                const otp = prompt(`Moolre sent a verification code to ${phone} via SMS. Please enter it here:`);
                                if (!otp) {
                                    alert("Verification code is required to proceed.");
                                    btnUssd.textContent = "Pay via Mobile Money";
                                    btnUssd.disabled = false;
                                    return;
                                }
                                
                                // Retry with OTP and a new unique reference
                                res = await sendPush({
                                    orderId: escrowId + '-OTP-' + Date.now(),
                                    amount: totalToPay,
                                    phone: phone,
                                    network: network,
                                    otpcode: otp
                                });
                            }

                            const reference = res.data?.reference || escrowId;
                            alert(`A payment prompt has been sent to ${phone}. Approve on your phone to complete payment.`);
                            
                            document.getElementById('loading-text').textContent = "Waiting for payment confirmation...";
                            document.getElementById('loader').style.display = 'block';
                            document.getElementById('loading-text').style.display = 'block';
                            document.getElementById('escrow-content').classList.add('hidden');
                            
                            // Poll for confirmation (webhook updates Firestore)
                            const verifyCallable = callApi('verifyMoolrePayment');
                            let attempts = 0;
                            const interval = setInterval(async () => {
                                attempts++;
                                try {
                                    const vRes = await verifyCallable({ reference });
                                    if (vRes.data && (vRes.data.paid || vRes.data.status === 'success')) {
                                        clearInterval(interval);
                                        alert("Payment Successful! Funds are now securely held in escrow.");
                                        window.location.reload();
                                    }
                                } catch(e) { /* keep polling */ }

                                if (attempts > 12) {
                                    clearInterval(interval);
                                    alert("Payment is being processed. This page will update automatically when confirmed.");
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

                // Handle Manual POS Payment Form if present
                const btnManual = document.getElementById('btn-pay-manual');
                if (btnManual) {
                    btnManual.addEventListener('click', async () => {
                        const txnId = document.getElementById('manual-txn-id').value.trim();
                        
                        if(!txnId) {
                            alert("Please enter your Transaction ID or Reference.");
                            return;
                        }
                        
                        btnManual.textContent = "Submitting Proof...";
                        btnManual.disabled = true;
                        
                        try {
                            await updateDoc(docRef, {
                                status: 'AWAITING_VERIFICATION',
                                manualPaymentProof: txnId,
                                proofSubmittedAt: serverTimestamp()
                            });
                            
                            alert(`Your payment proof (ID: ${txnId}) has been submitted successfully! An admin will verify the payment shortly.`);
                            window.location.reload();
                        } catch (error) {
                            btnManual.textContent = "Submit Payment Proof";
                            btnManual.disabled = false;
                            alert("Failed to submit proof: " + error.message);
                        }
                    });
                }

            } else if (status === 'AWAITING_VERIFICATION') {
                statusBadge.textContent = 'Status: Awaiting Verification';
                statusBadge.classList.add('status-pending');
                actionButtons.innerHTML = `<p style="color: #D97706; font-weight: 600;">Your manual payment proof has been submitted and is currently being verified by an admin.</p>`;
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
                            
                            // Credit seller their full listed amount
                            const sellerRef = doc(db, "users", sellerId);
                            const sellerSnap = await getDoc(sellerRef);
                            if (sellerSnap.exists()) {
                                const currentBalance = parseFloat(sellerSnap.data().walletBalance || 0);
                                await updateDoc(sellerRef, { walletBalance: currentBalance + amount });
                            }

                            // Credit Escrow Protection Fee to TrustLink's account
                            const rawAmt = Number(escrow.amount || amount || 0);
                            const feeSplit = computeFeeSplit(rawAmt, escrow.feePercent || 0, escrow.feeAllocation || 'buyer');
                            const trustlinkEarning = Number(feeSplit.buyerFee || 0);
                            if (trustlinkEarning > 0) {
                                const platformRef = doc(db, "accounts", "trustlink");
                                await updateDoc(platformRef, {
                                    balance: increment(trustlinkEarning),
                                    totalTransactions: increment(1),
                                    lastUpdated: serverTimestamp()
                                }).catch(async () => {
                                    await setDoc(platformRef, {
                                        balance: trustlinkEarning,
                                        totalTransactions: 1,
                                        lastUpdated: serverTimestamp()
                                    });
                                });
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
