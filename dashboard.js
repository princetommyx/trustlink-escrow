import { auth, db, storage } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, collection, addDoc, query, where, getDocs, serverTimestamp, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { initiateMoolreCheckout, sendSMSNotification, sendWhatsAppNotification, generateMoolrePaymentID, generateSecureToken, sha256Hex, sendDeliveryConfirmationSMS, computeFeeSplit, sendEscrowStatusSMS, pickUserPhone, executeMoolrePayout } from "./moolre-service.js";

let currentUser = null;
let currentBalance = 0;

const escapeHtml = (str) => String(str ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

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

// Settings Footer Link Logic
const btnSettingsNav = document.getElementById('btn-settings-nav');
if (btnSettingsNav) {
    btnSettingsNav.addEventListener('click', (e) => {
        e.preventDefault();
        navItems.forEach(nav => nav.classList.remove('active'));
        views.forEach(view => view.classList.add('hidden'));
        
        document.getElementById('view-settings').classList.remove('hidden');
        topbarTitle.textContent = 'Settings';
        
        // On mobile, close sidebar automatically
        const sidebar = document.querySelector('.sidebar');
        if (window.innerWidth <= 768 && sidebar) {
            sidebar.classList.remove('open');
            document.getElementById('sidebar-backdrop').classList.remove('active');
        }
    });
}

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

// Notification bell dropdown
const notifBtn = document.getElementById('btn-notifications');
const notifDropdown = document.getElementById('notif-dropdown');
if (notifBtn && notifDropdown) {
    notifBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        notifDropdown.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
        if (!notifDropdown.classList.contains('hidden') && !notifDropdown.contains(e.target)) {
            notifDropdown.classList.add('hidden');
        }
    });
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
                if(document.getElementById('user-name')) document.getElementById('user-name').textContent = data.fullName || user.email.split('@')[0];
                if(document.getElementById('greeting-name')) {
                    const n = data.fullName || user.email.split('@')[0];
                    document.getElementById('greeting-name').textContent = n.split(' ')[0];
                }

                // Keep the profile form in sync (don't overwrite while typing)
                const profileName = document.getElementById('profile-name');
                const profilePhone = document.getElementById('profile-phone');
                const profileEmail = document.getElementById('profile-email');
                const verificationEmailText = document.getElementById('verification-email-text');
                if (profileEmail) profileEmail.value = data.email || user.email || '';
                if (verificationEmailText) verificationEmailText.textContent = user.email;
                if (profileName && document.activeElement !== profileName) profileName.value = data.fullName || '';
                if (profilePhone && document.activeElement !== profilePhone) profilePhone.value = data.phone || pickUserPhone(data) || '';

                if (data.photoURL) {
                    const sidebarAvatar = document.getElementById('sidebar-avatar');
                    const profileAvatar = document.getElementById('profile-avatar');
                    if (sidebarAvatar) sidebarAvatar.style.backgroundImage = `url('${data.photoURL}')`;
                    if (profileAvatar) profileAvatar.style.backgroundImage = `url('${data.photoURL}')`;
                }

                // Load API Settings
                const apiKeyDisplay = document.getElementById('api-key-display');
                if (apiKeyDisplay) {
                    apiKeyDisplay.value = data.apiKey || '••••••••••••••••••••';
                }
                const webhookInput = document.getElementById('webhook-url-input');
                if (webhookInput && document.activeElement !== webhookInput) {
                    webhookInput.value = data.webhookUrl || '';
                }

                currentBalance = parseFloat(data.walletBalance || 0);
                const balance = currentBalance.toFixed(2);
                document.getElementById('overview-balance').textContent = `GH₵ ${balance}`;
                if(document.getElementById('verification-email-text')) {
                    document.getElementById('verification-email-text').textContent = data.email || user.email;
                }
                if(document.getElementById('wallet-available-balance')) {
                    document.getElementById('wallet-available-balance').textContent = `GH₵ ${balance}`;
                }

                if(!currentUser) {
                    currentUser = user;
                    fetchProducts();
                    loadEscrows();
                    loadTransactionLogs();
                }
            } else {
                if(document.getElementById('user-name')) document.getElementById('user-name').textContent = user.email.split('@')[0];
                if(document.getElementById('greeting-name')) document.getElementById('greeting-name').textContent = user.email.split('@')[0];
                if(!currentUser) {
                    currentUser = user;
                    fetchProducts();
                    loadEscrows();
                    loadTransactionLogs();
                }
            }
        });
    } catch(e) {
        if(document.getElementById('user-name')) document.getElementById('user-name').textContent = user.email.split('@')[0];
        if(document.getElementById('greeting-name')) document.getElementById('greeting-name').textContent = user.email.split('@')[0];
        if(!currentUser) {
            currentUser = user;
            fetchProducts();
            loadEscrows();
            loadTransactionLogs();
        }
    }
});

let escrowStats = { activeSeller: 0, activeBuyer: 0, pendingSeller: 0, pendingBuyer: 0, completedSeller: 0, completedBuyer: 0 };
let recentActivities = [];

