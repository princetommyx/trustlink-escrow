import { auth, db, storage } from "./firebase-config.js";
import { onAuthStateChanged, signOut, deleteUser, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, collection, addDoc, query, where, getDocs, serverTimestamp, onSnapshot, updateDoc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { generateSecureToken, sha256Hex, computeFeeSplit, pickUserPhone, normalizePhone, sendWhatsAppNotification, sendEscrowStatusSMS, sendSMSNotification, sendVerificationOTP } from "./moolre-service.js";
import { initSessionTracker, clearUserSession } from "./session-manager.js";
import { callApi } from "./api-client.js";

let currentUser = null;
let currentBalance = 0;
let isPhoneVerified = false;
let verifiedPhone = "";
let pendingPhoneVerification = null;
let resendInterval = null;
let cachedPlatformFeePercent = 2.5;

// Preload platform fee settings in background to avoid blocking escrow creation
const loadPlatformSettings = async () => {
    try {
        const feeSnap = await getDoc(doc(db, "settings", "platform"));
        if (feeSnap.exists() && feeSnap.data().feePercent !== undefined) {
            cachedPlatformFeePercent = parseFloat(feeSnap.data().feePercent) || 1.5;
        }
    } catch (err) {
        console.warn("Using default platform fee (2.5%):", err);
    }
};
loadPlatformSettings();

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
        
        const targetId = item.getAttribute('data-target');
        if (!targetId) return;

        // Remove active class from all
        navItems.forEach(nav => nav.classList.remove('active'));
        views.forEach(view => view.classList.add('hidden'));
        
        // Add active to all matching nav items (sidebar + bottom nav)
        document.querySelectorAll(`.nav-item[data-target="${targetId}"]`).forEach(nav => nav.classList.add('active'));
        const targetView = document.getElementById(targetId);
        if (targetView) targetView.classList.remove('hidden');
        
        // Update Title
        const navTextEl = item.querySelector('.nav-text');
        if (navTextEl && topbarTitle) {
            topbarTitle.textContent = navTextEl.textContent.trim();
        }
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

// Topbar gear icon → open Profile view
const btnTopbarSettings = document.getElementById('btn-topbar-settings');
if (btnTopbarSettings) {
    btnTopbarSettings.addEventListener('click', () => {
        const profileNavItem = document.querySelector('.nav-item[data-target="view-profile"]');
        if (profileNavItem) {
            profileNavItem.click();
        }
    });
}


// Auto-switch tab based on URL hash or sessionStorage
const handleInitialTabRouting = () => {
    const hash = window.location.hash ? window.location.hash.replace('#', '') : null;
    const tabToOpen = hash || sessionStorage.getItem('activeDashboardTab');
    if (tabToOpen) {
        const targetNav = document.querySelector(`.nav-item[data-target="${tabToOpen}"]`);
        if (targetNav) {
            targetNav.click();
        } else if (tabToOpen === 'view-settings' && btnSettingsNav) {
            btnSettingsNav.click();
        }
        sessionStorage.removeItem('activeDashboardTab');
    }
};
window.addEventListener('DOMContentLoaded', handleInitialTabRouting);
handleInitialTabRouting();

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

// Timeframe Filtering Event Listeners
document.getElementById('order-records-timeframe')?.addEventListener('change', (e) => {
    updateOverviewStats(e.target.value);
});

document.getElementById('order-flow-timeframe')?.addEventListener('change', (e) => {
    updateOverviewStats();
});

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

    // Initialize session inactivity tracker
    initSessionTracker({ auth, userType: 'user' });
    
    // Show pending auth toast if any
    const pendingToast = sessionStorage.getItem("authToast");
    if (pendingToast) {
        const type = sessionStorage.getItem("authToastType") || (sessionStorage.getItem("authToastIsError") === "true" ? "error" : "success");
        if (typeof showModernToast === 'function') {
            showModernToast(pendingToast, "", type);
        } else if (typeof window.showModernToast === 'function') {
            window.showModernToast(pendingToast, "", type);
        }
        sessionStorage.removeItem("authToast");
        sessionStorage.removeItem("authToastType");
        sessionStorage.removeItem("authToastIsError");
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
                if (profileEmail) profileEmail.value = data.email || user.email || '';
                if (profileName && document.activeElement !== profileName) profileName.value = data.fullName || '';
                const userPhone = (data.phone || pickUserPhone(data) || '').trim();
                if (profilePhone && document.activeElement !== profilePhone) profilePhone.value = userPhone;

                // Sync phone verification state
                isPhoneVerified = data.phoneVerified === true;
                verifiedPhone = isPhoneVerified ? userPhone : '';
                updatePhoneBadgeUI();
                updateVerificationOverviewUI(data.email || user.email, userPhone, isPhoneVerified);

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

let allLoadedSellerEscrows = [];
let allLoadedBuyerEscrows = [];
let selectedOrderRecordsTimeframe = 'month';
let recentActivities = [];

function getEscrowTime(data) {
    if (!data) return Date.now();
    if (data.createdAt) {
        if (typeof data.createdAt.toMillis === 'function') return data.createdAt.toMillis();
        if (data.createdAt.seconds) return data.createdAt.seconds * 1000;
        const t = new Date(data.createdAt).getTime();
        if (!isNaN(t)) return t;
    }
    if (data.updatedAt) {
        if (typeof data.updatedAt.toMillis === 'function') return data.updatedAt.toMillis();
        if (data.updatedAt.seconds) return data.updatedAt.seconds * 1000;
        const t = new Date(data.updatedAt).getTime();
        if (!isNaN(t)) return t;
    }
    return Date.now();
}

function filterEscrowsByTimeframe(escrowsList, timeframe) {
    if (timeframe === 'all') return escrowsList;
    const now = Date.now();
    let cutoff = 0;
    if (timeframe === 'day') {
        cutoff = now - (24 * 60 * 60 * 1000);
    } else if (timeframe === 'week') {
        cutoff = now - (7 * 24 * 60 * 60 * 1000);
    } else if (timeframe === 'month') {
        cutoff = now - (30 * 24 * 60 * 60 * 1000);
    }
    return escrowsList.filter(e => getEscrowTime(e) >= cutoff);
}

function getPreviousPeriodRange(timeframe) {
    if (timeframe === 'all') return null;
    const now = Date.now();
    if (timeframe === 'day') {
        return { start: now - (48 * 60 * 60 * 1000), end: now - (24 * 60 * 60 * 1000) };
    } else if (timeframe === 'week') {
        return { start: now - (14 * 24 * 60 * 60 * 1000), end: now - (7 * 24 * 60 * 60 * 1000) };
    } else if (timeframe === 'month') {
        return { start: now - (60 * 24 * 60 * 60 * 1000), end: now - (30 * 24 * 60 * 60 * 1000) };
    }
    return null;
}

function updateTrendBadge(elemId, currentCount, prevCount) {
    const el = document.getElementById(elemId);
    if (!el) return;
    if (currentCount === 0 && prevCount === 0) {
        el.style.display = 'none';
        return;
    }
    el.style.display = 'inline-block';
    if (currentCount >= prevCount) {
        const diff = currentCount - prevCount;
        el.className = 'fin-trend trend-up';
        el.textContent = diff > 0 ? `+${diff}` : `0%`;
    } else {
        const diff = prevCount - currentCount;
        el.className = 'fin-trend trend-down';
        el.textContent = `-${diff}`;
    }
}

// ==========================================
// DELIVERY-DAY REMINDERS
// Runs whenever escrows load: if today is (or is past) the expected
// delivery date and no reminder has gone out yet, SMS the buyer to go
// collect the item, confirm delivery, and settle any outstanding payment.
// ==========================================
const formatSingleDate = (d) => {
    if (!d) return '';
    const date = new Date(d + 'T00:00:00');
    return isNaN(date) ? d : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const deliveryDateLabel = (from, to) => {
    // Support old single-date format (backward compat)
    if (from && !to) return formatSingleDate(from);
    if (!from && !to) return '';
    const f = formatSingleDate(from);
    const t = formatSingleDate(to);
    if (f && t && f !== t) return `${f} – ${t}`;
    return f || t;
};

const maybeSendDeliveryReminder = async (escrowId, data) => {
    try {
        // Use deliveryDateTo (latest date) for reminders, fall back to old deliveryDate field
        const reminderDate = data.deliveryDateTo || data.deliveryDate;
        if (!reminderDate || data.deliveryReminderSent || !data.buyerPhone) return;
        if (!['PENDING_PAYMENT', 'FUNDED', 'DISPATCHED'].includes(data.status)) return;
        const due = new Date(reminderDate + 'T00:00:00');
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

function updateOverviewStats(timeframe) {
    if (!timeframe) {
        const select = document.getElementById('order-records-timeframe');
        timeframe = select ? select.value : selectedOrderRecordsTimeframe;
    }
    selectedOrderRecordsTimeframe = timeframe;

    const filteredSeller = filterEscrowsByTimeframe(allLoadedSellerEscrows, timeframe);
    const filteredBuyer = filterEscrowsByTimeframe(allLoadedBuyerEscrows, timeframe);
    const allFiltered = [...filteredSeller, ...filteredBuyer];

    let totalActive = 0;
    let totalPending = 0;
    let totalCompleted = 0;

    allFiltered.forEach(data => {
        if (data.status !== 'COMPLETED' && data.status !== 'DISPUTED') totalActive++;
        if (data.status === 'FUNDED' || data.status === 'DISPATCHED') totalPending++;
        if (data.status === 'COMPLETED') totalCompleted++;
    });

    if(document.getElementById('overview-active-escrows')) document.getElementById('overview-active-escrows').textContent = totalActive;
    if(document.getElementById('overview-pending-releases')) document.getElementById('overview-pending-releases').textContent = totalPending;
    if(document.getElementById('overview-completed-escrows')) document.getElementById('overview-completed-escrows').textContent = totalCompleted;
    
    // Calculate and display dynamic trend badges compared to previous period
    const prevRange = getPreviousPeriodRange(timeframe);
    if (prevRange) {
        const allLoaded = [...allLoadedSellerEscrows, ...allLoadedBuyerEscrows];
        const prevEscrows = allLoaded.filter(e => {
            const t = getEscrowTime(e);
            return t >= prevRange.start && t < prevRange.end;
        });

        let prevActive = 0, prevPending = 0, prevCompleted = 0;
        prevEscrows.forEach(data => {
            if (data.status !== 'COMPLETED' && data.status !== 'DISPUTED') prevActive++;
            if (data.status === 'FUNDED' || data.status === 'DISPATCHED') prevPending++;
            if (data.status === 'COMPLETED') prevCompleted++;
        });

        updateTrendBadge('completed-escrows-trend', totalCompleted, prevCompleted);
        updateTrendBadge('active-escrows-trend', totalActive, prevActive);
        updateTrendBadge('pending-releases-trend', totalPending, prevPending);
    } else {
        const cTrend = document.getElementById('completed-escrows-trend');
        const aTrend = document.getElementById('active-escrows-trend');
        const pTrend = document.getElementById('pending-releases-trend');
        if (cTrend) cTrend.style.display = 'none';
        if (aTrend) aTrend.style.display = 'none';
        if (pTrend) pTrend.style.display = 'none';
    }

    // Set dynamic volume total instead of dummy "$2289"
    const tooltipAmount = document.getElementById('chart-tooltip-amount');
    const tooltipContainer = document.getElementById('chart-tooltip');
    if (tooltipAmount && tooltipContainer) {
        tooltipContainer.style.display = 'none'; 
    }

    // Sort recent activities by timestamp (descending)
    recentActivities.sort((a, b) => b.time - a.time);

    // Notification bell: dot when something needs attention, dropdown = recent activity
    const notifDot = document.getElementById('notif-dot');
    if (notifDot) {
        const globalPending = allLoadedSellerEscrows.filter(d => d.status === 'FUNDED' || d.status === 'DISPATCHED').length +
                              allLoadedBuyerEscrows.filter(d => d.status === 'FUNDED' || d.status === 'DISPATCHED').length;
        notifDot.classList.toggle('hidden', globalPending === 0);
    }
    const notifList = document.getElementById('notif-list');
    if (notifList) {
        if (recentActivities.length === 0) {
            notifList.innerHTML = `
                <div class="notif-empty">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 28px; height: 28px; color: #94A3B8; margin-bottom: 4px;">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                    </svg>
                    <span>No notifications yet</span>
                </div>
            `;
        } else {
            notifList.innerHTML = '';
            recentActivities.slice(0, 8).forEach(act => {
                let iconBg = '#EFF6FF';
                let iconColor = '#2563EB';
                let iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 18px; height: 18px;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
                let statusLabel = 'Pending';
                let statusBadgeColor = '#D97706';
                let statusBadgeBg = '#FEF3C7';

                if (act.status === 'COMPLETED') {
                    iconBg = '#ECFDF5';
                    iconColor = '#10B981';
                    iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 18px; height: 18px;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
                    statusLabel = 'Completed';
                    statusBadgeColor = '#059669';
                    statusBadgeBg = '#D1FAE5';
                } else if (act.status === 'DISPATCHED') {
                    iconBg = '#F5F3FF';
                    iconColor = '#8B5CF6';
                    iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 18px; height: 18px;"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.25V3.75A1.125 1.125 0 0013.125 2.625h-7.5A1.125 1.125 0 004.5 3.75v10.5c0 .621.504 1.125 1.125 1.125h.375" /></svg>`;
                    statusLabel = 'Dispatched';
                    statusBadgeColor = '#7C3AED';
                    statusBadgeBg = '#EDE9FE';
                } else if (act.status === 'FUNDED') {
                    iconBg = '#EFF6FF';
                    iconColor = '#3B82F6';
                    iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 18px; height: 18px;"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v.375c0 .621.504 1.125 1.125 1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-10.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V5.25c0-.621.504-1.125 1.125-1.125h16.5c.621 0 1.125.504 1.125 1.125v.75" /></svg>`;
                    statusLabel = 'Funded';
                    statusBadgeColor = '#1D4ED8';
                    statusBadgeBg = '#DBEAFE';
                } else if (act.status === 'CANCELED' || act.status === 'DISPUTED') {
                    iconBg = '#FEF2F2';
                    iconColor = '#EF4444';
                    iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 18px; height: 18px;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>`;
                    statusLabel = act.status === 'DISPUTED' ? 'Disputed' : 'Cancelled';
                    statusBadgeColor = '#DC2626';
                    statusBadgeBg = '#FEE2E2';
                }

                const formattedTime = new Date(act.time).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                const formattedAmount = act.amount ? `GH₵ ${Number(act.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : act.description;

                notifList.innerHTML += `
                    <div class="notif-item">
                        <div class="notif-icon-box" style="background: ${iconBg}; color: ${iconColor};">
                            ${iconSvg}
                        </div>
                        <div class="notif-body">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                                <h5>${escapeHtml(act.title)}</h5>
                                <span style="font-size: 0.68rem; font-weight: 700; padding: 2px 7px; border-radius: 6px; background: ${statusBadgeBg}; color: ${statusBadgeColor};">${statusLabel}</span>
                            </div>
                            <p style="font-weight: 600; color: #0F172A; font-size: 0.85rem;">${escapeHtml(formattedAmount)}</p>
                            <div class="notif-time">${formattedTime}</div>
                        </div>
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
            sellerEscrowsContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">You have not created any orders as a seller.</p>';
            allLoadedSellerEscrows = [];
            recentActivities = recentActivities.filter(a => a.type !== 'seller');
            updateOverviewStats();
        } else {
            sellerEscrowsContainer.innerHTML = '';
            allLoadedSellerEscrows = [];
            // Remove old seller activities
            recentActivities = recentActivities.filter(a => a.type !== 'seller');
            
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const escrowId = docSnap.id;
                allLoadedSellerEscrows.push({ id: escrowId, ...data });
                maybeSendDeliveryReminder(escrowId, data);
                
                if(data.createdAt) {
                    recentActivities.push({
                        type: 'seller',
                        time: data.createdAt.toMillis ? data.createdAt.toMillis() : Date.now(),
                        title: data.productName || data.description || (data.buyerEmail ? `Order: ${data.buyerEmail.split('@')[0]}` : (data.buyerPhone ? `Order: ${data.buyerPhone}` : 'Escrow Deposit')),
                        status: data.status,
                        amount: data.amount,
                        description: `GH₵ ${Number(data.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    });
                }
                
                let statusUI = '';
                let actionBtn = '';
                
                if (data.status === 'PENDING_PAYMENT') {
                    statusUI = `<span style="background-color: rgba(245, 158, 11, 0.15); color: var(--warning); border: 1px solid var(--warning); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 700;">AWAITING PAYMENT</span>`;
                    const checkoutUrl = `${window.location.origin}/checkout.html?id=${escrowId}`;
                    actionBtn = `
                        <div class="order-action-group">
                            <button type="button" class="btn-order-action btn-order-copy" onclick="window.copyToClipboard('${checkoutUrl}')" title="Copy checkout link">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                                </svg>
                                <span>COPY LINK</span>
                            </button>
                            <button type="button" class="btn-order-action btn-order-sms" onclick="window.notifyBuyerViaSMS('${escrowId}')" title="Notify buyer via SMS">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a.75.75 0 01-.873-.873c.12-.596.34-1.285.666-1.992C3.125 16.536 2.25 14.394 2.25 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                                </svg>
                                <span>SMS BUYER</span>
                            </button>
                            <button type="button" class="btn-order-action btn-order-whatsapp" onclick="window.shareEscrowViaWhatsApp('${escrowId}')" title="Share via WhatsApp">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                                </svg>
                                <span>WHATSAPP</span>
                            </button>
                        </div>
                    `;
                } else if (data.status === 'AWAITING_VERIFICATION') {
                    statusUI = `<span style="background-color: rgba(217, 119, 6, 0.15); color: #d97706; border: 1px solid #d97706; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 700;">VERIFYING PAYMENT</span>`;
                } else if (data.status === 'FUNDED') {
                    statusUI = `<span style="background-color: rgba(59, 130, 246, 0.15); color: #3b82f6; border: 1px solid #3b82f6; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 700;">FUNDED - DISPATCH NOW</span>`;
                    actionBtn = `
                        <div class="order-action-group">
                            <button class="btn btn-primary" onclick="window.dispatchItem('${escrowId}')">MARK AS DISPATCHED</button>
                            <button type="button" class="btn-order-action btn-order-whatsapp" onclick="window.shareEscrowViaWhatsApp('${escrowId}')" title="Message Buyer on WhatsApp">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" style="width:15px;height:15px;"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                                <span>WHATSAPP</span>
                            </button>
                        </div>
                    `;
                } else if (data.status === 'DISPATCHED') {
                    statusUI = `<span style="background-color: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid var(--success); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 700;">DISPATCHED</span>`;
                } else if (data.status === 'COMPLETED') {
                    statusUI = `<span style="background-color: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid var(--success); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 700;">COMPLETED</span>`;
                } else if (data.status === 'DISPUTED') {
                    statusUI = `<span style="background-color: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid var(--danger); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 700;">DISPUTED</span>`;
                }

                const formattedAmount = Number(data.amount || data.totalAmount || data.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                sellerEscrowsContainer.innerHTML += `
                    <div class="order-ledger-row">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                            <span style="font-weight: 700; color: #0F172A; font-size: 1rem;">${escapeHtml(data.description || data.productName || 'Order')} - #${escrowId.substring(0, 8).toUpperCase()}</span>
                            ${statusUI}
                        </div>
                        <p style="margin: 0 0 1rem 0; color: #64748B; font-size: 0.95rem;"><strong>Value:</strong> GH₵ ${formattedAmount}${(data.deliveryDateFrom || data.deliveryDateTo || data.deliveryDate) ? ` · <strong>Delivery:</strong> ${deliveryDateLabel(data.deliveryDateFrom || data.deliveryDate, data.deliveryDateTo)}` : ``}</p>
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
            buyerEscrowsContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">You have no active orders as a buyer.</p>';
            allLoadedBuyerEscrows = [];
            recentActivities = recentActivities.filter(a => a.type !== 'buyer');
            updateOverviewStats();
        } else {
            buyerEscrowsContainer.innerHTML = '';
            allLoadedBuyerEscrows = [];
            // Remove old buyer activities
            recentActivities = recentActivities.filter(a => a.type !== 'buyer');
            
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const escrowId = docSnap.id;
                allLoadedBuyerEscrows.push({ id: escrowId, ...data });
                maybeSendDeliveryReminder(escrowId, data);
                
                if(data.createdAt) {
                    recentActivities.push({
                        type: 'buyer',
                        time: data.createdAt.toMillis ? data.createdAt.toMillis() : Date.now(),
                        title: data.productName || data.description || (data.sellerEmail ? `Order: ${data.sellerEmail.split('@')[0]}` : 'Escrow Payment'),
                        status: data.status,
                        amount: data.amount,
                        description: `GH₵ ${Number(data.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    });
                }
                
                let statusUI = '';
                let actionBtn = '';
                
                if (data.status === 'PENDING_PAYMENT') {
                    statusUI = `<span style="background-color: rgba(245, 158, 11, 0.15); color: var(--warning); border: 1px solid var(--warning); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 700;">PAYMENT REQUIRED</span>`;
                    actionBtn = `<a href="checkout.html?id=${escrowId}" target="_blank" class="btn btn-primary">PAY NOW</a>`;
                } else if (data.status === 'AWAITING_VERIFICATION') {
                    statusUI = `<span style="background-color: rgba(217, 119, 6, 0.15); color: #d97706; border: 1px solid #d97706; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 700;">VERIFYING PAYMENT</span>`;
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

                const buyerAmount = Number(data.amount || data.totalAmount || data.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                buyerEscrowsContainer.innerHTML += `
                    <div class="order-ledger-row">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                            <span style="font-weight: 700; color: #0F172A; font-size: 1rem;">${escapeHtml(data.description || data.productName || 'Order')} - #${escrowId.substring(0, 8).toUpperCase()}</span>
                            ${statusUI}
                        </div>
                        <p style="margin: 0 0 1rem 0; color: #64748B; font-size: 0.95rem;"><strong>Value:</strong> GH₵ ${buyerAmount}${(data.deliveryDateFrom || data.deliveryDateTo || data.deliveryDate) ? ` · <strong>Delivery:</strong> ${deliveryDateLabel(data.deliveryDateFrom || data.deliveryDate, data.deliveryDateTo)}` : ``}</p>
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
    let copied = false;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            copied = true;
        }
    } catch (err) {
        console.warn("Clipboard API failed, trying execCommand fallback:", err);
    }

    if (!copied) {
        try {
            const tempInput = document.createElement("textarea");
            tempInput.value = text;
            tempInput.style.position = "fixed";
            tempInput.style.left = "-9999px";
            tempInput.style.top = "0";
            document.body.appendChild(tempInput);
            tempInput.focus();
            tempInput.select();
            copied = document.execCommand('copy');
            document.body.removeChild(tempInput);
        } catch (copyErr) {
            console.warn("execCommand fallback failed:", copyErr);
        }
    }

    if (copied) {
        if (typeof showModernToast === 'function') {
            showModernToast("Link Copied!", "Payment link copied to clipboard. You can now paste and send it to the buyer.", "success");
        } else if (typeof window.showModernToast === 'function') {
            window.showModernToast("Link Copied!", "Payment link copied to clipboard. You can now paste and send it to the buyer.", "success");
        }
    } else {
        prompt("Copy the payment link below:", text);
    }
};

window.openNotifyModal = (escrow) => {
    const modal = document.getElementById('notify-buyer-modal');
    if (!modal) {
        const inputPhone = prompt("Enter the buyer's Ghana phone number (e.g. 0244123456):");
        if (inputPhone) {
            window.submitNotifyBuyerDirect(escrow.id, inputPhone, 'sms');
        }
        return;
    }
    
    const idInput = document.getElementById('notify-escrow-id');
    if (idInput) idInput.value = escrow.id;

    const refEl = document.getElementById('notify-modal-ref');
    if (refEl) refEl.textContent = '#' + escrow.id.substring(0, 8).toUpperCase();

    const descEl = document.getElementById('notify-modal-desc');
    if (descEl) descEl.textContent = escrow.description || escrow.productName || 'Escrow Order';

    const amtEl = document.getElementById('notify-modal-amount');
    if (amtEl) {
        const amountVal = Number(escrow.amount || escrow.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        amtEl.textContent = 'GH₵ ' + amountVal;
    }
    
    const phoneInput = document.getElementById('notify-buyer-phone');
    if (phoneInput) {
        phoneInput.value = escrow.buyerPhone || '';
        setTimeout(() => phoneInput.focus(), 150);
    }
    
    modal.classList.remove('hidden');
};

window.closeNotifyModal = () => {
    const modal = document.getElementById('notify-buyer-modal');
    if (modal) modal.classList.add('hidden');
};

window.notifyBuyerViaSMS = async (escrowId) => {
    try {
        let escrow = allLoadedSellerEscrows.find(e => e.id === escrowId);
        if (!escrow) {
            const snap = await getDoc(doc(db, "escrows", escrowId));
            if (snap.exists()) {
                escrow = { id: snap.id, ...snap.data() };
            }
        }
        if (!escrow) {
            if (typeof showModernToast === 'function') {
                showModernToast("Order Not Found", "Could not locate this escrow order details.", "error");
            } else {
                alert("Could not locate this escrow order details.");
            }
            return;
        }

        const phone = escrow.buyerPhone ? String(escrow.buyerPhone).trim() : "";
        const cleanDigits = phone.replace(/[^0-9]/g, '');

        if (cleanDigits.length >= 9) {
            const checkoutUrl = `${window.location.origin}/checkout.html?id=${escrowId}`;
            const formattedAmount = Number(escrow.amount || escrow.totalAmount || 0).toFixed(2);
            const orderTitle = escrow.description || escrow.productName || "Order #" + escrowId.substring(0, 8);
            const seller = escrow.sellerName || (currentUser && currentUser.displayName ? currentUser.displayName : "TrustLink Seller");
            const smsMessage = `TrustLink: ${seller} created an escrow for ${orderTitle} (GH₵ ${formattedAmount}). Pay securely at: ${checkoutUrl}`;

            const intlPhone = cleanDigits.startsWith('0') ? ('233' + cleanDigits.slice(1)) : cleanDigits;
            const smsUri = `sms:${intlPhone}?&body=${encodeURIComponent(smsMessage)}`;

            const smsDetails = {
                description: orderTitle,
                amount: escrow.amount || escrow.totalAmount || 0,
                sellerName: seller
            };

            // Attempt cloud SMS API dispatch first
            try {
                const res = await sendSMSNotification(phone, checkoutUrl, escrowId, smsMessage, smsDetails);
                if (res && res.success) {
                    if (typeof showModernToast === 'function') {
                        showModernToast("SMS Sent!", `Payment link delivered to ${phone}.`, "success");
                    }
                    return;
                }
            } catch (smsErr) {
                console.warn("Cloud SMS dispatch notice:", smsErr);
            }

            // Direct native SMS trigger fallback for guaranteed immediate delivery on phones
            window.location.href = smsUri;
            if (typeof showModernToast === 'function') {
                showModernToast("Opening Messages", `SMS invoice ready to send to ${phone}.`, "info");
            }
        } else {
            window.openNotifyModal(escrow);
        }
    } catch (err) {
        console.error("Notify via SMS error:", err);
        if (typeof showModernToast === 'function') {
            showModernToast("Action Error", err.message || "Could not complete SMS notification.", "error");
        }
    }
};

window.shareEscrowViaWhatsApp = async (escrowId) => {
    try {
        let escrow = allLoadedSellerEscrows.find(e => e.id === escrowId);
        if (!escrow) {
            const snap = await getDoc(doc(db, "escrows", escrowId));
            if (snap.exists()) {
                escrow = { id: snap.id, ...snap.data() };
            }
        }
        if (!escrow) {
            if (typeof showModernToast === 'function') {
                showModernToast("Order Not Found", "Could not locate this escrow order details.", "error");
            } else {
                alert("Could not locate this escrow order details.");
            }
            return;
        }

        const checkoutUrl = `${window.location.origin}/checkout.html?id=${escrowId}`;
        const formattedAmount = Number(escrow.amount || escrow.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const item = escrow.description || escrow.productName || `Order #${escrowId.substring(0, 8).toUpperCase()}`;
        const seller = escrow.sellerName || (currentUser && currentUser.displayName ? currentUser.displayName : "TrustLink Seller");
        const delivery = (escrow.deliveryDateFrom || escrow.deliveryDateTo || escrow.deliveryDate) ? `\nEstimated Delivery: ${deliveryDateLabel(escrow.deliveryDateFrom || escrow.deliveryDate, escrow.deliveryDateTo)}` : "";

        const message = 
`TRUSTLINK ESCROW PAYMENT INVOICE

Item / Order: ${item}
Total Amount: GH₵ ${formattedAmount}
Seller: ${seller}${delivery}

Your payment remains securely protected in TrustLink Escrow until you receive and verify your order.

Pay securely here:
${checkoutUrl}

Protected by TrustLink Escrow Ghana`;

        const phone = escrow.buyerPhone ? String(escrow.buyerPhone).trim() : "";
        let whatsappUrl = "";

        if (phone && phone.replace(/[^0-9]/g, '').length >= 9) {
            const intlPhone = normalizePhone(phone);
            whatsappUrl = `https://wa.me/${intlPhone}?text=${encodeURIComponent(message)}`;
        } else {
            whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
        }

        window.open(whatsappUrl, '_blank');
    } catch (err) {
        console.error("WhatsApp share error:", err);
        if (typeof showModernToast === 'function') {
            showModernToast("WhatsApp Share Failed", err.message || "Could not prepare WhatsApp share.", "error");
        }
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
                    if (typeof showModernToast === 'function') {
                        showModernToast("Item Dispatched!", "The buyer has been sent a private link to confirm delivery.", "success");
                    }
                } catch (smsErr) {
                    console.warn("Confirmation SMS failed:", smsErr);
                    prompt("Dispatched! SMS failed, so share this private confirmation link with the buyer yourself:", confirmUrl);
                }
            } else {
                prompt("Dispatched! No buyer phone on file - share this private confirmation link with the buyer:", confirmUrl);
            }
        } catch (error) {
            console.error("Error dispatching:", error);
            if (typeof showModernToast === 'function') {
                showModernToast("Dispatch Error", error.message, "error");
            } else {
                alert("Error: " + error.message);
            }
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

            if (typeof showModernToast === 'function') {
                showModernToast("Funds Released!", "Thank you for using TrustLink. Funds credited to seller.", "success");
            }
        } catch (error) {
            console.error("Error releasing funds:", error);
            if (typeof showModernToast === 'function') {
                showModernToast("Release Error", error.message, "error");
            } else {
                alert("Error: " + error.message);
            }
        }
    }
};

window.raiseDispute = async (escrowId) => {
    if(confirm("Are you sure you want to raise a dispute? Escrow funds will remain locked.")) {
        try {
            await updateDoc(doc(db, "escrows", escrowId), { status: 'DISPUTED' });
            if (typeof showModernToast === 'function') {
                showModernToast("Dispute Raised", "Escrow locked. TrustLink support will review and reach out.", "warning");
            }
        } catch (error) {
            console.error("Error raising dispute:", error);
            if (typeof showModernToast === 'function') {
                showModernToast("Dispute Error", error.message, "error");
            } else {
                alert("Error: " + error.message);
            }
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
        statusText.textContent = 'Optimizing & uploading... Please wait.';
        statusText.style.color = '#10B981';
    }
    if(saveBtn) saveBtn.disabled = true;

    // Helper: compress image to fast, lightweight avatar (< 50KB)
    const compressImage = (imageFile) => {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onerror = reject;
            r.onload = () => {
                const img = new Image();
                img.onerror = reject;
                img.onload = () => {
                    const maxSize = 256;
                    let w = img.width;
                    let h = img.height;
                    if (w > h) {
                        if (w > maxSize) {
                            h = Math.round((h * maxSize) / w);
                            w = maxSize;
                        }
                    } else {
                        if (h > maxSize) {
                            w = Math.round((w * maxSize) / h);
                            h = maxSize;
                        }
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                    canvas.toBlob((blob) => {
                        resolve({ blob: blob || imageFile, dataUrl });
                    }, 'image/jpeg', 0.85);
                };
                img.src = r.result;
            };
            r.readAsDataURL(imageFile);
        });
    };

    try {
        const { blob, dataUrl } = await compressImage(file);

        // Immediate visual preview
        const avatarEl = document.getElementById('profile-avatar');
        if (avatarEl) avatarEl.style.backgroundImage = `url('${dataUrl}')`;

        let finalPhotoURL = dataUrl;

        // Attempt Firebase Storage with a 5s race timeout
        try {
            const storageRef = ref(storage, `users/${currentUser.uid}/profile_${Date.now()}.jpg`);
            const uploadTask = uploadBytes(storageRef, blob).then(() => getDownloadURL(storageRef));
            const timeoutTask = new Promise((_, reject) => setTimeout(() => reject(new Error('Storage Timeout')), 5000));
            
            const storageUrl = await Promise.race([uploadTask, timeoutTask]);
            if (storageUrl) {
                finalPhotoURL = storageUrl;
            }
        } catch (storageErr) {
            console.warn("Storage upload timed out or unavailable; using optimized data URL:", storageErr);
            finalPhotoURL = dataUrl;
        }

        await updateDoc(doc(db, "users", currentUser.uid), {
            photoURL: finalPhotoURL
        });

        if (avatarEl) avatarEl.style.backgroundImage = `url('${finalPhotoURL}')`;

        if(statusText) {
            statusText.textContent = 'Avatar updated successfully!';
            statusText.style.color = '#10B981';
            setTimeout(() => { statusText.style.display = 'none'; }, 2500);
        }
    } catch (error) {
        console.error("Avatar upload error:", error);
        if(statusText) {
            statusText.textContent = 'Upload failed. Please try again.';
            statusText.style.color = '#EF4444';
        }
        alert("Failed to upload avatar: " + (error.message || "Please check your network connection."));
    } finally {
        if(saveBtn) saveBtn.disabled = false;
    }
});

// -------------------------------------------------------------
// Phone Verification & Profile Handlers
// -------------------------------------------------------------
function arePhonesEquivalent(p1, p2) {
    if (!p1 || !p2) return false;
    const digits1 = String(p1).replace(/[^0-9]/g, '');
    const digits2 = String(p2).replace(/[^0-9]/g, '');
    if (!digits1 || !digits2) return false;
    if (digits1 === digits2) return true;
    const suffix1 = digits1.length > 9 ? digits1.slice(-9) : digits1;
    const suffix2 = digits2.length > 9 ? digits2.slice(-9) : digits2;
    return suffix1.length === 9 && suffix1 === suffix2;
}

function updateVerificationOverviewUI(userEmail, userPhone, isVerified) {
    const verificationEmailText = document.getElementById('verification-email-text');
    const statusEmail = document.getElementById('status-email');
    const verificationPhoneText = document.getElementById('verification-phone-text');
    const statusPhone = document.getElementById('status-phone');

    if (verificationEmailText && userEmail) {
        verificationEmailText.textContent = userEmail;
    }
    if (statusEmail) {
        statusEmail.textContent = 'Verified';
        statusEmail.style.color = '#22C55E';
    }

    const cleanPhone = (userPhone || '').trim();
    if (verificationPhoneText) {
        verificationPhoneText.textContent = cleanPhone || '*** *** ****';
    }

    if (statusPhone) {
        if (isVerified && cleanPhone) {
            statusPhone.textContent = 'Verified';
            statusPhone.style.color = '#22C55E';
        } else {
            statusPhone.textContent = 'Pending';
            statusPhone.style.color = '#F59E0B';
        }
    }
}

function updatePhoneBadgeUI(currentInputVal) {
    const profilePhone = document.getElementById('profile-phone');
    const rawVal = (currentInputVal !== undefined ? currentInputVal : (profilePhone ? profilePhone.value : '')).trim();
    const verifiedBadge = document.getElementById('phone-verified-badge');
    const unverifiedBadge = document.getElementById('phone-unverified-badge');
    const verifyBtn = document.getElementById('btn-verify-phone-trigger');

    if (!rawVal) {
        if (verifiedBadge) verifiedBadge.style.display = 'none';
        if (unverifiedBadge) unverifiedBadge.style.display = 'none';
        if (verifyBtn) verifyBtn.style.display = 'none';
        return;
    }

    const isMatch = isPhoneVerified && (rawVal === verifiedPhone || arePhonesEquivalent(rawVal, verifiedPhone));

    if (isMatch) {
        if (verifiedBadge) verifiedBadge.style.display = 'inline-flex';
        if (unverifiedBadge) unverifiedBadge.style.display = 'none';
        if (verifyBtn) verifyBtn.style.display = 'none';
    } else {
        if (verifiedBadge) verifiedBadge.style.display = 'none';
        if (unverifiedBadge) unverifiedBadge.style.display = 'inline-flex';
        if (verifyBtn) verifyBtn.style.display = 'inline-block';
    }
}

document.getElementById('profile-phone')?.addEventListener('input', (e) => {
    updatePhoneBadgeUI(e.target.value);
});

const phoneVerifyModal = document.getElementById('phone-verify-modal');
const closePhoneVerifyModal = document.getElementById('close-phone-verify-modal');
const phoneOtpForm = document.getElementById('phone-otp-form');
const phoneOtpInput = document.getElementById('phone-otp-input');
const phoneOtpError = document.getElementById('phone-otp-error');
const verifyModalPhone = document.getElementById('verify-modal-phone');
const btnResendPhoneOtp = document.getElementById('btn-resend-phone-otp');
const resendTimer = document.getElementById('resend-timer');
const resendCountdown = document.getElementById('resend-countdown');

// Inline OTP elements
const inlineOtpSection = document.getElementById('inline-otp-section');
const inlineOtpTargetPhone = document.getElementById('inline-otp-target-phone');
const inlinePhoneOtpInput = document.getElementById('inline-phone-otp-input');
const inlinePhoneOtpError = document.getElementById('inline-phone-otp-error');
const btnInlineVerifyOtp = document.getElementById('btn-inline-verify-otp');
const btnInlineResendOtp = document.getElementById('btn-inline-resend-otp');
const inlineResendTimer = document.getElementById('inline-resend-timer');
const inlineResendCountdown = document.getElementById('inline-resend-countdown');
const btnInlineCancelOtp = document.getElementById('btn-inline-cancel-otp');

function startResendCountdown() {
    if (resendInterval) clearInterval(resendInterval);
    let secondsLeft = 30;

    // Modal elements
    if (btnResendPhoneOtp) btnResendPhoneOtp.style.display = 'none';
    if (resendTimer) resendTimer.style.display = 'inline';
    if (resendCountdown) resendCountdown.textContent = secondsLeft;

    // Inline elements
    if (btnInlineResendOtp) btnInlineResendOtp.style.display = 'none';
    if (inlineResendTimer) inlineResendTimer.style.display = 'inline';
    if (inlineResendCountdown) inlineResendCountdown.textContent = secondsLeft;

    resendInterval = setInterval(() => {
        secondsLeft--;
        if (resendCountdown) resendCountdown.textContent = secondsLeft;
        if (inlineResendCountdown) inlineResendCountdown.textContent = secondsLeft;
        
        if (secondsLeft <= 0) {
            clearInterval(resendInterval);
            if (resendTimer) resendTimer.style.display = 'none';
            if (btnResendPhoneOtp) {
                btnResendPhoneOtp.style.display = 'inline';
                btnResendPhoneOtp.disabled = false;
            }
            if (inlineResendTimer) inlineResendTimer.style.display = 'none';
            if (btnInlineResendOtp) {
                btnInlineResendOtp.style.display = 'inline';
                btnInlineResendOtp.disabled = false;
            }
        }
    }, 1000);
}

document.getElementById('btn-verify-phone-trigger')?.addEventListener('click', async () => {
    const phoneInput = document.getElementById('profile-phone');
    const phone = phoneInput ? phoneInput.value.trim() : '';
    const cleanDigits = phone.replace(/[^0-9]/g, '');

    if (!phone || cleanDigits.length < 9) {
        if (typeof showModernToast === 'function') {
            showModernToast("Invalid Phone Number", "Please enter a valid phone number (e.g., 0551234567) to verify.", "warning");
        } else {
            alert("Please enter a valid phone number to verify.");
        }
        if (phoneInput) phoneInput.focus();
        return;
    }

    const triggerBtn = document.getElementById('btn-verify-phone-trigger');
    const originalText = triggerBtn.textContent;
    triggerBtn.disabled = true;
    triggerBtn.textContent = 'Sending SMS...';

    const generatedOtp = Math.floor(1000 + Math.random() * 9000).toString();
    pendingPhoneVerification = {
        phone: phone,
        otp: generatedOtp,
        timestamp: Date.now()
    };

    try {
        console.log(`[PHONE VERIFICATION] Sending OTP ${generatedOtp} to ${phone}`);
        await sendVerificationOTP(phone, generatedOtp);
        
        // Setup inline OTP box
        if (inlineOtpSection) {
            inlineOtpSection.style.display = 'block';
            if (inlineOtpTargetPhone) inlineOtpTargetPhone.textContent = phone;
            if (inlinePhoneOtpInput) {
                inlinePhoneOtpInput.value = '';
                inlinePhoneOtpInput.style.borderColor = '#CBD5E1';
                setTimeout(() => inlinePhoneOtpInput.focus(), 150);
            }
            if (inlinePhoneOtpError) inlinePhoneOtpError.style.display = 'none';
        }

        // Setup modal fallback if needed
        if (verifyModalPhone) verifyModalPhone.textContent = phone;
        if (phoneOtpInput) {
            phoneOtpInput.value = '';
            phoneOtpInput.style.borderColor = '#E2E8F0';
        }
        if (phoneOtpError) phoneOtpError.style.display = 'none';
        
        startResendCountdown();
        if (typeof showModernToast === 'function') {
            showModernToast("Code Sent", `A 4-digit verification code was sent to ${phone}`, "info");
        }
    } catch (error) {
        console.error("Failed to send OTP:", error);
        if (typeof showModernToast === 'function') {
            showModernToast("SMS Failed", "Could not send verification SMS. Please try again.", "error");
        } else {
            alert("Could not send verification SMS: " + error.message);
        }
    } finally {
        triggerBtn.disabled = false;
        triggerBtn.textContent = originalText;
    }
});

btnInlineCancelOtp?.addEventListener('click', () => {
    if (inlineOtpSection) inlineOtpSection.style.display = 'none';
    if (resendInterval) clearInterval(resendInterval);
});

async function verifySubmittedOtp(enteredOtp, submitBtn, errorElement, inputElement) {
    if (!currentUser || !pendingPhoneVerification) return;

    if (enteredOtp !== pendingPhoneVerification.otp) {
        if (errorElement) {
            errorElement.textContent = "Invalid verification code. Please check your SMS and try again.";
            errorElement.style.display = 'block';
        }
        if (inputElement) {
            inputElement.style.borderColor = '#EF4444';
            inputElement.focus();
        }
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Verifying...';
    }

    try {
        await updateDoc(doc(db, "users", currentUser.uid), {
            phone: pendingPhoneVerification.phone,
            phoneVerified: true,
            phoneVerifiedAt: serverTimestamp()
        });

        isPhoneVerified = true;
        verifiedPhone = pendingPhoneVerification.phone;
        updatePhoneBadgeUI();
        updateVerificationOverviewUI(currentUser.email, verifiedPhone, true);

        if (inlineOtpSection) inlineOtpSection.style.display = 'none';
        if (phoneVerifyModal) phoneVerifyModal.classList.add('hidden');
        if (resendInterval) clearInterval(resendInterval);
        
        if (typeof showModernToast === 'function') {
            showModernToast("Phone Verified!", "Your phone number has been verified successfully.", "success");
        }
    } catch (error) {
        console.error("Error saving phone verification:", error);
        if (errorElement) {
            errorElement.textContent = "Failed to save verification: " + error.message;
            errorElement.style.display = 'block';
        }
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Verify Code';
        }
    }
}

// Inline verify button click
btnInlineVerifyOtp?.addEventListener('click', () => {
    const enteredOtp = (inlinePhoneOtpInput ? inlinePhoneOtpInput.value.trim() : '');
    verifySubmittedOtp(enteredOtp, btnInlineVerifyOtp, inlinePhoneOtpError, inlinePhoneOtpInput);
});

// Inline OTP Enter key and auto-submit on 4th digit
inlinePhoneOtpInput?.addEventListener('keyup', (e) => {
    if (inlinePhoneOtpError) inlinePhoneOtpError.style.display = 'none';
    if (inlinePhoneOtpInput) inlinePhoneOtpInput.style.borderColor = '#CBD5E1';
    
    if (e.key === 'Enter') {
        const enteredOtp = inlinePhoneOtpInput.value.trim();
        verifySubmittedOtp(enteredOtp, btnInlineVerifyOtp, inlinePhoneOtpError, inlinePhoneOtpInput);
    } else if (inlinePhoneOtpInput.value.trim().length === 4) {
        const enteredOtp = inlinePhoneOtpInput.value.trim();
        verifySubmittedOtp(enteredOtp, btnInlineVerifyOtp, inlinePhoneOtpError, inlinePhoneOtpInput);
    }
});

// Inline resend button click
btnInlineResendOtp?.addEventListener('click', async () => {
    if (!pendingPhoneVerification) return;
    
    btnInlineResendOtp.disabled = true;
    btnInlineResendOtp.textContent = 'Sending...';

    const newOtp = Math.floor(1000 + Math.random() * 9000).toString();
    pendingPhoneVerification.otp = newOtp;

    try {
        await sendVerificationOTP(pendingPhoneVerification.phone, newOtp);
        if (typeof showModernToast === 'function') {
            showModernToast("Code Resent", `A new 4-digit code was sent to ${pendingPhoneVerification.phone}`, "info");
        }
        startResendCountdown();
    } catch (error) {
        console.error("Resend error:", error);
        if (typeof showModernToast === 'function') {
            showModernToast("Failed to resend code", error.message, "error");
        }
    } finally {
        btnInlineResendOtp.textContent = 'Resend Code';
    }
});

closePhoneVerifyModal?.addEventListener('click', () => {
    if (phoneVerifyModal) phoneVerifyModal.classList.add('hidden');
    if (resendInterval) clearInterval(resendInterval);
});

btnResendPhoneOtp?.addEventListener('click', async () => {
    if (!pendingPhoneVerification) return;
    
    btnResendPhoneOtp.disabled = true;
    btnResendPhoneOtp.textContent = 'Sending...';

    const newOtp = Math.floor(1000 + Math.random() * 9000).toString();
    pendingPhoneVerification.otp = newOtp;

    try {
        await sendVerificationOTP(pendingPhoneVerification.phone, newOtp);
        if (typeof showModernToast === 'function') {
            showModernToast("Code Resent", `A new 4-digit code was sent to ${pendingPhoneVerification.phone}`, "info");
        }
        startResendCountdown();
    } catch (error) {
        console.error("Resend error:", error);
        if (typeof showModernToast === 'function') {
            showModernToast("Failed to resend code", error.message, "error");
        }
    } finally {
        btnResendPhoneOtp.textContent = 'Resend Code';
    }
});

phoneOtpForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const enteredOtp = (phoneOtpInput ? phoneOtpInput.value.trim() : '');
    const submitBtn = document.getElementById('btn-submit-phone-otp');
    verifySubmittedOtp(enteredOtp, submitBtn, phoneOtpError, phoneOtpInput);
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
        const updateData = {
            fullName: name,
            phone: phone
        };
        // If phone changed from the verified number, mark as unverified
        if (isPhoneVerified && !arePhonesEquivalent(phone, verifiedPhone)) {
            updateData.phoneVerified = false;
            isPhoneVerified = false;
            verifiedPhone = '';
        }
        await updateDoc(doc(db, "users", currentUser.uid), updateData);
        updatePhoneBadgeUI(phone);
        updateVerificationOverviewUI(currentUser.email, phone, isPhoneVerified);
        btn.textContent = 'Saved ✓';
        setTimeout(() => { btn.textContent = 'Save Profile'; btn.disabled = false; }, 1500);
    } catch (error) {
        alert("Failed to save profile: " + error.message);
        btn.textContent = 'Save Profile';
        btn.disabled = false;
    }
});

// ==========================================
// DANGER ZONE: ACCOUNT DEACTIVATION & DELETION
// ==========================================
const modalDeactivate = document.getElementById('modal-deactivate-account');
const modalDelete = document.getElementById('modal-delete-account');

const closeDeactivateModal = () => {
    if (modalDeactivate) {
        modalDeactivate.classList.remove('active');
        modalDeactivate.classList.add('hidden');
    }
};

const closeDeleteModal = () => {
    if (modalDelete) {
        modalDelete.classList.remove('active');
        modalDelete.classList.add('hidden');
    }
    const deleteInput = document.getElementById('delete-confirmation-input');
    const deleteCheck = document.getElementById('delete-confirm-checkbox');
    const deleteBtn = document.getElementById('btn-confirm-delete');
    const deletePass = document.getElementById('delete-account-password');
    if (deleteInput) deleteInput.value = '';
    if (deleteCheck) deleteCheck.checked = false;
    if (deletePass) deletePass.value = '';
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.style.opacity = '0.5';
        deleteBtn.style.cursor = 'not-allowed';
    }
};

// Check if user has active escrows
async function checkActiveEscrows() {
    const user = currentUser || auth.currentUser;
    if (!user) return { hasActive: false, count: 0 };
    let count = 0;
    try {
        const terminalStatuses = ['completed', 'released', 'cancelled', 'canceled', 'refunded', 'rejected'];
        
        // Check seller escrows
        const sellerQ = query(collection(db, "escrows"), where("sellerId", "==", user.uid));
        const sellerSnap = await getDocs(sellerQ);
        sellerSnap.forEach(d => {
            const st = (d.data().status || '').toLowerCase().trim();
            if (!terminalStatuses.includes(st)) count++;
        });

        // Check buyer escrows
        if (user.email) {
            const buyerQ = query(collection(db, "escrows"), where("buyerEmail", "==", user.email));
            const buyerSnap = await getDocs(buyerQ);
            buyerSnap.forEach(d => {
                const st = (d.data().status || '').toLowerCase().trim();
                if (!terminalStatuses.includes(st)) count++;
            });
        }
    } catch (err) {
        console.warn("Error checking active escrows:", err);
    }
    return { hasActive: count > 0, count };
}

// Open Deactivate Modal
const openDeactivateModal = () => {
    const user = currentUser || auth.currentUser;
    if (!user) {
        showModernToast("Authentication Required", "Please sign in to manage account settings.", "warning");
        return;
    }

    if (modalDeactivate) {
        modalDeactivate.classList.remove('hidden');
        modalDeactivate.classList.add('active');
        if (typeof gsap !== 'undefined') {
            gsap.fromTo('#modal-deactivate-account .modal-content', 
                { scale: 0.95, y: 20, opacity: 0 }, 
                { scale: 1, y: 0, opacity: 1, duration: 0.3, ease: 'power2.out' }
            );
        }
    }

    // Check active escrows asynchronously without blocking modal opening
    checkActiveEscrows().then(({ hasActive, count }) => {
        const warningBox = document.getElementById('deactivate-escrow-warning');
        if (warningBox) {
            if (hasActive) {
                warningBox.innerHTML = `<strong>Active Orders (${count}):</strong> You have active or in-progress transactions. Please ensure all ongoing escrows are settled before deactivating.`;
                warningBox.style.display = 'block';
            } else {
                warningBox.style.display = 'none';
            }
        }
    }).catch(err => console.warn("Active escrows check failed:", err));
};

// Open Delete Modal
const openDeleteModal = () => {
    const user = currentUser || auth.currentUser;
    if (!user) {
        showModernToast("Authentication Required", "Please sign in to manage account settings.", "warning");
        return;
    }

    // Check if user has password provider (show password input)
    const passwordGroup = document.getElementById('delete-password-group');
    const isPasswordUser = user.providerData && user.providerData.some(p => p.providerId === 'password');
    if (passwordGroup) {
        passwordGroup.style.display = isPasswordUser ? 'block' : 'none';
    }

    // Reset delete inputs
    const deleteInput = document.getElementById('delete-confirmation-input');
    const deleteCheck = document.getElementById('delete-confirm-checkbox');
    const deleteBtn = document.getElementById('btn-confirm-delete');
    const deletePass = document.getElementById('delete-account-password');
    if (deleteInput) deleteInput.value = '';
    if (deleteCheck) deleteCheck.checked = false;
    if (deletePass) deletePass.value = '';
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.style.opacity = '0.5';
        deleteBtn.style.cursor = 'not-allowed';
    }

    if (modalDelete) {
        modalDelete.classList.remove('hidden');
        modalDelete.classList.add('active');
        if (typeof gsap !== 'undefined') {
            gsap.fromTo('#modal-delete-account .modal-content', 
                { scale: 0.95, y: 20, opacity: 0 }, 
                { scale: 1, y: 0, opacity: 1, duration: 0.3, ease: 'power2.out' }
            );
        }
    }

    // Check active escrows / balance asynchronously
    checkActiveEscrows().then(({ hasActive, count }) => {
        const activeAlert = document.getElementById('delete-active-orders-alert');
        if (activeAlert) {
            if (hasActive || currentBalance > 0) {
                let msg = '<strong>Active Records Detected:</strong> ';
                if (hasActive && currentBalance > 0) {
                    msg += `You have ${count} active escrow order(s) and a wallet balance of GH₵ ${currentBalance.toFixed(2)}. We recommend completing orders and withdrawing your funds before deleting.`;
                } else if (hasActive) {
                    msg += `You have ${count} active escrow order(s). We recommend completing ongoing orders first.`;
                } else {
                    msg += `You have a remaining wallet balance of GH₵ ${currentBalance.toFixed(2)}. Please withdraw your funds first.`;
                }
                activeAlert.innerHTML = msg;
                activeAlert.style.display = 'block';
            } else {
                activeAlert.style.display = 'none';
            }
        }
    }).catch(err => console.warn("Active escrows check failed:", err));
};

// Bind direct clicks & document delegation for maximum reliability
document.querySelectorAll('.btn-trigger-deactivate').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        openDeactivateModal();
    });
});

