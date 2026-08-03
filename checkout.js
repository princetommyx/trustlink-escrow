import { db } from "./firebase-config.js";
import { doc, getDoc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initiateMoolreCheckout, MOOLRE_STATIC_POS_LINK, verifyMoolrePayment, initiateUSSDPushPayment, computeFeeSplit, sendEscrowStatusSMS, pickUserPhone } from "./moolre-service.js";

/**
 * Global UI handler for toggling payment methods
 */
window.selectPaymentMethod = function (method) {
    const cardWeb = document.getElementById('card-moolre-web');
    const cardUssd = document.getElementById('card-moolre-ussd');
    const ussdContainer = document.getElementById('ussd-form-container');
    const btnPay = document.getElementById('btn-pay');
    const btnPayUssd = document.getElementById('btn-pay-ussd');

    const isWeb = method === 'web';

    if (cardWeb) {
        cardWeb.classList.toggle('active', isWeb);
        cardWeb.setAttribute('aria-pressed', isWeb ? 'true' : 'false');
    }
    if (cardUssd) {
        cardUssd.classList.toggle('active', !isWeb);
        cardUssd.setAttribute('aria-pressed', !isWeb ? 'true' : 'false');
    }
    if (ussdContainer) {
        ussdContainer.style.display = isWeb ? 'none' : 'block';
    }
    if (btnPay) {
        btnPay.style.display = isWeb ? 'block' : 'none';
    }
    if (btnPayUssd) {
        btnPayUssd.style.display = isWeb ? 'none' : 'block';
    }
};

/**
 * Format delivery dates nicely
 */
function formatDeliveryWindow(deliveryFrom, deliveryTo) {
    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const dt = new Date(dateStr + 'T00:00:00');
        return Number.isNaN(dt.getTime())
            ? dateStr
            : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    };
    const fromFormatted = formatDate(deliveryFrom);
    const toFormatted = formatDate(deliveryTo);

    if (fromFormatted && toFormatted && fromFormatted !== toFormatted) {
        return `${fromFormatted} – ${toFormatted}`;
    }
    return fromFormatted || toFormatted;
}

/**
 * SMS Notification helpers
 */
async function notifySeller(escrow, escrowId, text) {
    if (!escrow.sellerId) return;
    try {
        const sellerSnap = await getDoc(doc(db, "users", escrow.sellerId));
        const sellerPhone = pickUserPhone(sellerSnap.exists() ? sellerSnap.data() : null);
        if (sellerPhone) {
            await sendEscrowStatusSMS(sellerPhone, text, `${escrowId}-status`);
        }
    } catch (err) {
        console.warn("Seller status SMS failed:", err);
    }
}

async function notifyBuyer(escrow, escrowId, itemLabel) {
    if (!escrow.buyerPhone) return;
    try {
        const trackUrl = `${window.location.origin}${window.location.pathname}?id=${escrowId}`;
        const amountStr = Number(escrow.amount || 0).toFixed(2);
        const msg = `TrustLink: Payment received! GH₵ ${amountStr} for "${itemLabel}" is now held safely in escrow. It will only be released to the seller after you confirm delivery. Track your order: ${trackUrl}`;
        await sendEscrowStatusSMS(escrow.buyerPhone, msg, `${escrowId}-receipt`);
    } catch (err) {
        console.warn("Buyer receipt SMS failed:", err);
    }
}

/**
 * Execute post-payment success workflow (update status, notify, redirect)
 */
async function executePaymentSuccess(docRef, escrow, escrowId, itemLabel) {
    await updateDoc(docRef, { status: 'FUNDED' });
    escrow.status = 'FUNDED';

    const amountStr = Number(escrow.amount || 0).toFixed(2);
    await notifyBuyer(escrow, escrowId, itemLabel);
    await notifySeller(escrow, escrowId, `TrustLink: Great news! The buyer has paid GH₵ ${amountStr} for "${itemLabel}". The money is secured in escrow - please dispatch the item and mark it as dispatched on your dashboard.`);

    alert("Payment Successful! Your funds are now securely held in escrow.");

    if (escrow.redirectUrl) {
        const sep = escrow.redirectUrl.includes('?') ? '&' : '?';
        window.location.href = `${escrow.redirectUrl}${sep}escrow_id=${escrowId}&status=funded&reference=${escrow.customReference || ''}`;
    }
}