// ==========================================
// DELIVERY-DAY REMINDERS
// Runs whenever escrows load: if today is (or is past) the expected
// delivery date and no reminder has gone out yet, SMS the buyer to go
// collect the item, confirm delivery, and settle any outstanding payment.
// ==========================================
const deliveryDateLabel = (d) => {
    if (!d) return '';
    const date = new Date(d + 'T00:00:00');
    return isNaN(date) ? d : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const maybeSendDeliveryReminder = async (escrowId, data) => {
    try {
        if (!data.deliveryDate || data.deliveryReminderSent || !data.buyerPhone) return;
        if (!['PENDING_PAYMENT', 'FUNDED', 'DISPATCHED'].includes(data.status)) return;
        const due = new Date(data.deliveryDate + 'T00:00:00');
        if (isNaN(due) || Date.now() < due.getTime()) return;

        // Mark as sent FIRST so two dashboards loading at once can't double-text
        await updateDoc(doc(db, "escrows", escrowId), { deliveryReminderSent: true });

        const item = (data.description || 'your item').replace(/\s+/g, ' ').trim().substring(0, 60);
        const trackUrl = `${window.location.origin}/checkout.html?id=${escrowId}`;
        let message;
        if (data.status === 'PENDING_PAYMENT') {
            message = `TrustLink: Today is the scheduled delivery date for "${item}", but your payment is still outstanding. Complete it now to receive your product: ${trackUrl}`;
        } else {
            message = `TrustLink: Today is the delivery date for "${item}"! Go collect your product, then confirm receipt so the seller gets paid: ${trackUrl}`;
        }
        await sendEscrowStatusSMS(data.buyerPhone, message, `${escrowId}-delivery`);
        console.log(`[REMINDER] Delivery-day SMS sent for escrow ${escrowId}`);
    } catch (err) {
        console.warn("Delivery reminder failed for", escrowId, err);
    }
};

function updateOverviewStats() {
    const totalActive = escrowStats.activeSeller + escrowStats.activeBuyer;
    const totalPending = escrowStats.pendingSeller + escrowStats.pendingBuyer;
    const totalCompleted = escrowStats.completedSeller + escrowStats.completedBuyer;
    if(document.getElementById('overview-active-escrows')) document.getElementById('overview-active-escrows').textContent = totalActive;
    if(document.getElementById('overview-pending-releases')) document.getElementById('overview-pending-releases').textContent = totalPending;
    if(document.getElementById('overview-completed-escrows')) document.getElementById('overview-completed-escrows').textContent = totalCompleted;
    
    // Set dynamic volume total instead of dummy "$2289"
    const tooltipAmount = document.getElementById('chart-tooltip-amount');
    const tooltipContainer = document.getElementById('chart-tooltip');
    if (tooltipAmount && tooltipContainer) {
        // Just show total active + pending as a placeholder metric for "volume" since we don't have historical prices here
        // Ideally we would query all transaction amounts, but for now just showing total escrow count is better than dummy data.
        // Actually, if we don't have total volume, hiding it is safest to meet the "no dummy data" requirement.
        tooltipContainer.style.display = 'none'; 
    }

    // Sort recent activities by timestamp (descending)
    recentActivities.sort((a, b) => b.time - a.time);

    // Notification bell: dot when something needs attention, dropdown = recent activity
    const notifDot = document.getElementById('notif-dot');
    if (notifDot) notifDot.classList.toggle('hidden', totalPending === 0);
    const notifList = document.getElementById('notif-list');
    if (notifList) {
        if (recentActivities.length === 0) {
            notifList.innerHTML = '<div class="notif-empty">No notifications yet</div>';
        } else {
            notifList.innerHTML = '';
            recentActivities.slice(0, 6).forEach(act => {
                notifList.innerHTML += `
                    <div class="notif-item">
                        <h5>${act.title}</h5>
                        <p>${act.description}</p>
                        <p style="font-size: 0.7rem; margin-top: 4px;">${new Date(act.time).toLocaleString()}</p>
                    </div>
                `;
            });
        }
    }

    const activityContainer = document.getElementById('recent-activity-list');
    if(activityContainer) {
        if(recentActivities.length === 0) {
            activityContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 20px;">No recent activity</p>';
        } else {
            activityContainer.innerHTML = '';
            recentActivities.slice(0, 5).forEach(act => {
                let iconColor = "#3B82F6";
                let arrowPath = "M12 4.5v15m0 0l6.75-6.75M12 19.5l-6.75-6.75"; // Down arrow
                
                if(act.status === "COMPLETED") { iconColor = "#10B981"; arrowPath = "M12 19.5v-15m0 0l-6.75 6.75M12 4.5l6.75 6.75"; } // Up arrow
                if(act.status === "CANCELED" || act.status === "DISPUTED") { iconColor = "#EF4444"; arrowPath = "M6 18L18 6M6 6l12 12"; } // X
                
                // Keep background uniform light grayish-blue for the unique style
                let iconBgStyle = "background: #F1F5F9;";

                activityContainer.innerHTML += `
                    <div class="tx-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0;">
                        <div style="display: flex; gap: 16px; align-items: center;">
                            <div class="tx-icon" style="${iconBgStyle} width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: ${iconColor};">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 18px; height: 18px;"><path stroke-linecap="round" stroke-linejoin="round" d="${arrowPath}" /></svg>
                            </div>
                            <div class="tx-info" style="display: flex; flex-direction: column; gap: 2px;">
                                <span class="tx-name" style="font-size: 0.95rem; font-weight: 600; color: #111827;">${act.title}</span>
                                <span class="tx-date" style="font-size: 0.75rem; color: #64748B;">${new Date(act.time).toLocaleDateString('en-GB')}</span>
                            </div>
                        </div>
                        <div class="tx-amount" style="display: flex; align-items: center; gap: 8px;">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#94A3B8" style="width: 16px; height: 16px; transform: rotate(-45deg);">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                            </svg>
                            <span style="font-size: 0.9rem; font-weight: 500; color: #111827; max-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${act.description}">${act.description.split('(')[0].trim()}</span>
                        </div>
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
            escrowStats.activeSeller = 0;
            escrowStats.pendingSeller = 0;
            escrowStats.completedSeller = 0;
            recentActivities = recentActivities.filter(a => a.type !== 'seller');
            updateOverviewStats();
        } else {
            sellerEscrowsContainer.innerHTML = '';
            escrowStats.activeSeller = 0;
            escrowStats.pendingSeller = 0;
            escrowStats.completedSeller = 0;
            // Remove old seller activities
            recentActivities = recentActivities.filter(a => a.type !== 'seller');
            
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const escrowId = docSnap.id;
                maybeSendDeliveryReminder(escrowId, data);

                if (data.status !== 'COMPLETED' && data.status !== 'DISPUTED') escrowStats.activeSeller++;
                if (data.status === 'FUNDED' || data.status === 'DISPATCHED') escrowStats.pendingSeller++;
                if (data.status === 'COMPLETED') escrowStats.completedSeller++;
                
                if(data.createdAt) {
                    recentActivities.push({
                        type: 'seller',
                        time: data.createdAt.toMillis ? data.createdAt.toMillis() : Date.now(),
                        title: data.buyerEmail ? data.buyerEmail.split('@')[0] : 'Escrow Deposit',
                        status: data.status,
                        description: `GH₵ ${data.amount}` // Just amount for sleek UI
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
                            <span style="font-weight: 700; color: #60A5FA;">${escapeHtml(data.description)} - #${escrowId.substring(0, 8).toUpperCase()}</span>
                            ${statusUI}
                        </div>
                        <p style="margin: 0 0 1rem 0; color: var(--text-muted);"><strong>Value:</strong> GH₵ ${parseFloat(data.amount).toFixed(2)}${data.deliveryDate ? ` · <strong>Delivery:</strong> ${deliveryDateLabel(data.deliveryDate)}` : ``}</p>
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
            escrowStats.activeBuyer = 0;
            escrowStats.pendingBuyer = 0;
            escrowStats.completedBuyer = 0;
            recentActivities = recentActivities.filter(a => a.type !== 'buyer');
            updateOverviewStats();
        } else {
            buyerEscrowsContainer.innerHTML = '';
            escrowStats.activeBuyer = 0;
            escrowStats.pendingBuyer = 0;
            escrowStats.completedBuyer = 0;
            // Remove old buyer activities
            recentActivities = recentActivities.filter(a => a.type !== 'buyer');
            
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const escrowId = docSnap.id;
                maybeSendDeliveryReminder(escrowId, data);

                if (data.status !== 'COMPLETED' && data.status !== 'DISPUTED') escrowStats.activeBuyer++;
                if (data.status === 'FUNDED' || data.status === 'DISPATCHED') escrowStats.pendingBuyer++;
                if (data.status === 'COMPLETED') escrowStats.completedBuyer++;
                
                if(data.createdAt) {
                    recentActivities.push({
                        type: 'buyer',
                        time: data.createdAt.toMillis ? data.createdAt.toMillis() : Date.now(),
                        title: data.sellerEmail ? data.sellerEmail.split('@')[0] : 'Escrow Payment',
                        status: data.status,
                        description: `GH₵ ${data.amount}` // Just amount for sleek UI
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
                            <span style="font-weight: 700; color: #60A5FA;">${escapeHtml(data.description)} - #${escrowId.substring(0, 8).toUpperCase()}</span>
                            ${statusUI}
                        </div>
                        <p style="margin: 0 0 1rem 0; color: var(--text-muted);"><strong>Value:</strong> GH₵ ${parseFloat(data.amount).toFixed(2)}${data.deliveryDate ? ` · <strong>Delivery:</strong> ${deliveryDateLabel(data.deliveryDate)}` : ``}</p>
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
            // Mint a private one-time confirmation link for the buyer.
            // Only the SHA-256 hash is stored, so the link cannot be forged
            // by anyone reading the database. Valid 72h, single use.
            const token = generateSecureToken();
            const tokenHash = await sha256Hex(token);
            const expiresAt = Date.now() + 72 * 60 * 60 * 1000;

            await updateDoc(doc(db, "escrows", escrowId), {
                status: 'DISPATCHED',
                confirmTokenHash: tokenHash,
                confirmTokenExpiresAt: expiresAt,
                confirmTokenUsed: false,
                dispatchedAt: serverTimestamp()
            });

            const confirmUrl = `${window.location.origin}/confirm.html?id=${escrowId}&token=${token}`;

            // SMS the buyer their private confirmation link
            const escrowSnap = await getDoc(doc(db, "escrows", escrowId));
            const buyerPhone = escrowSnap.exists() ? escrowSnap.data().buyerPhone : "";
            const itemDesc = escrowSnap.exists() ? escrowSnap.data().description : "";
            if (buyerPhone) {
                try {
                    await sendDeliveryConfirmationSMS(buyerPhone, confirmUrl, escrowId, itemDesc);
                    alert("Item marked as dispatched!\n\nThe buyer has been sent a private one-time link to confirm delivery.");
                } catch (smsErr) {
                    console.warn("Confirmation SMS failed:", smsErr);
                    prompt("Dispatched! SMS failed, so share this private confirmation link with the buyer yourself:", confirmUrl);
                }
            } else {
                prompt("Dispatched! No buyer phone on file - share this private confirmation link with the buyer:", confirmUrl);
            }
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

            // Seller receives the amount minus their share of the platform fee
            const fees = computeFeeSplit(escrowData.amount, escrowData.feePercent || 0, escrowData.feeAllocation || 'split');

            // 1. Mark escrow as COMPLETED
            await updateDoc(escrowRef, { status: 'COMPLETED' });

            // 2. Increment Seller's Wallet Balance
            const sellerRef = doc(db, "users", sellerId);
            const sellerSnap = await getDoc(sellerRef);
            if (sellerSnap.exists()) {
                const sellerBalance = parseFloat(sellerSnap.data().walletBalance || 0);
                await updateDoc(sellerRef, { walletBalance: sellerBalance + fees.sellerNet });

                // SMS the seller that their money has arrived
                const sellerPhone = pickUserPhone(sellerSnap.data());
                if (sellerPhone) {
                    try {
                        const itemLabel = (escrowData.description || 'your item').replace(/\s+/g, ' ').trim().substring(0, 60);
                        await sendEscrowStatusSMS(sellerPhone, `TrustLink: The buyer released payment for "${itemLabel}". GH₵ ${fees.sellerNet.toFixed(2)} has been credited to your TrustLink wallet. Withdraw anytime from your dashboard.`, `${escrowId}-released`);
                    } catch (smsErr) {
                        console.warn("Seller release SMS failed:", smsErr);
                    }
                }
            }

            // 3. Record the wallet credit (and the platform's fee) in the log
            await addDoc(collection(db, "transactions"), {
                userId: sellerId,
                type: 'deposit',
                amount: fees.sellerNet,
                fee: fees.totalFee,
                status: 'completed',
                description: `Escrow release: ${escrowData.description || escrowId}`,
                escrowId: escrowId,
                createdAt: serverTimestamp()
            });

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

// ==========================================
// PROFILE
// ==========================================

document.getElementById('avatar-upload-input')?.addEventListener('change', async (e) => {
    if (!currentUser) return;
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert("Please upload an image file.");
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        alert("Image size should be less than 5MB.");
        return;
    }

    const statusText = document.getElementById('avatar-upload-status');
    const saveBtn = document.getElementById('btn-save-profile');
    if(statusText) {
        statusText.style.display = 'block';
        statusText.textContent = 'Uploading... Please wait.';
        statusText.style.color = '#10B981';
    }
    if(saveBtn) saveBtn.disabled = true;

    // Show immediate local preview
    const reader = new FileReader();
    reader.onload = (e) => {
        const avatarEl = document.getElementById('profile-avatar');
        if (avatarEl) avatarEl.style.backgroundImage = `url('${e.target.result}')`;
    };
    reader.readAsDataURL(file);

    try {
        const fileExt = file.name.split('.').pop();
        const storageRef = ref(storage, `users/${currentUser.uid}/profile_${Date.now()}.${fileExt}`);
        
        await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(storageRef);

        await updateDoc(doc(db, "users", currentUser.uid), {
            photoURL: downloadURL
        });

        if(statusText) {
            statusText.textContent = 'Uploaded successfully!';
            setTimeout(() => { statusText.style.display = 'none'; }, 2000);
        }
    } catch (error) {
        if(statusText) {
            statusText.textContent = 'Upload failed. Please try again.';
            statusText.style.color = '#EF4444';
        }
        alert("Failed to upload avatar: " + error.message);
    } finally {
        if(saveBtn) saveBtn.disabled = false;
    }
});

document.getElementById('btn-save-profile')?.addEventListener('click', async () => {
    if (!currentUser) return;
    const btn = document.getElementById('btn-save-profile');
    const name = document.getElementById('profile-name').value.trim();
    const phone = document.getElementById('profile-phone').value.trim();

    if (!name) {
        alert("Please enter your name.");
        return;
    }
    if (phone && phone.replace(/[^0-9]/g, '').length < 9) {
        alert("Please enter a valid phone number.");
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
        await updateDoc(doc(db, "users", currentUser.uid), {
            fullName: name,
            phone: phone
        });
        btn.textContent = 'Saved ✓';
        setTimeout(() => { btn.textContent = 'Save Profile'; btn.disabled = false; }, 1500);
    } catch (error) {
        alert("Failed to save profile: " + error.message);
        btn.textContent = 'Save Profile';
        btn.disabled = false;
    }
});

// ==========================================
// TRANSACTION LOGS (real data)
// ==========================================
function loadTransactionLogs() {
    if (!currentUser) return;
    const tbody = document.getElementById('transaction-logs-body');
    if (!tbody) return;

    const txQ = query(collection(db, "transactions"), where("userId", "==", currentUser.uid));
    onSnapshot(txQ, (snapshot) => {
        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--text-muted); padding: 20px;">No transactions yet. Withdrawals and escrow payouts will appear here.</td></tr>';
            return;
        }
        const rows = [];
        snapshot.forEach(txDoc => {
            const tx = txDoc.data();
            const date = tx.createdAt && tx.createdAt.toMillis ? tx.createdAt.toMillis() : 0;
            rows.push({ id: txDoc.id, date, ...tx });
        });
        rows.sort((a, b) => b.date - a.date);

        tbody.innerHTML = '';
        rows.forEach(tx => {
            const isCredit = tx.type === 'deposit';
            const amountUI = `<span style="color: ${isCredit ? 'var(--success)' : 'var(--danger)'}; font-weight: 600;">${isCredit ? '+' : '-'} GH₵ ${parseFloat(tx.amount).toFixed(2)}</span>`;
            const statusColors = { completed: 'var(--success)', pending: 'var(--warning)', rejected: 'var(--danger)' };
            const statusColor = statusColors[tx.status] || 'var(--text-muted)';
            const statusUI = `<span style="color: ${statusColor}; font-weight: 600; text-transform: uppercase; font-size: 0.8rem;">${escapeHtml(tx.status)}</span>`;
            tbody.innerHTML += `
                <tr>
                    <td>${tx.date ? new Date(tx.date).toLocaleString() : '—'}</td>
                    <td>#${tx.id.substring(0, 8).toUpperCase()}</td>
                    <td>${escapeHtml(tx.description || (isCredit ? 'Wallet credit' : 'Withdrawal'))}</td>
                    <td>${amountUI}</td>
                    <td>${statusUI}</td>
                </tr>
            `;
        });
    });
}

// ==========================================
// WITHDRAW FLOW
// ==========================================
const withdrawModal = document.getElementById('withdraw-modal');
const btnWithdraw = document.getElementById('btn-withdraw');
const withdrawForm = document.getElementById('withdraw-form');

const openWithdrawModal = () => {
    document.getElementById('withdraw-available').textContent = `GH₵ ${currentBalance.toFixed(2)}`;
    withdrawModal.classList.remove('hidden');
    setTimeout(() => {
        withdrawModal.classList.add('active');
        if(typeof gsap !== 'undefined') gsap.fromTo('#withdraw-modal .modal-content', { scale: 0.95, y: 20, opacity: 0 }, { scale: 1, y: 0, opacity: 1, duration: 0.4, ease: 'back.out(1.5)' });
    }, 10);
};

const closeWithdrawModal = () => {
    withdrawModal.classList.remove('active');
    setTimeout(() => withdrawModal.classList.add('hidden'), 300);
};

if (btnWithdraw) btnWithdraw.addEventListener('click', openWithdrawModal);
document.getElementById('close-withdraw-modal')?.addEventListener('click', closeWithdrawModal);
document.getElementById('btn-cancel-withdraw')?.addEventListener('click', closeWithdrawModal);

if (withdrawForm) {
    withdrawForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const amount = parseFloat(document.getElementById('withdraw-amount').value);
        const phone = document.getElementById('withdraw-phone').value.trim();
        const network = document.getElementById('withdraw-network').value;

        if (isNaN(amount) || amount <= 0) {
            showModernToast("Invalid Amount", "Please enter a valid amount to withdraw.", "warning");
            return;
        }
        if (amount > currentBalance) {
            showModernToast("Insufficient Balance", `You can only withdraw up to GH₵ ${currentBalance.toFixed(2)}.`, "warning");
            return;
        }

        const submitBtn = withdrawForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';

        try {
            // Lock the funds immediately, then record the pending request.
            await updateDoc(doc(db, "users", currentUser.uid), {
                walletBalance: currentBalance - amount
            });
            const txRef = await addDoc(collection(db, "transactions"), {
                userId: currentUser.uid,
                type: 'withdrawal',
                amount: amount,
                fee: 0,
                status: 'pending',
                description: `Withdrawal to ${phone}`,
                momoNumber: phone,
                network: network,
                createdAt: serverTimestamp()
            });

            // Auto-process payout directly
            try {
                await executeMoolrePayout(txRef.id, amount, phone, network);
                
                await updateDoc(txRef, {
                    status: 'completed',
                    processedAt: serverTimestamp(),
                    processedBy: 'auto'
                });
                
                // Try sending SMS for automated withdrawal success
                try {
                    await sendEscrowStatusSMS(phone, `TrustLink: Your automated withdrawal of GH₵ ${amount.toFixed(2)} has been sent to your mobile money wallet.`, `${txRef.id}-payout`);
                } catch(smsErr) { console.warn("Withdrawal SMS failed", smsErr); }

                showModernToast("Withdrawal Successful", "Your funds have been instantly sent to your mobile money wallet.", "success");
                withdrawForm.reset();
                closeWithdrawModal();
            } catch (payoutError) {
                // If payout fails, refund the user!
                await updateDoc(txRef, {
                    status: 'failed',
                    error: payoutError.message,
                    processedAt: serverTimestamp(),
                    processedBy: 'auto'
                });
                // Refund the balance
                const userSnap = await getDoc(doc(db, "users", currentUser.uid));
                if (userSnap.exists()) {
                    const latestBal = parseFloat(userSnap.data().walletBalance || 0);
                    await updateDoc(doc(db, "users", currentUser.uid), {
                        walletBalance: latestBal + amount
                    });
                }
                
                // Log refund deposit
                await addDoc(collection(db, "transactions"), {
                    userId: currentUser.uid,
                    type: 'deposit',
                    amount: amount,
                    fee: 0,
                    status: 'completed',
                    description: 'Refund: Automated Withdrawal Failed',
                    createdAt: serverTimestamp()
                });

                showModernToast("Automated Withdrawal Failed", `${payoutError.message}. Your funds have been instantly refunded.`, "error");
            }

        } catch (error) {
            console.error("Withdrawal error:", error);
            showModernToast("Withdrawal Error", error.message, "error");
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Request Withdrawal';
        }
    });
}

document.getElementById('btn-signout').addEventListener('click', async () => {
    try {
        await signOut(auth);
        sessionStorage.setItem("authToast", "Logged out successfully");
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
            sessionStorage.setItem("authToast", "Logged out successfully");
            window.location.href = "login.html";
        } catch (error) {
            console.error("Sign out error", error);
        }
    });
}

// New Escrow Modal Logic
const btnNewEscrow = document.getElementById('btn-new-escrow-trigger');
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
    populateEscrowProductSelect();
};

const closeModal = () => {
    if(typeof gsap !== 'undefined') {
        gsap.to('#new-escrow-modal .modal-content', { scale: 0.95, y: 10, opacity: 0, duration: 0.3, ease: 'power2.in', onComplete: () => {
            modalOverlay.classList.remove('active');
            setTimeout(() => modalOverlay.classList.add('hidden'), 300);
            if (formNewEscrow) formNewEscrow.reset();
        }});
    } else {
        modalOverlay.classList.remove('active');
        setTimeout(() => modalOverlay.classList.add('hidden'), 300);
        if (formNewEscrow) formNewEscrow.reset();
    }
};

async function populateEscrowProductSelect() {
    const select = document.getElementById('escrow-product-select');
    if(!select) return;
    
    select.innerHTML = '<option value="" disabled selected>Loading your products...</option>';
    
    if(!currentUser) {
        select.innerHTML = '<option value="" disabled>Please log in</option>';
        return;
    }

    try {
        const q = query(collection(db, "products"), where("userId", "==", currentUser.uid));
        const snap = await getDocs(q);
        
        if (snap.empty) {
            select.innerHTML = '<option value="" disabled>No products found. Please add a product first.</option>';
            return;
        }

        select.innerHTML = '<option value="" disabled selected>Select a product to link...</option>';
        snap.forEach(docSnap => {
            const prod = docSnap.data();
            const option = document.createElement('option');
            option.value = docSnap.id;
            option.dataset.price = prod.price || 0;
            option.dataset.name = prod.name || 'Unnamed Product';
            option.textContent = `${prod.name} (GH₵ ${parseFloat(prod.price || 0).toFixed(2)})`;
            select.appendChild(option);
        });
    } catch (err) {
        console.error("Error loading products for escrow:", err);
        select.innerHTML = '<option value="" disabled>Error loading products</option>';
    }
}

// Auto-fill amount when product selected
const productSelect = document.getElementById('escrow-product-select');
if (productSelect) {
    productSelect.addEventListener('change', (e) => {
        const selectedOpt = e.target.options[e.target.selectedIndex];
        const amountInput = document.getElementById('escrow-amount');
        const termsInput = document.getElementById('escrow-terms');
        if(amountInput && selectedOpt) {
            amountInput.value = selectedOpt.dataset.price;
        }
        if(termsInput && selectedOpt) {
            termsInput.value = `Payment for: ${selectedOpt.dataset.name}`;
        }
    });
}

if (btnNewEscrow) {
    btnNewEscrow.addEventListener('click', openModal);
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

            // Snapshot the platform fee rate at creation time so later changes
            // in admin Settings don't retroactively alter existing escrows.
            let feePercent = 2.5;
            try {
                const feeSnap = await getDoc(doc(db, "settings", "platform"));
                if (feeSnap.exists() && feeSnap.data().feePercent !== undefined) {
                    feePercent = parseFloat(feeSnap.data().feePercent) || 0;
                }
            } catch (feeErr) {
                console.warn("Could not load platform fee, using default:", feeErr);
            }

            // 1. SAVE TO FIREBASE
            const newEscrow = {
                amount: totalAmount,
                description: description,
                sellerId: currentUser ? currentUser.uid : "GUEST",
                sellerName: currentUser && currentUser.displayName ? currentUser.displayName : "TrustLink User",
                buyerEmail: buyerEmail,
                buyerPhone: buyerPhoneInput ? buyerPhoneInput.value : "",
                feeAllocation: document.getElementById('escrow-fee-allocation') ? document.getElementById('escrow-fee-allocation').value : 'split',
                feePercent: feePercent,
                deliveryDate: document.getElementById('escrow-delivery-date') ? document.getElementById('escrow-delivery-date').value : "",
                deliveryReminderSent: false,
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
                const smsDetails = {
                    description: description,
                    amount: totalAmount,
                    sellerName: newEscrow.sellerName
                };
                try {
                    await sendSMSNotification(buyerPhoneInput.value, checkoutUrl, escrowId, "", smsDetails);
                    showModernToast("Escrow Created Successfully!", "An SMS notification has been sent to the buyer.");
                } catch (smsError) {
                    console.warn("SMS failed.", smsError);
                    showModernToast("Escrow Created!", "Failed to send automatic SMS. Please share the link with the buyer directly.", "warning");
                }
            } else {
                showModernToast("Escrow Created Successfully!", "No phone number provided, so SMS was skipped.");
            }

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

// Firebase Storage isn't available on the free plan, so product images are
// downscaled in the browser and stored inline (data URL) on the product doc.
// Firestore documents cap at 1MB, hence the aggressive compression.
const fileToCompressedDataURL = (file, maxDim = 640, quality = 0.72) => new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(new Error("Could not read that image file.")); };
    img.src = url;
});

let newProductImage = ""; // compressed data URL waiting to be saved

document.getElementById('new-prod-image')?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    const preview = document.getElementById('new-prod-preview');
    newProductImage = "";
    if (!file) {
        preview?.classList.add('hidden');
        return;
    }
    try {
        let dataUrl = await fileToCompressedDataURL(file);
        if (dataUrl.length > 900000) {
            // Too big for a Firestore doc - compress harder
            dataUrl = await fileToCompressedDataURL(file, 420, 0.6);
        }
        if (dataUrl.length > 900000) {
            alert("That image is too large even after compression. Please choose a smaller one.");
            e.target.value = "";
            preview?.classList.add('hidden');
            return;
        }
        newProductImage = dataUrl;
        if (preview) {
            preview.src = dataUrl;
            preview.classList.remove('hidden');
        }
    } catch (err) {
        alert(err.message || "Could not process that image.");
        e.target.value = "";
        preview?.classList.add('hidden');
    }
});

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
        optionsHTML += `<option value="${prod.id}" ${prod.id == selectedId ? 'selected' : ''}>${escapeHtml(prod.name)} - GH₵ ${parseFloat(prod.price).toLocaleString()}</option>`;
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
    const productsEmptyView = document.getElementById('products-empty-view');
    const productsListView = document.getElementById('products-list-view');
    const productsTableBody = document.getElementById('products-table-body');
    
    if (productsEmptyView && productsListView && productsTableBody) {
        productsTableBody.innerHTML = '';
        if (myProducts.length === 0) {
            window.showProductSubView('empty');
        } else {
            window.showProductSubView('list');
            myProducts.forEach(prod => {
                const imgUrl = (prod.image && prod.image.startsWith('data:image/')) ? prod.image : 'https://via.placeholder.com/48';
                productsTableBody.innerHTML += `
                    <tr>
                        <td style="padding: 16px;"><input type="checkbox" style="width: 16px; height: 16px; border-radius: 4px; border: 1px solid #CBD5E1;"></td>
                        <td style="padding: 16px;">
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <div style="width: 48px; height: 48px; background: #F1F5F9; border-radius: 8px; overflow: hidden;">
                                    <img src="${imgUrl}" alt="prod" style="width: 100%; height: 100%; object-fit: cover;">
                                </div>
                                <span style="font-weight: 500; color: #111827;">${escapeHtml(prod.name)}</span>
                            </div>
                        </td>
                        <td style="padding: 16px;">
                            <span class="badge-published">Published</span>
                        </td>
                        <td style="padding: 16px;">GH₵ ${parseFloat(prod.price).toLocaleString()}</td>
                        <td style="padding: 16px;">100 stock for 1 variants</td>
                        <td style="padding: 16px; text-align: right;"><button class="btn-icon">⋯</button></td>
                    </tr>
                `;
            });
        }
    }

    // Update existing Selects in Modal
    if(escrowLineItems) {
        const selects = escrowLineItems.querySelectorAll('.escrow-product-select');
        selects.forEach(select => {
            const currentVal = select.value;
            let optionsHTML = '<option value="">Choose a product...</option>';
            myProducts.forEach(prod => {
                optionsHTML += `<option value="${prod.id}" ${prod.id == currentVal ? 'selected' : ''}>${escapeHtml(prod.name)} - GH₵ ${parseFloat(prod.price).toLocaleString()}</option>`;
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
            container.insertAdjacentHTML('beforeend', createLineItemHTML(''));
            updateEscrowTotal();
        }
    }
});

// Modern Toast Notification
window.showModernToast = function(title, message, type = "success") {
    let container = document.getElementById("modern-toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "modern-toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `modern-toast modern-toast-${type}`;
    
    let iconSvg = '';
    if (type === "success") {
        iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 28px; height: 28px; color: #10B981;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
    } else if (type === "warning") {
        iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 28px; height: 28px; color: #F59E0B;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>`;
    } else if (type === "error") {
        iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 28px; height: 28px; color: #EF4444;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>`;
    }

    toast.innerHTML = `
        <div class="modern-toast-icon">${iconSvg}</div>
        <div class="modern-toast-content">
            <h4>${escapeHtml(title)}</h4>
            <p>${escapeHtml(message)}</p>
        </div>
        <button class="modern-toast-close" onclick="this.parentElement.classList.add('hide'); setTimeout(() => this.parentElement.remove(), 400);">&times;</button>
        <div class="modern-toast-progress"></div>
    `;

    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add("show");
    });

    setTimeout(() => {
        if(toast.parentElement) {
            toast.classList.remove("show");
            toast.classList.add("hide");
            setTimeout(() => {
                if(toast.parentElement) toast.remove();
            }, 400);
        }
    }, 6000);
};

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
                image: newProductImage || "",
                userId: currentUser.uid,
                createdAt: serverTimestamp()
            };

            await addDoc(collection(db, "products"), newProd);
            await fetchProducts(); // Re-fetch to get Firestore IDs and render

            formNewProd.reset();
            newProductImage = "";
            document.getElementById('new-prod-preview')?.classList.add('hidden');
            
            // Switch back to list view on success
            window.showProductSubView('list');
        } catch (error) {
            console.error("Error adding document: ", error);
            alert("Error adding product.");
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.textContent = 'Add'; // Updated to match the HTML button text
        }
    });
}