document.querySelectorAll('.btn-trigger-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        openDeleteModal();
    });
});

// Delegated listener to catch any dynamically rendered or nested buttons
document.addEventListener('click', (e) => {
    const deactTrigger = e.target.closest('.btn-trigger-deactivate');
    if (deactTrigger) {
        e.preventDefault();
        openDeactivateModal();
        return;
    }
    const delTrigger = e.target.closest('.btn-trigger-delete');
    if (delTrigger) {
        e.preventDefault();
        openDeleteModal();
        return;
    }
});

// Modal close button listeners
document.getElementById('close-deactivate-modal')?.addEventListener('click', closeDeactivateModal);
document.getElementById('btn-cancel-deactivate')?.addEventListener('click', closeDeactivateModal);
modalDeactivate?.addEventListener('click', (e) => {
    if (e.target === modalDeactivate) closeDeactivateModal();
});

document.getElementById('close-delete-modal')?.addEventListener('click', closeDeleteModal);
document.getElementById('btn-cancel-delete')?.addEventListener('click', closeDeleteModal);
modalDelete?.addEventListener('click', (e) => {
    if (e.target === modalDelete) closeDeleteModal();
});

// Keyboard Escape listener
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (modalDeactivate && modalDeactivate.classList.contains('active')) closeDeactivateModal();
        if (modalDelete && modalDelete.classList.contains('active')) closeDeleteModal();
    }
});

