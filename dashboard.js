import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, collection, addDoc, query, where, getDocs, serverTimestamp, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initiateMoolreCheckout, sendSMSNotification, sendWhatsAppNotification, generateMoolrePaymentID } from "./moolre-service.js";

let currentUser = null;

// Navigation Logic
const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view-section');
const topbarTitle = document.getElementById('current-view-title');

navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Remove active class from all
        navItems.forEach(nav => nav.classList.remove('active'));
        views.forEach(view => view.classList.add('hidden'));
        
        // Add active to clicked
        item.classList.add('active');
        const targetId = item.getAttribute('data-target');
        document.getElementById(targetId).classList.remove('hidden');
        
        // Update Title
        topbarTitle.textContent = item.querySelector('.nav-text').textContent.trim();
    });
});

// Collapse Sidebar Logic
const collapseBtn = document.getElementById('btn-collapse');
const topbarMenuToggle = document.getElementById('topbar-menu-toggle');
const sidebar = document.querySelector('.sidebar');

if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });
}

if (topbarMenuToggle) {
    topbarMenuToggle.addEventListener('click', () => {
        sidebar.classList.remove('collapsed');
    });
}

// Initial GSAP Animations
if (typeof gsap !== 'undefined') {
    // Removed stagger for nav-items as it causes rendering misalignment bugs on Windows
    // Animate stats cards
    gsap.from('.stat-card', { opacity: 0, y: 30, duration: 0.8, stagger: 0.1, ease: 'power3.out', delay: 0.2 });
    // Animate portals
    gsap.from('.portal-card', { opacity: 0, y: 20, duration: 0.8, ease: 'power3.out', delay: 0.4 });
}

// Escrow Toggles (Buyer / Seller)
const toggleBuyer = document.getElementById('toggle-buyer');
const toggleSeller = document.getElementById('toggle-seller');
const buyerEscrows = document.getElementById('buyer-escrows');
const sellerEscrows = document.getElementById('seller-escrows');

if(toggleBuyer && toggleSeller) {
    toggleBuyer.addEventListener('click', () => {
        toggleBuyer.classList.add('active');
        toggleSeller.classList.remove('active');
        buyerEscrows.classList.remove('hidden');
        sellerEscrows.classList.add('hidden');
    });

    toggleSeller.addEventListener('click', () => {
        toggleSeller.classList.add('active');
        toggleBuyer.classList.remove('active');
        sellerEscrows.classList.remove('hidden');
        buyerEscrows.classList.add('hidden');
    });
}

// Authentication Protection & User Data
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }
    
    // Check if Admin
    if (user.email === 'admin@trustlink.com' || user.email === 'test@trustlink.com') {
        window.location.href = "admin-dashboard.html";
        return;
    }
    
    try {
        onSnapshot(doc(db, "users", user.uid), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.role === 'admin') {
                    window.location.href = "admin-dashboard.html";
                    return;
                }
                document.getElementById('user-name').textContent = data.fullName;
                const balance = parseFloat(data.walletBalance || 0).toFixed(2);
                document.getElementById('overview-balance').textContent = `GH₵ ${balance}`;
                if(document.getElementById('wallet-available-balance')) {
                    document.getElementById('wallet-available-balance').textContent = `GH₵ ${balance}`;
                }
                
                if(!currentUser) {
                    currentUser = user;
                    fetchProducts();
                    loadEscrows();
                }
            } else {
                document.getElementById('user-name').textContent = user.email.split('@')[0];
                if(!currentUser) {
                    currentUser = user;
                    fetchProducts();
                    loadEscrows();
                }
            }
        });
    } catch(e) {
        document.getElementById('user-name').textContent = user.email.split('@')[0];
        if(!currentUser) {
            currentUser = user;
            fetchProducts();
            loadEscrows();
        }
    }
});

let escrowStats = { activeSeller: 0, activeBuyer: 0, pendingSeller: 0, pendingBuyer: 0 };
let recentActivities = [];