/**
 * Verify payment status with Moolre
 */
async function checkMoolreSuccess(escrowId) {
    try {
        const res = await verifyMoolrePayment(escrowId);
        return Boolean(res && (res.txstatus === 1 || res.txstatus === '1'));
    } catch (err) {
        console.warn("Moolre verification check failed:", err);
        return false;
    }
}

/**
 * Polling helper for USSD verification
 */
function pollForUssdPayment(escrowId, onVerified) {
    let attempts = 0;
    const maxAttempts = 6;
    const interval = setInterval(async () => {
        attempts += 1;
        const isPaid = await checkMoolreSuccess(escrowId);
        if (isPaid) {
            clearInterval(interval);
            await onVerified();
        } else if (attempts >= maxAttempts) {
            clearInterval(interval);
            alert("Payment verification timed out. If you already approved on your phone, the status will update shortly.");
            window.location.reload();
        }
    }, 5000);
}

/**
 * Action button handlers
 */
function setupWebPayment(escrow, escrowId, fees) {
    const btnPay = document.getElementById('btn-pay');
    if (!btnPay) return;

    btnPay.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = "Connecting to Moolre...";

        try {
            const customer = {
                email: escrow.buyerEmail || "buyer@trustlink.com",
                name: escrow.sellerName || "TrustLink Buyer"
            };
            const callbackUrl = `${window.location.origin}${window.location.pathname}?id=${escrowId}&payment=success`;
            const checkout = await initiateMoolreCheckout(fees.buyerTotal, escrow.description, customer, escrowId, callbackUrl);
            const payUrl = checkout && (checkout.authorization_url || checkout.url || checkout.link);

            if (!payUrl) {
                throw new Error("Moolre response did not include a checkout URL.");
            }

            window.open(payUrl, "_blank");
            btn.textContent = "Awaiting Payment Confirmation...";
        } catch (err) {
            console.warn("Moolre API Failed, falling back to static POS link.", err.message);
            window.open(MOOLRE_STATIC_POS_LINK, "_blank");
            btn.disabled = true;
            btn.textContent = "Awaiting Payment Confirmation...";
        }
    });
}

function setupUssdPayment(escrowId, fees, onVerified) {
    const btnUssd = document.getElementById('btn-pay-ussd');
    if (!btnUssd) return;

    btnUssd.addEventListener('click', async () => {
        const network = document.getElementById('ussd-network')?.value || '13';
        const phone = document.getElementById('ussd-phone')?.value?.trim();

        if (!phone) {
            alert("Please enter a valid phone number.");
            return;
        }

        btnUssd.textContent = "Sending Prompt...";
        btnUssd.disabled = true;

        try {
            await initiateUSSDPushPayment(phone, fees.buyerTotal, network, escrowId);
            alert(`A prompt has been sent to ${phone}. Please check your phone and enter your PIN to approve the payment.\n\nClick OK once you have paid.`);

            document.getElementById('loading-text').textContent = "Verifying Payment with Moolre...";
            document.getElementById('loader').style.display = 'block';
            document.getElementById('loading-text').style.display = 'block';
            document.getElementById('escrow-content').classList.add('hidden');

            const isSuccess = await checkMoolreSuccess(escrowId);
            if (isSuccess) {
                await onVerified();
            } else {
                pollForUssdPayment(escrowId, onVerified);
            }
        } catch (err) {
            btnUssd.textContent = "Send USSD Prompt to Phone";
            btnUssd.disabled = false;
            alert("Failed to send USSD Prompt: " + err.message);
        }
    });
}