// Delete confirmation input & checkbox validation
function validateDeleteForm() {
    const deleteInput = document.getElementById('delete-confirmation-input');
    const deleteCheck = document.getElementById('delete-confirm-checkbox');
    const deleteBtn = document.getElementById('btn-confirm-delete');
    if (!deleteBtn) return;

    const isMatch = deleteInput && deleteInput.value.trim().toUpperCase() === 'DELETE';
    const isChecked = deleteCheck && deleteCheck.checked;

    if (isMatch && isChecked) {
        deleteBtn.disabled = false;
        deleteBtn.style.opacity = '1';
        deleteBtn.style.cursor = 'pointer';
    } else {
        deleteBtn.disabled = true;
        deleteBtn.style.opacity = '0.5';
        deleteBtn.style.cursor = 'not-allowed';
    }
}

document.getElementById('delete-confirmation-input')?.addEventListener('input', validateDeleteForm);
document.getElementById('delete-confirm-checkbox')?.addEventListener('change', validateDeleteForm);

// Confirm Deactivate Action
document.getElementById('btn-confirm-deactivate')?.addEventListener('click', async () => {
    const user = currentUser || auth.currentUser;
    if (!user) {
        showModernToast("Authentication Required", "Please sign in.", "warning");
        return;
    }
    const btn = document.getElementById('btn-confirm-deactivate');
    const reasonSelect = document.getElementById('deactivate-reason');
    const reason = reasonSelect ? reasonSelect.value : '';

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Deactivating...';
    }

    try {
        await updateDoc(doc(db, "users", user.uid), {
            accountStatus: "deactivated",
            isDeactivated: true,
            deactivatedAt: serverTimestamp(),
            deactivationReason: reason || "User opted to deactivate"
        });

        showModernToast("Account Deactivated", "Your account has been deactivated. You can sign back in anytime to reactivate.", "info");
        closeDeactivateModal();

        setTimeout(async () => {
            clearUserSession();
            try { await signOut(auth); } catch (_) {}
            window.location.href = "login.html?deactivated=true";
        }, 1200);
    } catch (err) {
        console.error("Deactivation error:", err);
        showModernToast("Deactivation Failed", err.message || "Failed to deactivate account.", "error");
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Confirm Deactivation';
        }
    }
});