function updateOverviewStats() {
    const totalActive = escrowStats.activeSeller + escrowStats.activeBuyer;
    const totalPending = escrowStats.pendingSeller + escrowStats.pendingBuyer;
    if(document.getElementById('overview-active-escrows')) document.getElementById('overview-active-escrows').textContent = totalActive;
    if(document.getElementById('overview-pending-releases')) document.getElementById('overview-pending-releases').textContent = totalPending;
    
    // Sort recent activities by timestamp (descending)
    recentActivities.sort((a, b) => b.time - a.time);
    const activityContainer = document.getElementById('recent-activity-list');
    if(activityContainer) {
        if(recentActivities.length === 0) {
            activityContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 20px;">No recent activity</p>';
        } else {
            activityContainer.innerHTML = '';
            recentActivities.slice(0, 5).forEach(act => {
                activityContainer.innerHTML += `
                    <div class="activity-item">
                        <div class="activity-icon bg-primary"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 20px; height: 20px;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>
                        <div class="activity-details">
                            <h4>${act.title}</h4>
                            <p>${act.description}</p>
                        </div>
                        <div class="activity-time">${new Date(act.time).toLocaleString()}</div>
                    </div>
                `;
            });
        }
    }
}

// Load Escrows
function loadEscrows() {
    if (!currentUser) return;
    
    // We will use two listeners to populate Seller and Buyer tabs
    // Note: To query by buyerPhone, we would need to know the current user's phone.
    // For now, we query by buyerEmail if it matches the current user.
    // (If the buyer clicks the public checkout link, they see it there anyway).

    const sellerQ = query(collection(db, "escrows"), where("sellerId", "==", currentUser.uid));
    
    onSnapshot(sellerQ, (snapshot) => {
        const sellerEscrowsContainer = document.getElementById('seller-escrows');
        if (!sellerEscrowsContainer) return;
        
        if (snapshot.empty) {
            sellerEscrowsContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">You have not created any escrows as a seller.</p>';
        } else {
            sellerEscrowsContainer.innerHTML = '';
            escrowStats.activeSeller = 0;
            escrowStats.pendingSeller = 0;
            // Remove old seller activities
            recentActivities = recentActivities.filter(a => a.type !== 'seller');
            
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const escrowId = docSnap.id;
                
                if (data.status !== 'COMPLETED' && data.status !== 'DISPUTED') escrowStats.activeSeller++;
                if (data.status === 'FUNDED' || data.status === 'DISPATCHED') escrowStats.pendingSeller++;
                
                if(data.createdAt) {
                    recentActivities.push({
                        type: 'seller',
                        time: data.createdAt.toMillis ? data.createdAt.toMillis() : Date.now(),
                        title: `Escrow ${data.status.replace('_', ' ')}`,
                        description: `Selling: ${data.description} (GH₵ ${data.amount})`
                    });
                }
                
                let statusUI = '';
                let actionBtn = '';
                
                if (data.status === 'PENDING_PAYMENT') {
                    statusUI = `<span style="background-color: rgba(245, 158, 11, 0.15); color: var(--warning); border: 1px solid var(--warning); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 700;">AWAITING PAYMENT</span>`;
                    actionBtn = `<button class="btn btn-outline" style="border-color: var(--primary); color: var(--primary);" onclick="window.copyToClipboard('${window.location.origin}/checkout.html?id=${escrowId}')">COPY LINK</button>`;
                } else if (data.status === 'FUNDED') {
                    statusUI = `<span style="background-color: rgba(59, 130, 246, 0.15); color: #3b82f6; border: 1px solid #3b82f6; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 700;">FUNDED - DISPATCH NOW</span>`;
                    actionBtn = `<button class="btn btn-primary" onclick="window.dispatchItem('${escrowId}')">MARK AS DISPATCHED</button>`;
                } else if (data.status === 'DISPATCHED') {
                    statusUI = `<span style="background-color: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid var(--success); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 700;">DISPATCHED</span>`;
                } else if (data.status === 'COMPLETED') {
                    statusUI = `<span style="background-color: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid var(--success); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 700;">COMPLETED</span>`;
                } else if (data.status === 'DISPUTED') {
                    statusUI = `<span style="background-color: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid var(--danger); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 700;">DISPUTED</span>`;
                }

                sellerEscrowsContainer.innerHTML += `
                    <div class="order-ledger-row">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                            <span style="font-weight: 700; color: #60A5FA;">${data.description} - #${escrowId.substring(0, 8).toUpperCase()}</span>
                            ${statusUI}
                        </div>
                        <p style="margin: 0 0 1rem 0; color: var(--text-muted);"><strong>Value:</strong> GH₵ ${parseFloat(data.amount).toFixed(2)}</p>
                        ${actionBtn}
                    </div>
                `;
            });
            updateOverviewStats();
        }
    });

    const buyerQ = query(collection(db, "escrows"), where("buyerEmail", "==", currentUser.email));
    
    onSnapshot(buyerQ, (snapshot) => {
        const buyerEscrowsContainer = document.getElementById('buyer-escrows');
        if (!buyerEscrowsContainer) return;
        
        if (snapshot.empty) {
            buyerEscrowsContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">You have no active escrows as a buyer.</p>';
        } else {
            buyerEscrowsContainer.innerHTML = '';
            escrowStats.activeBuyer = 0;
            escrowStats.pendingBuyer = 0;
            // Remove old buyer activities
            recentActivities = recentActivities.filter(a => a.type !== 'buyer');
            
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const escrowId = docSnap.id;
                
                if (data.status !== 'COMPLETED' && data.status !== 'DISPUTED') escrowStats.activeBuyer++;
                if (data.status === 'FUNDED' || data.status === 'DISPATCHED') escrowStats.pendingBuyer++;
                
                if(data.createdAt) {
                    recentActivities.push({
                        type: 'buyer',
                        time: data.createdAt.toMillis ? data.createdAt.toMillis() : Date.now(),
                        title: `Escrow ${data.status.replace('_', ' ')}`,
                        description: `Buying: ${data.description} (GH₵ ${data.amount})`
                    });
                }
                
                let statusUI = '';
                let actionBtn = '';
                
                if (data.status === 'PENDING_PAYMENT') {
                    statusUI = `<span style="background-color: rgba(245, 158, 11, 0.15); color: var(--warning); border: 1px solid var(--warning); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 700;">PAYMENT REQUIRED</span>`;
                    actionBtn = `<a href="checkout.html?id=${escrowId}" target="_blank" class="btn btn-primary">PAY NOW</a>`;
                } else if (data.status === 'FUNDED') {
                    statusUI = `<span style="background-color: rgba(59, 130, 246, 0.15); color: #3b82f6; border: 1px solid #3b82f6; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 700;">AWAITING DISPATCH</span>`;
                } else if (data.status === 'DISPATCHED') {
                    statusUI = `<span style="background-color: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid var(--success); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 700;">DISPATCHED</span>`;
                    actionBtn = `
                        <div style="display: flex; gap: 10px;">
                            <button class="btn btn-primary" onclick="window.releaseFunds('${escrowId}')">RELEASE FUNDS</button>
                            <button class="btn btn-outline" style="border-color: var(--danger); color: var(--danger);" onclick="window.raiseDispute('${escrowId}')">RAISE DISPUTE</button>
                        </div>
                    `;
                } else if (data.status === 'COMPLETED') {
                    statusUI = `<span style="background-color: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid var(--success); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 700;">COMPLETED</span>`;
                } else if (data.status === 'DISPUTED') {
                    statusUI = `<span style="background-color: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid var(--danger); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 700;">DISPUTED</span>`;
                }

                buyerEscrowsContainer.innerHTML += `
                    <div class="order-ledger-row">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                            <span style="font-weight: 700; color: #60A5FA;">${data.description} - #${escrowId.substring(0, 8).toUpperCase()}</span>
                            ${statusUI}
                        </div>
                        <p style="margin: 0 0 1rem 0; color: var(--text-muted);"><strong>Value:</strong> GH₵ ${parseFloat(data.amount).toFixed(2)}</p>
                        ${actionBtn}
                    </div>
                `;
            });
            updateOverviewStats();
        }
    });
}