function setupReleaseAndDisputeButtons(docRef, escrow) {
    const btnRelease = document.getElementById('btn-release');
    if (btnRelease) {
        btnRelease.addEventListener('click', async () => {
            if (window.confirm("Are you sure you want to release the funds to the seller? This action cannot be undone.")) {
                try {
                    const sellerId = escrow.sellerId;
                    const amount = Number(escrow.amount || 0);

                    await updateDoc(docRef, { status: 'COMPLETED' });

                    if (sellerId) {
                        const sellerRef = doc(db, "users", sellerId);
                        const sellerSnap = await getDoc(sellerRef);
                        if (sellerSnap.exists()) {
                            const currentBalance = Number(sellerSnap.data().walletBalance || 0);
                            await updateDoc(sellerRef, { walletBalance: currentBalance + amount });
                        }
                    }

                    alert("Funds Released! Thank you for using TrustLink Escrow.");
                    window.location.reload();
                } catch (err) {
                    alert("Error releasing funds: " + err.message);
                }
            }
        });
    }

    const btnDispute = document.getElementById('btn-dispute');
    if (btnDispute) {
        btnDispute.addEventListener('click', async () => {
            if (window.confirm("Are you sure you want to raise a dispute? Escrow funds will remain locked while an admin reviews the case.")) {
                try {
                    await updateDoc(docRef, { status: 'DISPUTED' });
                    alert("Dispute Raised. Support will contact you shortly.");
                    window.location.reload();
                } catch (err) {
                    alert("Error raising dispute: " + err.message);
                }
            }
        });
    }
}

/**
 * Render Status Badges and Dynamic Actions
 */
function updateStatusUI(status, docRef, escrow, escrowId, fees, itemLabel) {
    const statusBadge = document.getElementById('escrow-status');
    const actionButtons = document.getElementById('action-buttons');
    if (!statusBadge || !actionButtons) return;

    statusBadge.className = 'status-badge';

    if (status === 'PENDING_PAYMENT') {
        statusBadge.textContent = 'Status: Pending Payment';
        statusBadge.classList.add('status-pending');
        actionButtons.innerHTML = `<button type="button" id="btn-pay" class="btn-pay">Pay securely via Moolre</button>`;

        setupWebPayment(escrow, escrowId, fees);
        setupUssdPayment(escrowId, fees, async () => {
            await executePaymentSuccess(docRef, escrow, escrowId, itemLabel);
        });

    } else if (status === 'FUNDED') {
        statusBadge.textContent = 'Status: Paid (Awaiting Dispatch)';
        statusBadge.classList.add('status-funded');
        actionButtons.innerHTML = `<p style="color: #4B5563; font-size: 0.9rem;">Your funds are securely locked in TrustLink Escrow. The seller has been notified to dispatch the item.</p>`;

        if (escrow.redirectUrl) {
            const sep = escrow.redirectUrl.includes('?') ? '&' : '?';
            actionButtons.innerHTML += `<button type="button" class="btn-pay" style="margin-top: 12px;" onclick="window.location.href='${escrow.redirectUrl}${sep}escrow_id=${escrowId}&status=funded&reference=${escrow.customReference || ''}'">Return to Vendor</button>`;
        }

    } else if (status === 'DISPATCHED') {
        statusBadge.textContent = 'Status: Dispatched';
        statusBadge.classList.add('status-dispatched');
        actionButtons.innerHTML = `
            <p style="color: #4B5563; font-size: 0.9rem; margin-bottom: 12px;">The seller has dispatched the item. Once you receive and inspect it, confirm to release the funds.</p>
            <button type="button" id="btn-release" class="btn-pay" style="margin-bottom: 8px;">Confirm & Release Funds</button>
            <button type="button" id="btn-dispute" class="btn-pay" style="background: transparent; border: 1px solid #DC2626; color: #DC2626;">Raise Dispute</button>
        `;
        setupReleaseAndDisputeButtons(docRef, escrow);

    } else if (status === 'COMPLETED') {
        statusBadge.textContent = 'Status: Completed';
        statusBadge.classList.add('status-completed');
        actionButtons.innerHTML = `<p style="color: #047857; font-weight: 600;">This escrow has been successfully completed and funds were released to the seller.</p>`;

    } else if (status === 'DISPUTED') {
        statusBadge.textContent = 'Status: Disputed';
        statusBadge.classList.add('status-pending');
        actionButtons.innerHTML = `<p style="color: #92400E; font-weight: 600;">This escrow is currently under dispute review.</p>`;
    }
}

/**
 * Handle payment verification callback redirect
 */