// Confirm Permanent Deletion Action
document.getElementById('btn-confirm-delete')?.addEventListener('click', async () => {
    const user = currentUser || auth.currentUser;
    if (!user) {
        showModernToast("Authentication Required", "Please sign in.", "warning");
        return;
    }
    const btn = document.getElementById('btn-confirm-delete');
    const passwordInput = document.getElementById('delete-account-password');
    const passwordGroup = document.getElementById('delete-password-group');
    const isPasswordUser = user.providerData && user.providerData.some(p => p.providerId === 'password');

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Deleting Account...';
    }

    try {
        // Re-authenticate if password user and password entered
        if (isPasswordUser && passwordGroup && passwordGroup.style.display !== 'none') {
            const pwd = passwordInput ? passwordInput.value.trim() : '';
            if (pwd && user.email) {
                const cred = EmailAuthProvider.credential(user.email, pwd);
                await reauthenticateWithCredential(user, cred);
            }
        }

        const userUid = user.uid;

        // Clean up / mark user products in Firestore
        try {
            const productsQ = query(collection(db, "products"), where("sellerId", "==", userUid));
            const productsSnap = await getDocs(productsQ);
            if (!productsSnap.empty) {
                const batch = writeBatch(db);
                productsSnap.forEach(pDoc => {
                    batch.delete(doc(db, "products", pDoc.id));
                });
                await batch.commit();
            }
        } catch (prodErr) {
            console.warn("Could not batch delete user products:", prodErr);
        }

        // Delete user document in Firestore
        try {
            await deleteDoc(doc(db, "users", userUid));
        } catch (uDocErr) {
            console.warn("Could not delete user doc, marking deleted:", uDocErr);
            try {
                await updateDoc(doc(db, "users", userUid), {
                    accountStatus: "deleted",
                    isDeleted: true,
                    deletedAt: serverTimestamp()
                });
            } catch (updErr) {
                console.warn("Could not update user doc:", updErr);
            }
        }

        // Delete Firebase Auth User
        try {
            await deleteUser(user);
        } catch (authErr) {
            if (authErr.code === 'auth/requires-recent-login') {
                if (isPasswordUser && (!passwordInput || !passwordInput.value.trim())) {
                    if (passwordGroup) passwordGroup.style.display = 'block';
                    passwordInput?.focus();
                    throw new Error("Please enter your current password above to re-authenticate and confirm account deletion.");
                }
                throw authErr;
            }
            console.warn("deleteUser warning:", authErr);
        }

        showModernToast("Account Deleted", "Your account has been permanently removed.", "success");
        closeDeleteModal();

        setTimeout(async () => {
            clearUserSession();
            try { await signOut(auth); } catch (_) {}
            window.location.href = "login.html?deleted=true";
        }, 1200);
    } catch (err) {
        console.error("Account deletion error:", err);
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Permanently Delete Account';
        }

        if (err.code === 'auth/requires-recent-login') {
            showModernToast("Security Verification Required", "For security reasons, please sign out, log back in, and try deleting your account again.", "warning");
        } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
            showModernToast("Invalid Password", "The password you entered is incorrect. Please verify and try again.", "error");
        } else {
            showModernToast("Deletion Failed", err.message || "Failed to delete account.", "error");
        }
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
        const originalText = submitBtn ? submitBtn.textContent : 'Request Withdrawal';
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';

        try {
            // Lock the funds immediately
            await updateDoc(doc(db, "users", currentUser.uid), {
                walletBalance: currentBalance - amount
            });

            // Auto-process payout directly
            try {
                // Generate internal tx ID
                const internalTxId = 'WD-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
                
                const processPayoutFn = callApi('processPayout');
                const payoutRes = await processPayoutFn({
                    amount: amount,
                    bankCode: network,
                    accountNumber: phone,
                    transactionId: internalTxId
                });
                
                if (!payoutRes || !payoutRes.data || !payoutRes.data.success) {
                    throw new Error(payoutRes?.data?.message || "Payout failed via API");
                }
                
                // Only create transaction log on success (transactions are immutable)
                await addDoc(collection(db, "transactions"), {
                    userId: currentUser.uid,
                    type: 'withdrawal',
                    amount: amount,
                    fee: 0,
                    status: 'completed',
                    description: `Withdrawal to ${phone}`,
                    momoNumber: phone,
                    network: network,
                    createdAt: serverTimestamp(),
                    processedAt: serverTimestamp(),
                    processedBy: 'auto',
                    reference: internalTxId
                });
                
                // Try sending SMS for automated withdrawal success
                try {
                    await sendEscrowStatusSMS(phone, `TrustLink: Your automated withdrawal of GH₵ ${amount.toFixed(2)} has been sent to your mobile money wallet.`, `${internalTxId}-payout`);
                } catch(smsErr) { console.warn("Withdrawal SMS failed", smsErr); }

                showModernToast("Withdrawal Successful", "Your funds have been instantly sent to your mobile money wallet.", "success");
                withdrawForm.reset();
                closeWithdrawModal();
            } catch (payoutError) {
                // Refund the balance
                const userSnap = await getDoc(doc(db, "users", currentUser.uid));
                if (userSnap.exists()) {
                    const latestBal = parseFloat(userSnap.data().walletBalance || 0);
                    await updateDoc(doc(db, "users", currentUser.uid), {
                        walletBalance: latestBal + amount
                    });
                }
                
                // Log failed withdrawal directly
                await addDoc(collection(db, "transactions"), {
                    userId: currentUser.uid,
                    type: 'withdrawal',
                    amount: amount,
                    fee: 0,
                    status: 'failed',
                    description: `Failed withdrawal to ${phone}`,
                    momoNumber: phone,
                    network: network,
                    error: payoutError.message,
                    createdAt: serverTimestamp(),
                    processedAt: serverTimestamp(),
                    processedBy: 'auto'
                });

                showModernToast("Withdrawal Failed", `Payout failed: ${payoutError.message}. Funds refunded to wallet.`, "error");
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
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
        clearUserSession();
        await signOut(auth);
        sessionStorage.setItem("authToast", "Logged out successfully");
        sessionStorage.setItem("authToastType", "info");
        window.location.href = "login.html";
    } catch (error) {
        console.error("Sign out error", error);
    }
});