// Global functions for inline HTML event handlers
window.copyToClipboard = async (text) => {
    try {
        await navigator.clipboard.writeText(text);
        alert("Payment link copied to clipboard! You can now paste and send it to the buyer.");
    } catch (err) {
        prompt("Copy the link below:", text);
    }
};

window.dispatchItem = async (escrowId) => {
    if(confirm("Are you sure you want to mark this item as dispatched?")) {
        try {
            await updateDoc(doc(db, "escrows", escrowId), { status: 'DISPATCHED' });
            alert("Item marked as dispatched!");
        } catch (error) {
            console.error("Error dispatching:", error);
            alert("Error: " + error.message);
        }
    }
};

window.releaseFunds = async (escrowId) => {
    if(confirm("Are you sure you want to release the funds to the seller? This cannot be undone.")) {
        try {
            const escrowRef = doc(db, "escrows", escrowId);
            const escrowSnap = await getDoc(escrowRef);
            if (!escrowSnap.exists()) return;
            
            const escrowData = escrowSnap.data();
            const sellerId = escrowData.sellerId;
            const amount = parseFloat(escrowData.amount);
            
            // 1. Mark escrow as COMPLETED
            await updateDoc(escrowRef, { status: 'COMPLETED' });
            
            // 2. Increment Seller's Wallet Balance
            const sellerRef = doc(db, "users", sellerId);
            const sellerSnap = await getDoc(sellerRef);
            if (sellerSnap.exists()) {
                const currentBalance = parseFloat(sellerSnap.data().walletBalance || 0);
                await updateDoc(sellerRef, { walletBalance: currentBalance + amount });
            }
            
            alert("Funds Released! Thank you for using TrustLink.");
        } catch (error) {
            console.error("Error releasing funds:", error);
            alert("Error: " + error.message);
        }
    }
};