// New Products View Toggling Logic
window.showProductSubView = (state) => {
    const emptyView = document.getElementById('products-empty-view');
    const listView = document.getElementById('products-list-view');
    const addView = document.getElementById('products-add-view');
    const title = document.getElementById('current-view-title');

    if(emptyView) emptyView.classList.add('hidden');
    if(listView) listView.classList.add('hidden');
    if(addView) addView.classList.add('hidden');

    if(state === 'empty') {
        if(emptyView) emptyView.classList.remove('hidden');
        if(title) title.textContent = 'Products';
    } else if(state === 'list') {
        if(listView) listView.classList.remove('hidden');
        if(title) title.textContent = 'Products';
    } else if(state === 'add') {
        if(addView) addView.classList.remove('hidden');
        if(title) title.textContent = 'Add Products';
    }
};

window.openAddProductFlow = () => {
    // Go to Products view first
    const productsNav = document.querySelector('.nav-item[data-target="view-products"]');
    if(productsNav) productsNav.click();
    
    // Switch to Add state
    window.showProductSubView('add');
};

document.querySelectorAll('.btn-add-product-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
        window.showProductSubView('add');
    });
});

document.querySelectorAll('.btn-discard-product').forEach(btn => {
    btn.addEventListener('click', () => {
        // Go back to list, if list is empty renderProducts will switch to empty state
        if (typeof renderProducts === 'function') renderProducts();
    });
});