const topSignoutBtn = document.getElementById('btn-signout-top');
if (topSignoutBtn) {
    topSignoutBtn.addEventListener('click', async () => {
        try {
            clearUserSession();
            await signOut(auth);
            sessionStorage.setItem("authToast", "Logged out successfully");
            sessionStorage.setItem("authToastType", "info");
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
const btnWalletInitiateOrder = document.getElementById('btn-wallet-initiate-order');
if (btnWalletInitiateOrder) {
    btnWalletInitiateOrder.addEventListener('click', openModal);
}

// Delegated listener for all Initiate Order triggers
document.addEventListener('click', (e) => {
    const trigger = e.target.closest('#btn-new-escrow-trigger, #btn-wallet-initiate-order, [data-action="initiate-order"]');
    if (trigger && trigger !== btnNewEscrow && trigger !== btnWalletInitiateOrder) {
        e.preventDefault();
        openModal();
    }
});
if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
if (btnCancelEscrow) btnCancelEscrow.addEventListener('click', closeModal);
if (formNewEscrow) {
    formNewEscrow.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitBtn = formNewEscrow.querySelector('button[type="submit"]');
        const originalText = submitBtn ? submitBtn.textContent : 'Create Escrow';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Creating Escrow...';
        }
        
        try {
            // Get the total amount calculated in the UI
            const amountInput = document.getElementById('escrow-amount');
            const totalAmount = amountInput ? parseFloat(amountInput.value) : 0;
            
            if (totalAmount <= 0) {
                throw new Error("Total escrow amount must be greater than 0");
            }

            const description = document.getElementById('escrow-terms') ? document.getElementById('escrow-terms').value.trim() : "TrustLink Escrow Deposit";
            const buyerEmail = document.getElementById('buyer-email') ? document.getElementById('buyer-email').value.trim() : "";
            const buyerPhoneInput = document.getElementById('buyer-phone');
            const buyerPhone = buyerPhoneInput ? buyerPhoneInput.value.trim() : "";

            const feeAllocation = document.getElementById('escrow-fee-allocation') ? document.getElementById('escrow-fee-allocation').value : 'split';
            const deliveryDateFrom = document.getElementById('escrow-delivery-date-from') ? document.getElementById('escrow-delivery-date-from').value : "";
            const deliveryDateTo = document.getElementById('escrow-delivery-date-to') ? document.getElementById('escrow-delivery-date-to').value : "";

            if (deliveryDateFrom && deliveryDateTo && deliveryDateTo < deliveryDateFrom) {
                throw new Error("Latest delivery date cannot be before the earliest date.");
            }

            // 1. SAVE TO FIREBASE INSTANTLY
            const newEscrow = {
                amount: totalAmount,
                description: description,
                sellerId: currentUser ? currentUser.uid : "GUEST",
                sellerName: currentUser && currentUser.displayName ? currentUser.displayName : "TrustLink User",
                buyerEmail: buyerEmail,
                buyerPhone: buyerPhone,
                feeAllocation: feeAllocation,
                feePercent: cachedPlatformFeePercent || 1.5,
                deliveryDateFrom: deliveryDateFrom,
                deliveryDateTo: deliveryDateTo,
                deliveryReminderSent: false,
                status: 'PENDING_PAYMENT',
                createdAt: serverTimestamp()
            };
            
            const docRef = await addDoc(collection(db, "escrows"), newEscrow);
            const escrowId = docRef.id;

            // Record immutable financial audit trail
            try {
                await addDoc(collection(db, "audit_logs"), {
                    event: 'ESCROW_CREATED',
                    escrowId: escrowId,
                    sellerId: currentUser ? currentUser.uid : "GUEST",
                    amount: totalAmount,
                    status: 'PENDING_PAYMENT',
                    actor: 'seller',
                    timestamp: serverTimestamp(),
                    userAgent: navigator.userAgent
                });
            } catch (auditErr) {
                console.warn("Audit logging notice:", auditErr);
            }
            
            // 2. Prepare checkout URL & Copy Link Immediately
            const checkoutUrl = `${window.location.origin}/checkout.html?id=${escrowId}`;
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(checkoutUrl);
                }
            } catch(e) { 
                console.warn("Clipboard write failed silently."); 
            }

            // 3. Immediately Close Modal & Reset Form for instant responsiveness
            closeModal();
            formNewEscrow.reset();

            // 4. Show Instant Success Feedback
            if (typeof showModernToast === 'function') {
                showModernToast("Escrow Created!", "Checkout link copied to clipboard.", "success");
            }

            // 5. Send SMS Notification Asynchronously in Background (Non-Blocking)
            if (buyerPhone) {
                const smsDetails = {
                    description: description,
                    amount: totalAmount,
                    sellerName: newEscrow.sellerName
                };
                sendSMSNotification(buyerPhone, checkoutUrl, escrowId, "", smsDetails)
                    .catch((smsError) => {
                        console.warn("Background SMS notification notice:", smsError);
                    });
            }
        } catch (error) {
            console.error("Escrow creation error:", error);
            if (typeof showModernToast === 'function') {
                showModernToast("Escrow Creation Failed", error.message || "Failed to initialize order.", "error");
            } else {
                alert(error.message || "Failed to initialize order.");
            }
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        }
    });
}