window.raiseDispute = async (escrowId) => {
    if(confirm("Are you sure you want to raise a dispute? Escrow funds will remain locked.")) {
        try {
            await updateDoc(doc(db, "escrows", escrowId), { status: 'DISPUTED' });
            alert("Dispute Raised. Support will contact you shortly.");
        } catch (error) {
            console.error("Error raising dispute:", error);
            alert("Error: " + error.message);
        }
    }
};

document.getElementById('btn-signout').addEventListener('click', async () => {
    try {
        await signOut(auth);
        window.location.href = "login.html";
    } catch (error) {
        console.error("Sign out error", error);
    }
});

const topSignoutBtn = document.getElementById('btn-signout-top');
if (topSignoutBtn) {
    topSignoutBtn.addEventListener('click', async () => {
        try {
            await signOut(auth);
            window.location.href = "login.html";
        } catch (error) {
            console.error("Sign out error", error);
        }
    });
}

// New Escrow Modal Logic
const btnNewEscrow = document.getElementById('btn-new-escrow');
const modalOverlay = document.getElementById('new-escrow-modal');
const btnCloseModal = document.getElementById('close-escrow-modal');
const btnCancelEscrow = document.getElementById('btn-cancel-escrow');
const formNewEscrow = document.getElementById('new-escrow-form');

const openModal = () => {
    modalOverlay.classList.remove('hidden');
    // Allow display:block to apply before animating opacity
    setTimeout(() => {
        modalOverlay.classList.add('active');
        if(typeof gsap !== 'undefined') {
            gsap.fromTo('#new-escrow-modal .modal-content', { scale: 0.95, y: 20, opacity: 0 }, { scale: 1, y: 0, opacity: 1, duration: 0.4, ease: 'back.out(1.5)' });
        }
    }, 10);
};

const closeModal = () => {
    if(typeof gsap !== 'undefined') {
        gsap.to('#new-escrow-modal .modal-content', { scale: 0.95, y: 10, opacity: 0, duration: 0.3, ease: 'power2.in', onComplete: () => {
            modalOverlay.classList.remove('active');
            setTimeout(() => modalOverlay.classList.add('hidden'), 300);
        }});
    } else {
        modalOverlay.classList.remove('active');
        setTimeout(() => modalOverlay.classList.add('hidden'), 300);
    }
};