async function handlePaymentCallback(urlParams, escrow, escrowId, itemLabel, docRef) {
    const paymentStatus = urlParams.get('payment');
    if (paymentStatus !== 'success' || escrow.status !== 'PENDING_PAYMENT') return;

    document.getElementById('loading-text').textContent = "Verifying Payment with Moolre...";
    const isVerified = await checkMoolreSuccess(escrowId);
    if (isVerified) {
        await executePaymentSuccess(docRef, escrow, escrowId, itemLabel);
        window.history.replaceState({}, document.title, `${window.location.pathname}?id=${escrowId}`);
    } else {
        alert("Payment verification failed or is still processing. If you have been charged, please wait a moment and refresh.");
    }
}

/**
 * Populate Order Summary UI Elements
 */
function populateOrderSummary(escrow, escrowId, fees, rawAmount) {
    const formattedBuyerTotal = Number(fees.buyerTotal || rawAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formattedRawAmount = rawAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    document.getElementById('escrow-amount').textContent = `GH₵ ${formattedBuyerTotal}`;
    const itemSubtotalEl = document.getElementById('item-subtotal-display');
    if (itemSubtotalEl) itemSubtotalEl.textContent = `GH₵ ${formattedRawAmount}`;
    const summarySubtotalEl = document.getElementById('summary-subtotal-display');
    if (summarySubtotalEl) summarySubtotalEl.textContent = `GH₵ ${formattedRawAmount}`;

    if (fees.buyerFee > 0) {
        const feeRow = document.getElementById('fee-row');
        if (feeRow) feeRow.style.display = 'flex';
        const feeDisp = document.getElementById('summary-fee-display');
        if (feeDisp) feeDisp.textContent = `GH₵ ${Number(fees.buyerFee).toFixed(2)}`;
    }

    document.getElementById('seller-name').textContent = escrow.sellerName || 'Verified Vendor';
    document.getElementById('escrow-desc').textContent = escrow.description || 'Secure Transaction';
    document.getElementById('escrow-id-display').textContent = escrowId;

    const deliveryText = formatDeliveryWindow(escrow.deliveryDateFrom || escrow.deliveryDate, escrow.deliveryDateTo);
    if (deliveryText) {
        const deliveryRow = document.getElementById('escrow-delivery-row');
        const deliverySpan = document.getElementById('escrow-delivery');
        if (deliveryRow && deliverySpan) {
            deliverySpan.textContent = deliveryText;
            deliveryRow.style.display = '';
        }
    }
}

/**
 * Subscribe to real-time status updates
 */
function listenForEscrowUpdates(docRef, escrow, escrowId, fees, itemLabel) {
    onSnapshot(docRef, (snap) => {
        if (!snap.exists()) return;
        const updatedData = snap.data();
        if (updatedData.status === escrow.status) return;

        escrow.status = updatedData.status;
        updateStatusUI(escrow.status, docRef, escrow, escrowId, fees, itemLabel);

        if (escrow.status === 'FUNDED') {
            alert("Payment Successful! Your funds are now securely held in escrow.");
        }
    });
}

/**
 * Main Initialization Flow
 */
document.addEventListener('DOMContentLoaded', async () => {
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
        const itemLabel = (escrow.description || 'your item').replace(/\s+/g, ' ').trim().substring(0, 60);

        await handlePaymentCallback(urlParams, escrow, escrowId, itemLabel, docRef);

        // Hide loader, show content
        document.getElementById('loader').style.display = 'none';
        document.getElementById('loading-text').style.display = 'none';
        document.getElementById('escrow-content').classList.remove('hidden');

        // Platform fee calculation
        const rawAmount = Number(escrow.amount || escrow.totalAmount || escrow.price || 0);
        const fees = computeFeeSplit(rawAmount, escrow.feePercent || 0, escrow.feeAllocation || 'split');

        // Populate Order Summary
        populateOrderSummary(escrow, escrowId, fees, rawAmount);

        // Render UI
        updateStatusUI(escrow.status, docRef, escrow, escrowId, fees, itemLabel);

        // Real-time updates listener
        listenForEscrowUpdates(docRef, escrow, escrowId, fees, itemLabel);

    } catch (err) {
        console.error("Error fetching escrow:", err);
        document.getElementById('loading-text').textContent = "Database Error: " + err.message;
        document.getElementById('loader').style.display = 'none';
    }
});