// ==========================================
// SELLER PRODUCTS LOGIC (FIRESTORE)
// ==========================================
let myProducts = [];

// Lightweight browser downscaling for instant uploads and crisp thumbnails (approx 20-35KB per image)
const fileToCompressedDataURL = (file, maxDim = 380, quality = 0.7) => new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { 
        URL.revokeObjectURL(url); 
        reject(new Error("Could not read that image file.")); 
    };
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
        let dataUrl = await fileToCompressedDataURL(file, 380, 0.7);
        newProductImage = dataUrl;
        if (preview) {
            preview.src = dataUrl;
            preview.classList.remove('hidden');
        }
    } catch (err) {
        if (typeof showModernToast === 'function') {
            showModernToast("Image Error", err.message || "Could not process that image.", "warning");
        } else {
            alert(err.message || "Could not process that image.");
        }
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

// Helper to strip any emojis from toast text
function stripEmojis(text) {
    if (!text) return '';
    return String(text)
        .replace(/\p{Extended_Pictographic}/gu, '')
        .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2300}-\u{23FF}\u{2B50}\u{200D}\u{FE0F}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Modern Toast Notification
window.showModernToast = function(title, message, type = "success") {
    if (message === "success" || message === "warning" || message === "error" || message === "info") {
        type = message;
        message = "";
    }

    title = stripEmojis(title);
    message = stripEmojis(message);

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
        iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 24px; height: 24px; color: #10B981;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
    } else if (type === "info") {
        iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 24px; height: 24px; color: #3B82F6;"><path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>`;
    } else if (type === "warning") {
        iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 24px; height: 24px; color: #F59E0B;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>`;
    } else if (type === "error") {
        iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 24px; height: 24px; color: #EF4444;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>`;
    }

    const messageHtml = message ? `<p>${escapeHtml(message)}</p>` : '';

    toast.innerHTML = `
        <div class="modern-toast-icon">${iconSvg}</div>
        <div class="modern-toast-content">
            <h4>${escapeHtml(title)}</h4>
            ${messageHtml}
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
    }, 5000);
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
            if (typeof showModernToast === 'function') {
                showModernToast("Login Required", "You must be logged in to add products.", "warning");
            } else {
                alert('You must be logged in to add products.');
            }
            return;
        }
        
        const btnSubmit = formNewProd.querySelector('button[type="submit"]');
        const originalBtnText = btnSubmit ? btnSubmit.textContent : 'Add';
        if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.textContent = 'Saving...';
        }
        
        try {
            const nameInput = document.getElementById('new-prod-name');
            const priceInput = document.getElementById('new-prod-price');
            const descInput = document.getElementById('new-prod-desc');

            const name = nameInput ? nameInput.value.trim() : "";
            const price = priceInput ? parseFloat(priceInput.value) : 0;
            const desc = descInput ? descInput.value.trim() : "";

            if (!name) throw new Error("Product name is required.");
            if (isNaN(price) || price <= 0) throw new Error("Please enter a valid product price.");

            const newProd = {
                name: name,
                price: price,
                desc: desc,
                image: newProductImage || "",
                userId: currentUser.uid,
                createdAt: serverTimestamp()
            };

            // 1. Instantly save to Firestore
            const docRef = await addDoc(collection(db, "products"), newProd);

            // 2. Optimistic instant local update
            const productWithId = {
                id: docRef.id,
                ...newProd,
                createdAt: new Date()
            };
            myProducts.unshift(productWithId);
            renderProducts();

            // 3. Reset form and switch view immediately
            formNewProd.reset();
            newProductImage = "";
            document.getElementById('new-prod-preview')?.classList.add('hidden');
            
            closeProdModal();
            window.showProductSubView('list');
            
            if (typeof showModernToast === 'function') {
                showModernToast("Product Added!", `"${name}" was added successfully.`, "success");
            }

            // 4. Background re-sync
            fetchProducts();
        } catch (error) {
            console.error("Error adding product: ", error);
            if (typeof showModernToast === 'function') {
                showModernToast("Failed to Add Product", error.message || "Please try again.", "error");
            } else {
                alert("Error adding product: " + (error.message || ""));
            }
        } finally {
            if (btnSubmit) {
                btnSubmit.disabled = false;
                btnSubmit.textContent = originalBtnText;
            }
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

// Telegram Command Builder Interactive Helpers
window.updateTgPreviewCommand = function() {
    const priceInput = document.getElementById('tg-gen-price');
    const itemInput = document.getElementById('tg-gen-item');
    const phoneInput = document.getElementById('tg-gen-phone');
    const previewEl = document.getElementById('tg-command-preview');
    const directBtn = document.getElementById('tg-direct-send-btn');
    
    if (!previewEl) return;
    
    const price = priceInput && priceInput.value.trim() ? priceInput.value.trim() : '450';
    const item = itemInput && itemInput.value.trim() ? itemInput.value.trim() : 'Nike Air Max';
    const phone = phoneInput && phoneInput.value.trim() ? phoneInput.value.trim() : '0244123456';
    
    const cmd = `/create ${price} ${item} ${phone}`;
    previewEl.textContent = cmd;
    
    if (directBtn) {
        directBtn.href = `https://t.me/TrustlinkghBot`;
    }
};