if (btnNewEscrow) {
    btnNewEscrow.addEventListener('click', () => {
        const escrowLineItems = document.getElementById('escrow-line-items');
        if(escrowLineItems && !escrowLineItems.innerHTML.trim()) {
            // Will define injectSingleLineItem below
            if(typeof injectSingleLineItem !== 'undefined') injectSingleLineItem('');
        }
        openModal();
    });
}
if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
if (btnCancelEscrow) btnCancelEscrow.addEventListener('click', closeModal);
if (formNewEscrow) {
    formNewEscrow.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitBtn = formNewEscrow.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing with Moolre...';
        
        try {
            // Get the total amount calculated in the UI
            const amountInput = document.getElementById('escrow-amount');
            const totalAmount = amountInput ? parseFloat(amountInput.value) : 0;
            
            if (totalAmount <= 0) {
                throw new Error("Total escrow amount must be greater than 0");
            }

            const description = document.getElementById('escrow-terms') ? document.getElementById('escrow-terms').value : "TrustLink Escrow Deposit";
            
            const customer = {
                email: currentUser ? currentUser.email : "guest@example.com",
                name: currentUser && currentUser.displayName ? currentUser.displayName : "TrustLink User"
            };

            const buyerEmail = document.getElementById('buyer-email') ? document.getElementById('buyer-email').value : "";
            const buyerPhoneInput = document.getElementById('buyer-phone');
            
            // 1. SAVE TO FIREBASE
            const newEscrow = {
                amount: totalAmount,
                description: description,
                sellerId: currentUser ? currentUser.uid : "GUEST",
                sellerName: currentUser && currentUser.displayName ? currentUser.displayName : "TrustLink User",
                buyerEmail: buyerEmail,
                buyerPhone: buyerPhoneInput ? buyerPhoneInput.value : "",
                status: 'PENDING_PAYMENT',
                createdAt: serverTimestamp()
            };
            
            const docRef = await addDoc(collection(db, "escrows"), newEscrow);
            const escrowId = docRef.id;
            
            // 2. Generate Moolre Payment ID for USSD Pull (Option B)
            let moolrePaymentId = "";
            try {
                moolrePaymentId = await generateMoolrePaymentID(buyerPhoneInput ? buyerPhoneInput.value : "0000000000", "TrustLink Buyer", escrowId);
            } catch (err) {
                console.warn("Failed to generate USSD Payment ID, proceeding without it.", err);
            }

            // 3. SMS/WHATSAPP INTEGRATION
            const checkoutUrl = `${window.location.origin}/checkout.html?id=${escrowId}`;
            try {
                await navigator.clipboard.writeText(checkoutUrl);
            } catch(e) { console.warn("Clipboard write failed silently."); }

            if (buyerPhoneInput && buyerPhoneInput.value) {
                try {
                    // Try WhatsApp first
                    try {
                        await sendWhatsAppNotification(buyerPhoneInput.value, checkoutUrl, escrowId, moolrePaymentId);
                        alert(`Escrow Created Successfully!\n\nA WhatsApp notification has been sent to the buyer. The payment link was also copied to your clipboard!`);
                    } catch (waError) {
                        console.warn("WhatsApp failed, falling back to SMS...", waError);
                        // Fall back to SMS
                        await sendSMSNotification(buyerPhoneInput.value, checkoutUrl, escrowId, moolrePaymentId);
                        alert(`Escrow Created Successfully!\n\nAn SMS notification has been sent to the buyer. The payment link was also copied to your clipboard!`);
                    }
                } catch (smsError) {
                    console.warn("SMS failed.", smsError);
                    alert("Escrow Created! (Failed to send automatic SMS/WhatsApp).\n\nThe payment link has been COPIED TO YOUR CLIPBOARD. Please paste it to the buyer directly.");
                }
            } else {
                alert("Escrow Created Successfully!\n\nThe payment link has been COPIED TO YOUR CLIPBOARD. Please send it to the buyer.");
            }

            // Do not redirect the seller. The buyer will pay via the WhatsApp link!
            closeModal();
            // Optionally, refresh the UI here
            if (typeof fetchProducts === 'function') fetchProducts();
        } catch (error) {
            alert(error.message || "Failed to initialize Moolre Checkout.");
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
}

// ==========================================
// SELLER PRODUCTS LOGIC (FIRESTORE)
// ==========================================
let myProducts = [];

const productsGrid = document.getElementById('products-grid');
const escrowLineItems = document.getElementById('escrow-line-items');
const escrowAmount = document.getElementById('escrow-amount');
const escrowTerms = document.getElementById('escrow-terms');
const btnAddLineItem = document.getElementById('btn-add-line-item');

let lineItemCounter = 0;

const createLineItemHTML = (selectedId = '') => {
    lineItemCounter++;
    let optionsHTML = '<option value="">Choose a product...</option>';
    myProducts.forEach(prod => {
        optionsHTML += `<option value="${prod.id}" ${prod.id == selectedId ? 'selected' : ''}>${prod.name} - GH₵ ${parseFloat(prod.price).toLocaleString()}</option>`;
    });

    return `
        <div class="line-item-row" data-id="${lineItemCounter}">
            <div class="form-group" style="flex: 2;">
                <label>Product/Service</label>
                <select class="escrow-product-select" required style="background: rgba(0, 0, 0, 0.3);">
                    ${optionsHTML}
                </select>
            </div>
            <div class="form-group" style="flex: 0.5;">
                <label>Qty</label>
                <input type="number" class="escrow-qty" value="1" min="1" required style="background: rgba(0, 0, 0, 0.3);">
            </div>
            ${lineItemCounter > 1 
                ? `<button type="button" class="btn-remove-line"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 20px; height: 20px;"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg></button>` 
                : `<div style="width: 48px; height: 48px; flex-shrink: 0;"></div>`
            }
        </div>
    `;
};

window.injectSingleLineItem = (productId) => {
    lineItemCounter = 0;
    if(escrowLineItems) {
        escrowLineItems.innerHTML = createLineItemHTML(productId);
        updateEscrowTotal();
    }
};

const fetchProducts = async () => {
    if (!currentUser) return;
    try {
        const q = query(collection(db, "products"), where("userId", "==", currentUser.uid));
        const querySnapshot = await getDocs(q);
        myProducts = [];
        querySnapshot.forEach((doc) => {
            myProducts.push({ id: doc.id, ...doc.data() });
        });
        renderProducts();
        
        // Initial setup for line items if it's empty
        if(escrowLineItems && !escrowLineItems.innerHTML.trim()) {
            injectSingleLineItem('');
        }
    } catch (e) {
        console.error("Error fetching products: ", e);
    }
};

const renderProducts = () => {
    if(productsGrid) {
        // Render Grid
        productsGrid.innerHTML = '';
        myProducts.forEach(prod => {
            productsGrid.innerHTML += `
                <div class="product-item">
                    <h3>${prod.name}</h3>
                    <h2 class="product-price">GH₵ ${parseFloat(prod.price).toLocaleString()}</h2>
                    <p class="product-desc">${prod.desc}</p>
                    <button class="btn btn-outline" style="width: 100%; border-color: var(--primary); color: var(--primary);" onclick="document.getElementById('btn-new-escrow').click(); setTimeout(() => { injectSingleLineItem('${prod.id}'); }, 100);">Sell this Item</button>
                </div>
            `;
        });
    }

    // Update existing Selects in Modal
    if(escrowLineItems) {
        const selects = escrowLineItems.querySelectorAll('.escrow-product-select');
        selects.forEach(select => {
            const currentVal = select.value;
            let optionsHTML = '<option value="">Choose a product...</option>';
            myProducts.forEach(prod => {
                optionsHTML += `<option value="${prod.id}" ${prod.id == currentVal ? 'selected' : ''}>${prod.name} - GH₵ ${parseFloat(prod.price).toLocaleString()}</option>`;
            });
            select.innerHTML = optionsHTML;
        });
    }
};

// Escrow Auto-Calculation
const updateEscrowTotal = () => {
    if(!escrowLineItems) return;
    
    let total = 0;
    let terms = [];
    
    const rows = escrowLineItems.querySelectorAll('.line-item-row');
    rows.forEach(row => {
        const select = row.querySelector('.escrow-product-select');
        const qty = row.querySelector('.escrow-qty');
        
        if (select && qty && select.value) {
            const prod = myProducts.find(p => p.id === select.value);
            if (prod) {
                total += (prod.price * parseInt(qty.value || 1));
                terms.push(`- ${prod.name}: ${prod.desc}`);
            }
        }
    });
    
    if (total > 0) {
        if(escrowAmount) escrowAmount.value = total.toFixed(2);
        if(escrowTerms && document.activeElement !== escrowTerms) {
            escrowTerms.value = terms.join('\n');
        }
    }
};

// Event Delegation for Line Items
if(escrowLineItems) {
    escrowLineItems.addEventListener('change', (e) => {
        if(e.target.classList.contains('escrow-product-select')) updateEscrowTotal();
    });
    escrowLineItems.addEventListener('input', (e) => {
        if(e.target.classList.contains('escrow-qty')) updateEscrowTotal();
    });
    escrowLineItems.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-remove-line');
        if(btn) {
            btn.closest('.line-item-row').remove();
            updateEscrowTotal();
        }
    });
}

// Ensure Add Button works via document delegation
document.addEventListener('click', (e) => {
    if (e.target.closest('#btn-add-line-item')) {
        const container = document.getElementById('escrow-line-items');
        if (container) {
            container.insertAdjacentHTML('beforeend', createLineItemHTML());
        }
    }
});

// Add Product Modal
const btnAddProduct = document.getElementById('btn-add-product');
const productModal = document.getElementById('new-product-modal');
const btnCloseProd = document.getElementById('close-product-modal');
const btnCancelProd = document.getElementById('btn-cancel-product');
const formNewProd = document.getElementById('new-product-form');

const openProdModal = () => {
    productModal.classList.remove('hidden');
    setTimeout(() => {
        productModal.classList.add('active');
        if(typeof gsap !== 'undefined') gsap.fromTo('#new-product-modal .modal-content', { scale: 0.95, y: 20, opacity: 0 }, { scale: 1, y: 0, opacity: 1, duration: 0.4, ease: 'back.out(1.5)' });
    }, 10);
};

const closeProdModal = () => {
    if(typeof gsap !== 'undefined') {
        gsap.to('#new-product-modal .modal-content', { scale: 0.95, y: 10, opacity: 0, duration: 0.3, ease: 'power2.in', onComplete: () => {
            productModal.classList.remove('active');
            setTimeout(() => productModal.classList.add('hidden'), 300);
        }});
    } else {
        productModal.classList.remove('active');
        setTimeout(() => productModal.classList.add('hidden'), 300);
    }
};

if(btnAddProduct) btnAddProduct.addEventListener('click', openProdModal);
if(btnCloseProd) btnCloseProd.addEventListener('click', closeProdModal);
if(btnCancelProd) btnCancelProd.addEventListener('click', closeProdModal);

if(formNewProd) {
    formNewProd.addEventListener('submit', async (e) => {
        e.preventDefault();
        if(!currentUser) {
            alert('You must be logged in to add products.');
            return;
        }
        
        const btnSubmit = formNewProd.querySelector('button[type="submit"]');
        btnSubmit.disabled = true;
        btnSubmit.textContent = 'Saving...';
        
        try {
            const newProd = {
                name: document.getElementById('new-prod-name').value,
                price: parseFloat(document.getElementById('new-prod-price').value),
                desc: document.getElementById('new-prod-desc').value,
                userId: currentUser.uid,
                createdAt: serverTimestamp()
            };
            
            await addDoc(collection(db, "products"), newProd);
            await fetchProducts(); // Re-fetch to get Firestore IDs and render
            
            closeProdModal();
            formNewProd.reset();
        } catch (error) {
            console.error("Error adding document: ", error);
            alert("Error adding product.");
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.textContent = 'Save Product';
        }
    });
}