// ==========================================
// API & DEVELOPER SETTINGS
// ==========================================

const btnGenerateApiKey = document.getElementById('btn-generate-api-key');
if (btnGenerateApiKey) {
    btnGenerateApiKey.addEventListener('click', async () => {
        if (!currentUser) return;
        if (confirm("Are you sure you want to generate a new API Key? Your old key will stop working immediately.")) {
            btnGenerateApiKey.disabled = true;
            btnGenerateApiKey.textContent = 'Generating...';
            
            try {
                // Generate a random key (tl_live_ + 32 random chars)
                const array = new Uint8Array(16);
                window.crypto.getRandomValues(array);
                const randomHex = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
                const newApiKey = 'tl_live_' + randomHex;
                
                await updateDoc(doc(db, "users", currentUser.uid), {
                    apiKey: newApiKey
                });
                
                document.getElementById('api-key-display').value = newApiKey;
                alert("New API Key generated successfully!");
            } catch (error) {
                console.error("Error generating API Key:", error);
                alert("Failed to generate API Key: " + error.message);
            } finally {
                btnGenerateApiKey.disabled = false;
                btnGenerateApiKey.textContent = 'Generate New Key';
            }
        }
    });
}

const btnCopyApiKey = document.getElementById('btn-copy-api-key');
if (btnCopyApiKey) {
    btnCopyApiKey.addEventListener('click', async () => {
        const apiKey = document.getElementById('api-key-display').value;
        if (apiKey && apiKey !== '••••••••••••••••••••') {
            try {
                await navigator.clipboard.writeText(apiKey);
                btnCopyApiKey.textContent = 'Copied!';
                setTimeout(() => btnCopyApiKey.textContent = 'Copy', 2000);
            } catch (err) {
                alert("Failed to copy API key.");
            }
        } else {
            alert("Generate an API key first.");
        }
    });
}

const webhookForm = document.getElementById('webhook-settings-form');
if (webhookForm) {
    webhookForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) return;
        
        const webhookUrl = document.getElementById('webhook-url-input').value.trim();
        const btnSaveWebhook = document.getElementById('btn-save-webhook');
        btnSaveWebhook.disabled = true;
        btnSaveWebhook.textContent = 'Saving...';
        
        try {
            await updateDoc(doc(db, "users", currentUser.uid), {
                webhookUrl: webhookUrl
            });
            btnSaveWebhook.textContent = 'Saved ✓';
            setTimeout(() => {
                btnSaveWebhook.disabled = false;
                btnSaveWebhook.textContent = 'Save Webhook';
            }, 1500);
        } catch (error) {
            console.error("Error saving webhook:", error);
            alert("Failed to save webhook: " + error.message);
            btnSaveWebhook.disabled = false;
            btnSaveWebhook.textContent = 'Save Webhook';
        }
    });
}