window.copyTgCommand = function() {
    const previewEl = document.getElementById('tg-command-preview');
    if (!previewEl) return;
    navigator.clipboard.writeText(previewEl.textContent.trim()).then(() => {
        if (typeof showModernToast === 'function') {
            showModernToast('Telegram command copied to clipboard!', 'success');
        } else {
            alert('Copied to clipboard!');
        }
    });
};

// WhatsApp Command Builder Interactive Helpers
window.updateWaPreviewCommand = function() {
    const priceInput = document.getElementById('wa-gen-price');
    const itemInput = document.getElementById('wa-gen-item');
    const phoneInput = document.getElementById('wa-gen-phone');
    const previewEl = document.getElementById('wa-command-preview');
    const directBtn = document.getElementById('wa-direct-send-btn');
    
    if (!previewEl) return;
    
    const price = priceInput && priceInput.value.trim() ? priceInput.value.trim() : '450';
    const item = itemInput && itemInput.value.trim() ? itemInput.value.trim() : 'Nike Air Max';
    const phone = phoneInput && phoneInput.value.trim() ? phoneInput.value.trim() : '0244123456';
    
    const cmd = `CREATE ${price} ${item} ${phone}`;
    previewEl.textContent = cmd;
    
    if (directBtn) {
        directBtn.href = `https://wa.me/16624904332?text=${encodeURIComponent(cmd)}`;
    }
};

window.copyWaCommand = function() {
    const previewEl = document.getElementById('wa-command-preview');
    if (!previewEl) return;
    navigator.clipboard.writeText(previewEl.textContent.trim()).then(() => {
        if (typeof showModernToast === 'function') {
            showModernToast('Command copied to clipboard!', 'success');
        } else {
            alert('Copied to clipboard!');
        }
    });
};

// WhatsApp Assistant Coming Soon Prompt & Modal
window.showWhatsAppComingSoonPrompt = function() {
    const modal = document.getElementById('modal-whatsapp-coming-soon');
    if (modal) {
        modal.classList.remove('hidden');
    }
    if (typeof showModernToast === 'function') {
        showModernToast('WhatsApp Bot Coming Soon', 'WhatsApp Assistant is coming soon while we take time to build it. Please use Telegram Bot @trustlinkescrow_bot in the meantime!', 'info');
    }
};

window.closeWhatsAppComingSoonModal = function() {
    const modal = document.getElementById('modal-whatsapp-coming-soon');
    if (modal) {
        modal.classList.add('hidden');
    }
};

const closeWaModalBtn = document.getElementById('close-wa-coming-soon-modal');
const btnCloseWaPrompt = document.getElementById('btn-close-wa-prompt');
const modalWaComingSoon = document.getElementById('modal-whatsapp-coming-soon');

if (closeWaModalBtn) {
    closeWaModalBtn.addEventListener('click', window.closeWhatsAppComingSoonModal);
}
if (btnCloseWaPrompt) {
    btnCloseWaPrompt.addEventListener('click', window.closeWhatsAppComingSoonModal);
}
if (modalWaComingSoon) {
    modalWaComingSoon.addEventListener('click', (e) => {
        if (e.target === modalWaComingSoon) {
            window.closeWhatsAppComingSoonModal();
        }
    });
}

// Notify Buyer Modal Interactions (SMS & WhatsApp)
const notifyBuyerForm = document.getElementById('notify-buyer-form');
const closeNotifyModalBtn = document.getElementById('close-notify-modal');
const btnNotifyWhatsAppModal = document.getElementById('btn-notify-whatsapp-modal');

if (closeNotifyModalBtn) {
    closeNotifyModalBtn.addEventListener('click', () => {
        window.closeNotifyModal();
    });
}

if (notifyBuyerForm) {
    notifyBuyerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const escrowId = document.getElementById('notify-escrow-id').value;
        const phone = document.getElementById('notify-buyer-phone').value.trim();
        const btn = document.getElementById('btn-send-notify-sms');
        const origHtml = btn ? btn.innerHTML : '';

        const cleanDigits = phone.replace(/[^0-9]/g, '');
        if (cleanDigits.length < 9) {
            if (typeof showModernToast === 'function') {
                showModernToast("Invalid Phone", "Please enter a valid Ghana phone number (e.g. 0244123456).", "warning");
            } else {
                alert("Please enter a valid Ghana phone number.");
            }
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Sending SMS...';
        }

        try {
            await updateDoc(doc(db, "escrows", escrowId), { buyerPhone: phone });
            let escrow = allLoadedSellerEscrows.find(e => e.id === escrowId);
            if (escrow) escrow.buyerPhone = phone;

            const checkoutUrl = `${window.location.origin}/checkout.html?id=${escrowId}`;
            const smsDetails = {
                description: escrow ? (escrow.description || escrow.productName) : "Order #" + escrowId.substring(0, 8),
                amount: escrow ? (escrow.amount || escrow.totalAmount) : 0,
                sellerName: escrow ? escrow.sellerName : (currentUser && currentUser.displayName ? currentUser.displayName : "TrustLink Seller")
            };

            await sendSMSNotification(phone, checkoutUrl, escrowId, "", smsDetails);
            if (typeof showModernToast === 'function') {
                showModernToast("SMS Sent!", `Payment link successfully sent to ${phone}.`, "success");
            }
            window.closeNotifyModal();
        } catch (err) {
            console.error("SMS notification modal error:", err);
            if (typeof showModernToast === 'function') {
                showModernToast("Notification Failed", err.message || "Failed to send SMS.", "error");
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = origHtml;
            }
        }
    });
}

if (btnNotifyWhatsAppModal) {
    btnNotifyWhatsAppModal.addEventListener('click', async () => {
        const escrowId = document.getElementById('notify-escrow-id').value;
        const phone = document.getElementById('notify-buyer-phone').value.trim();
        let escrow = allLoadedSellerEscrows.find(e => e.id === escrowId);

        if (phone && phone.replace(/[^0-9]/g, '').length >= 9) {
            try {
                await updateDoc(doc(db, "escrows", escrowId), { buyerPhone: phone });
                if (escrow) escrow.buyerPhone = phone;
            } catch (e) {
                console.warn("Could not save phone to escrow:", e);
            }
        }
        window.closeNotifyModal();
        window.shareEscrowViaWhatsApp(escrowId);
    });
}


