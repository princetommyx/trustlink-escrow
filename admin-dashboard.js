import { auth, db, firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { onAuthStateChanged, signOut, getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs, query, where, getCountFromServer, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { sendEscrowStatusSMS, pickUserPhone, executeMoolrePayout, computeFeeSplit } from "./moolre-service.js";

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
    // Fade in sidebar items
    gsap.from('.nav-item', { opacity: 0, x: -20, duration: 0.5, stagger: 0.05, ease: 'power2.out' });
    // Animate stats cards
    gsap.from('.stat-card-modern', { opacity: 0, y: 30, duration: 0.8, stagger: 0.1, ease: 'power3.out', delay: 0.2 });
    // Animate portals
    gsap.from('.portal-card', { opacity: 0, y: 20, duration: 0.8, ease: 'power3.out', delay: 0.4 });
}

// Authentication Protection
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "admin-login.html";
        return;
    }

    // Check if Admin
    let isAdmin = false;
    if (user.email === 'admin@trustlink.com' || user.email === 'test@trustlink.com') {
        isAdmin = true;
    } else {
        try {
            const docSnap = await getDoc(doc(db, "users", user.uid));
            if (docSnap.exists() && docSnap.data().role === 'admin') {
                isAdmin = true;
            }
        } catch(e) { }
    }

    if (!isAdmin) {
        // Not an admin, kick out to normal dashboard
        window.location.href = "dashboard.html";
        return;
    }

    // Set Admin Name + populate profile form
    try {
        const docSnap = await getDoc(doc(db, "users", user.uid));
        const data = docSnap.exists() ? docSnap.data() : {};
        if (data.fullName) {
            document.getElementById('user-name').textContent = data.fullName;
        } else {
            document.getElementById('user-name').textContent = 'Admin (' + user.email.split('@')[0] + ')';
        }
        const pName = document.getElementById('admin-profile-name');
        const pEmail = document.getElementById('admin-profile-email');
        const pPhone = document.getElementById('admin-profile-phone');
        if (pName) pName.value = data.fullName || '';
        if (pEmail) pEmail.value = data.email || user.email || '';
        if (pPhone) pPhone.value = data.phone || pickUserPhone(data) || '';
    } catch(e) {
        document.getElementById('user-name').textContent = 'Admin (' + user.email.split('@')[0] + ')';
    }

    // Now that we are verified as an admin, fetch the dashboard data
    fetchAdminStats();
    await loadUsersList();
    loadDisputes();
    loadEscrowsAdmin();
    loadPayoutsAdmin();
    loadPlatformSettings();
});

document.getElementById('btn-save-admin-profile')?.addEventListener('click', async () => {
    if (!auth.currentUser) return;
    const btn = document.getElementById('btn-save-admin-profile');
    const name = document.getElementById('admin-profile-name').value.trim();
    const phone = document.getElementById('admin-profile-phone').value.trim();

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
        await updateDoc(doc(db, "users", auth.currentUser.uid), { fullName: name, phone: phone });
        document.getElementById('user-name').textContent = name;
        btn.textContent = 'Saved ✓';
        setTimeout(() => { btn.textContent = 'Save Profile'; btn.disabled = false; }, 1500);
    } catch (error) {
        alert("Failed to save profile: " + error.message);
        btn.textContent = 'Save Profile';
        btn.disabled = false;
    }
});

document.getElementById('btn-signout').addEventListener('click', async () => {
    try {
        await signOut(auth);
        sessionStorage.setItem("authToast", "Logged out successfully");
        window.location.href = "admin-login.html";
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
            window.location.href = "admin-login.html";
        } catch (error) {
            console.error("Sign out error", error);
        }
    });
}

// -------------------------------------------------------------
// Shared helpers
// -------------------------------------------------------------
const escapeHtml = (str) => String(str ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Firestore Timestamps, JS Dates and ISO strings all appear in the data
const toDate = (v) => {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate();
    if (v instanceof Date) return v;
    const d = new Date(v);
    return isNaN(d) ? null : d;
};

const normStatus = (s) => String(s || '').toLowerCase();

const formatGHS = (amount) => {
    return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', minimumFractionDigits: 0 }).format(amount);
};

// -------------------------------------------------------------
// Chart.js Implementations (driven by real Firestore activity)
// -------------------------------------------------------------
// Each record: { date, inAmt, outAmt, plus, minus }
let activityRecords = [];
let dwChart = null;
let txChart = null;

const buildDailyBuckets = (days) => {
    const labels = [];
    const keys = [];
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(start);
        d.setDate(d.getDate() - i);
        keys.push(d.toDateString());
        labels.push(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
    }
    return { labels, keys };
};

const bucketActivity = (days) => {
    const { labels, keys } = buildDailyBuckets(days);
    const index = new Map(keys.map((k, i) => [k, i]));
    const inAmts = new Array(days).fill(0);
    const outAmts = new Array(days).fill(0);
    const plus = new Array(days).fill(0);
    const minus = new Array(days).fill(0);
    activityRecords.forEach(r => {
        if (!r.date) return;
        const i = index.get(r.date.toDateString());
        if (i === undefined) return;
        inAmts[i] += r.inAmt;
        outAmts[i] += r.outAmt;
        plus[i] += r.plus;
        minus[i] += r.minus;
    });
    return { labels, inAmts, outAmts, plus, minus };
};

const chartTooltipOptions = {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    titleColor: '#0f172a',
    bodyColor: '#334155',
    borderColor: 'rgba(0, 0, 0, 0.1)',
    borderWidth: 1,
    padding: 12,
    boxPadding: 6
};
const chartGridColor = 'rgba(0, 0, 0, 0.05)';

const renderDwChart = () => {
    const ctx = document.getElementById('depositWithdrawChart');
    if (!ctx || typeof Chart === 'undefined') return;
    const days = parseInt(document.getElementById('dw-chart-range')?.value || '14', 10);
    const { labels, inAmts, outAmts } = bucketActivity(days);
    if (dwChart) dwChart.destroy();
    dwChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Money In',
                    data: inAmts,
                    backgroundColor: '#10b981', // Emerald green
                    borderRadius: 4,
                    barPercentage: 0.6,
                    categoryPercentage: 0.8
                },
                {
                    label: 'Money Out',
                    data: outAmts,
                    backgroundColor: '#ef4444', // Red
                    borderRadius: 4,
                    barPercentage: 0.6,
                    categoryPercentage: 0.8
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { usePointStyle: true, boxWidth: 8 }
                },
                tooltip: chartTooltipOptions
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: chartGridColor },
                    border: { display: false }
                },
                x: {
                    grid: { display: false },
                    border: { display: false }
                }
            }
        }
    });
};

const renderTxChart = () => {
    const ctx = document.getElementById('transactionsChart');
    if (!ctx || typeof Chart === 'undefined') return;
    const days = parseInt(document.getElementById('tx-chart-range')?.value || '14', 10);
    const { labels, plus, minus } = bucketActivity(days);
    if (txChart) txChart.destroy();
    txChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Plus Transactions',
                    data: plus,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    pointBackgroundColor: '#10b981',
                    pointBorderColor: '#fff',
                    pointHoverBackgroundColor: '#fff',
                    pointHoverBorderColor: '#10b981',
                    pointRadius: 3,
                    pointHoverRadius: 5
                },
                {
                    label: 'Minus Transactions',
                    data: minus,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    pointBackgroundColor: '#ef4444',
                    pointBorderColor: '#fff',
                    pointHoverBackgroundColor: '#fff',
                    pointHoverBorderColor: '#ef4444',
                    pointRadius: 3,
                    pointHoverRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { usePointStyle: true, boxWidth: 8 }
                },
                tooltip: chartTooltipOptions
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: chartGridColor },
                    border: { display: false }
                },
                x: {
                    grid: { display: false },
                    border: { display: false }
                }
            }
        }
    });
};

const initCharts = () => {
    if (typeof Chart !== 'undefined') {
        Chart.defaults.color = '#475569';
        Chart.defaults.font.family = "'Inter', sans-serif";
    }
    renderDwChart();
    renderTxChart();
    document.getElementById('dw-chart-range')?.addEventListener('change', renderDwChart);
    document.getElementById('tx-chart-range')?.addEventListener('change', renderTxChart);
};

// -------------------------------------------------------------
// Commission Wallet State & Helpers
// -------------------------------------------------------------
let allCommissionRecords = [];
let currentCommissionTimeframe = 'all';

const fetchAdminStats = async () => {
    try {
        // Users
        const usersCol = collection(db, 'users');
        const totalUsersSnap = await getCountFromServer(usersCol);
        const totalUsers = totalUsersSnap.data().count;
        document.getElementById('stat-total-users').textContent = totalUsers.toLocaleString();
        const statActive = document.getElementById('stat-active-users');
        if (statActive) statActive.textContent = totalUsers.toLocaleString();

        const unvEmailSnap = await getCountFromServer(query(usersCol, where('emailVerified', '==', false)));
        const statUnvEmail = document.getElementById('stat-email-unverified-users');
        if (statUnvEmail) statUnvEmail.textContent = unvEmailSnap.data().count.toLocaleString();

        const unvMobileSnap = await getCountFromServer(query(usersCol, where('phoneVerified', '==', false)));
        const statUnvMobile = document.getElementById('stat-mobile-unverified-users');
        if (statUnvMobile) statUnvMobile.textContent = unvMobileSnap.data().count.toLocaleString();

        activityRecords = [];
        let recentTxList = [];
        allCommissionRecords = [];
        let totalCommissionAccumulated = 0;
        let realizedCommissionTotal = 0;

        // Escrows
        const escrowDocs = await getDocs(collection(db, 'escrows'));
        let tEscrow = 0, eFunded = 0, cEscrow = 0, dEscrow = 0;

        escrowDocs.forEach(doc => {
            const data = doc.data();
            const amt = parseFloat(data.amount) || 0;
            const status = normStatus(data.status);
            const feePercent = parseFloat(data.feePercent) || 2.5;
            const feeAllocation = data.feeAllocation || 'split';
            const fees = computeFeeSplit(amt, feePercent, feeAllocation);
            const date = toDate(data.createdAt) || new Date();

            tEscrow += amt;
            if (['funded', 'active', 'dispatched', 'in_escrow', 'pending_confirmation'].includes(status)) {
                eFunded += amt;
            } else if (['canceled', 'cancelled'].includes(status)) {
                cEscrow += amt;
            } else if (status === 'disputed') {
                dEscrow += amt;
            }

            // Determine commission status & eligibility
            let commStatus = 'UNFUNDED';
            let isQualifying = false;
            if (['completed', 'released'].includes(status)) {
                commStatus = 'REALIZED';
                isQualifying = true;
                totalCommissionAccumulated += fees.totalFee;
                realizedCommissionTotal += fees.totalFee;
            } else if (['funded', 'active', 'dispatched', 'in_escrow', 'pending_confirmation'].includes(status)) {
                commStatus = 'IN_ESCROW';
                isQualifying = true;
                totalCommissionAccumulated += fees.totalFee;
            } else if (['canceled', 'cancelled', 'refunded'].includes(status)) {
                commStatus = 'REFUNDED';
            }

            if (amt > 0) {
                allCommissionRecords.push({
                    id: doc.id,
                    type: 'escrow',
                    title: data.item || data.description || ('Escrow #' + doc.id.slice(0, 6)),
                    amount: amt,
                    feePercent: feePercent,
                    feeAllocation: feeAllocation,
                    buyerFee: fees.buyerFee,
                    sellerFee: fees.sellerFee,
                    totalFee: fees.totalFee,
                    status: status,
                    commStatus: commStatus,
                    isQualifying: isQualifying,
                    date: date,
                    buyer: data.buyerName || data.buyerEmail || data.buyerPhone || 'Buyer',
                    seller: data.sellerName || data.sellerEmail || data.sellerPhone || 'Seller'
                });
            }

            activityRecords.push({
                date,
                inAmt: ['funded', 'active', 'completed', 'released'].includes(status) ? amt : 0,
                outAmt: ['completed', 'released', 'refunded'].includes(status) ? amt : 0,
                plus: 1,
                minus: ['canceled', 'cancelled', 'refunded', 'disputed'].includes(status) ? 1 : 0
            });
            
            if (amt > 0) {
                recentTxList.push({
                    name: data.item ? `Escrow: ${data.item.slice(0, 16)}` : 'Escrow Order',
                    amount: amt,
                    date: date,
                    isPositive: true
                });
            }
        });

        // Transactions (Deposits/Withdrawals)
        const txDocs = await getDocs(collection(db, 'transactions'));
        let tDep = 0, pDep = 0, rDep = 0, dCharge = 0;
        let tWith = 0, pWith = 0, rWith = 0, wCharge = 0;

        txDocs.forEach(doc => {
            const data = doc.data();
            const amt = parseFloat(data.amount) || 0;
            const fee = parseFloat(data.fee) || 0;
            const status = normStatus(data.status);
            const type = normStatus(data.type);
            const date = toDate(data.createdAt) || new Date();

            if (type === 'deposit') {
                if (status === 'completed') tDep += amt;
                else if (status === 'pending') pDep += amt;
                else if (status === 'rejected') rDep += amt;
                dCharge += fee;
            } else if (type === 'withdrawal') {
                if (status === 'completed') tWith += amt;
                else if (status === 'pending') pWith += amt;
                else if (status === 'rejected') rWith += amt;
                wCharge += fee;
            }

            if (fee > 0 && status === 'completed') {
                totalCommissionAccumulated += fee;
                realizedCommissionTotal += fee;
                allCommissionRecords.push({
                    id: doc.id,
                    type: 'tx_fee',
                    title: (type === 'withdrawal' ? 'Payout' : 'Deposit') + ' Fee (' + (data.reference || doc.id.slice(0, 6)) + ')',
                    amount: amt,
                    feePercent: 0,
                    feeAllocation: 'direct',
                    buyerFee: type === 'deposit' ? fee : 0,
                    sellerFee: type === 'withdrawal' ? fee : 0,
                    totalFee: fee,
                    status: status,
                    commStatus: 'REALIZED',
                    isQualifying: true,
                    date: date,
                    buyer: data.userName || data.userEmail || 'User',
                    seller: 'TrustLink Platform'
                });
            }

            if (status === 'completed') {
                activityRecords.push({
                    date: date,
                    inAmt: type === 'deposit' ? amt : 0,
                    outAmt: type === 'withdrawal' ? amt : 0,
                    plus: type === 'deposit' ? 1 : 0,
                    minus: type === 'withdrawal' ? 1 : 0
                });
            }
            
            if (amt > 0) {
                recentTxList.push({
                    name: type === 'deposit' ? 'Deposit' : 'Withdrawal',
                    amount: amt,
                    date: date,
                    isPositive: type === 'deposit'
                });
            }
        });
        
        // Update Commission Hero & Record Cards
        const heroEl = document.getElementById('stat-total-commission-hero');
        if (heroEl) heroEl.textContent = formatGHS(totalCommissionAccumulated);

        const heroRealizedEl = document.getElementById('stat-realized-commission-hero');
        if (heroRealizedEl) heroRealizedEl.textContent = formatGHS(realizedCommissionTotal);

        const cardCommissionEl = document.getElementById('stat-total-commission-card');
        if (cardCommissionEl) cardCommissionEl.textContent = formatGHS(totalCommissionAccumulated);

        document.getElementById('stat-total-escrowed').textContent = formatGHS(eFunded);
        const statFunded = document.getElementById('stat-escrowed-funded');
        if (statFunded) statFunded.textContent = formatGHS(eFunded);
        const statCanceled = document.getElementById('stat-canceled-escrow');
        if (statCanceled) statCanceled.textContent = formatGHS(cEscrow);
        const statDisputed = document.getElementById('stat-disputed-escrow');
        if (statDisputed) statDisputed.textContent = formatGHS(dEscrow);

        // Sort commission records newest first
        allCommissionRecords.sort((a, b) => b.date - a.date);

        // Render Commission Wallet Section
        renderCommissionWallet();

        // Render Recent Transactions in Sidebar
        recentTxList.sort((a, b) => b.date - a.date);
        const adminTxListEl = document.getElementById('admin-tx-list');
        if (adminTxListEl) {
            adminTxListEl.innerHTML = '';
            const topTxs = recentTxList.slice(0, 5);
            if (topTxs.length === 0) {
                adminTxListEl.innerHTML = '<div style="text-align: center; color: #64748b; padding: 20px;">No transactions yet</div>';
            } else {
                topTxs.forEach(tx => {
                    const iconColor = tx.isPositive ? 'bg-green-light' : 'bg-orange-light';
                    const iconSvg = tx.isPositive 
                        ? '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m0 0l6.75-6.75M12 19.5l-6.75-6.75" /></svg>'
                        : '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19.5v-15m0 0l-6.75 6.75M12 4.5l6.75 6.75" /></svg>';
                    
                    const item = document.createElement('div');
                    item.className = 'tx-item';
                    item.innerHTML = `
                        <div class="tx-icon ${iconColor}">${iconSvg}</div>
                        <div class="tx-info">
                            <span class="tx-name">${escapeHtml(tx.name)}</span>
                            <span class="tx-date">${tx.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                        </div>
                        <div class="tx-amount">${formatGHS(tx.amount)}</div>
                    `;
                    adminTxListEl.appendChild(item);
                });
            }
        }

        const statTotalDep = document.getElementById('stat-total-deposits');
        if (statTotalDep) statTotalDep.textContent = formatGHS(tDep);
        const statPendingDep = document.getElementById('stat-pending-deposits');
        if (statPendingDep) statPendingDep.textContent = formatGHS(pDep);
        const statRejectedDep = document.getElementById('stat-rejected-deposits');
        if (statRejectedDep) statRejectedDep.textContent = formatGHS(rDep);
        const statDepCharges = document.getElementById('stat-deposit-charges');
        if (statDepCharges) statDepCharges.textContent = formatGHS(dCharge);

        const statTotalWith = document.getElementById('stat-total-withdrawals');
        if (statTotalWith) statTotalWith.textContent = formatGHS(tWith);
        const statPendingWith = document.getElementById('stat-pending-withdrawals');
        if (statPendingWith) statPendingWith.textContent = formatGHS(pWith);
        const statRejectedWith = document.getElementById('stat-rejected-withdrawals');
        if (statRejectedWith) statRejectedWith.textContent = formatGHS(rWith);
        const statWithCharges = document.getElementById('stat-withdrawal-charges');
        if (statWithCharges) statWithCharges.textContent = formatGHS(wCharge);

        renderDwChart();
        renderTxChart();
    } catch (error) {
        console.error("Error loading stats:", error);
    }
};

// -------------------------------------------------------------
// Commission Wallet & Revenue Ledger
// -------------------------------------------------------------
const renderCommissionWallet = () => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));

    // Filter by timeframe
    const filtered = allCommissionRecords.filter(r => {
        if (!r.date) return currentCommissionTimeframe === 'all';
        if (currentCommissionTimeframe === 'today') return r.date >= startOfToday;
        if (currentCommissionTimeframe === 'week') return r.date >= sevenDaysAgo;
        if (currentCommissionTimeframe === 'month') return r.date >= thirtyDaysAgo;
        return true;
    });

    let totalComm = 0;
    let realizedComm = 0;
    let pendingComm = 0;
    let gmv = 0;
    let orderCount = 0;
    let buyerFeeTotal = 0;
    let sellerFeeTotal = 0;

    filtered.forEach(r => {
        if (r.isQualifying) {
            totalComm += r.totalFee;
            gmv += r.amount;
            orderCount++;
            buyerFeeTotal += r.buyerFee;
            sellerFeeTotal += r.sellerFee;

            if (r.commStatus === 'REALIZED') {
                realizedComm += r.totalFee;
            } else if (r.commStatus === 'IN_ESCROW') {
                pendingComm += r.totalFee;
            }
        }
    });

    const avgFee = orderCount > 0 ? (totalComm / orderCount) : 0;

    // Update UI Stats
    const elTotal = document.getElementById('comm-stat-total');
    if (elTotal) elTotal.textContent = formatGHS(totalComm);

    const elRealized = document.getElementById('comm-stat-realized');
    if (elRealized) elRealized.textContent = formatGHS(realizedComm);

    const elPending = document.getElementById('comm-stat-pending');
    if (elPending) elPending.textContent = formatGHS(pendingComm);

    const elGmv = document.getElementById('comm-stat-gmv');
    if (elGmv) elGmv.textContent = formatGHS(gmv);

    const elCount = document.getElementById('comm-stat-orders-count');
    if (elCount) elCount.textContent = `${orderCount} fee-earning order${orderCount === 1 ? '' : 's'}`;

    const elBuyerFee = document.getElementById('comm-buyer-fee-total');
    if (elBuyerFee) elBuyerFee.textContent = formatGHS(buyerFeeTotal);

    const elSellerFee = document.getElementById('comm-seller-fee-total');
    if (elSellerFee) elSellerFee.textContent = formatGHS(sellerFeeTotal);

    const elAvgFee = document.getElementById('comm-avg-fee');
    if (elAvgFee) elAvgFee.textContent = formatGHS(avgFee);

    const subTotal = document.getElementById('comm-stat-total-sub');
    if (subTotal) {
        const labels = { all: 'All-time platform revenue', month: 'Last 30 days revenue', week: 'Last 7 days revenue', today: "Today's revenue" };
        subTotal.textContent = labels[currentCommissionTimeframe] || 'Platform revenue';
    }

    renderCommissionLedgerTable(filtered);
};

const renderCommissionLedgerTable = (recordsToRender) => {
    const tbody = document.getElementById('admin-commission-ledger-list');
    if (!tbody) return;

    const searchTerm = (document.getElementById('commission-search')?.value || '').trim().toLowerCase();
    const list = recordsToRender.filter(r => {
        if (!searchTerm) return true;
        return (
            (r.title || '').toLowerCase().includes(searchTerm) ||
            (r.id || '').toLowerCase().includes(searchTerm) ||
            (r.buyer || '').toLowerCase().includes(searchTerm) ||
            (r.seller || '').toLowerCase().includes(searchTerm)
        );
    });

    tbody.innerHTML = '';
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #64748b; padding: 28px;">${searchTerm ? 'No commission records match your search' : 'No commission records found for this period.'}</td></tr>`;
        return;
    }

    list.forEach(r => {
        const dateStr = r.date ? r.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';
        
        let statusBadge = '';
        if (r.commStatus === 'REALIZED') {
            statusBadge = '<span style="background: #ECFDF5; color: #059669; padding: 4px 8px; border-radius: 6px; font-weight: 700; font-size: 0.78rem;">✓ Realized</span>';
        } else if (r.commStatus === 'IN_ESCROW') {
            statusBadge = '<span style="background: #FFFBEB; color: #D97706; padding: 4px 8px; border-radius: 6px; font-weight: 700; font-size: 0.78rem;">🔒 In Escrow</span>';
        } else if (r.commStatus === 'REFUNDED') {
            statusBadge = '<span style="background: #FEF2F2; color: #DC2626; padding: 4px 8px; border-radius: 6px; font-weight: 700; font-size: 0.78rem;">↩ Refunded</span>';
        } else {
            statusBadge = '<span style="background: #F1F5F9; color: #64748B; padding: 4px 8px; border-radius: 6px; font-weight: 700; font-size: 0.78rem;">⏳ Pending</span>';
        }

        const rateStr = r.feePercent > 0 ? `${r.feePercent}% (${r.feeAllocation})` : 'Fixed';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-size: 0.85rem; color: #64748b; white-space: nowrap;">${dateStr}</td>
            <td>
                <div style="font-weight: 600; color: #1e293b;">${escapeHtml(r.title)}</div>
                <div style="font-size: 0.75rem; color: #64748b;">Ref: ${escapeHtml(r.id.slice(0, 10))}...</div>
            </td>
            <td style="font-weight: 600; color: #334155;">${formatGHS(r.amount)}</td>
            <td style="font-size: 0.82rem; color: #64748b;">${escapeHtml(rateStr)}</td>
            <td style="font-size: 0.85rem; color: #10b981; font-weight: 600;">+${formatGHS(r.buyerFee)}</td>
            <td style="font-size: 0.85rem; color: #6366f1; font-weight: 600;">-${formatGHS(r.sellerFee)}</td>
            <td style="font-weight: 700; color: #059669; font-size: 0.95rem;">${formatGHS(r.totalFee)}</td>
            <td>${statusBadge}</td>
        `;
        tbody.appendChild(tr);
    });
};

// Commission search and timeframe filter events
document.getElementById('commission-search')?.addEventListener('input', () => {
    renderCommissionWallet();
});

document.querySelectorAll('#commission-timeframe .tf-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('#commission-timeframe .tf-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentCommissionTimeframe = btn.getAttribute('data-tf') || 'all';
        renderCommissionWallet();
    });
});

// CSV Export for Commissions
document.getElementById('btn-export-commissions')?.addEventListener('click', () => {
    if (!allCommissionRecords || allCommissionRecords.length === 0) {
        alert("No commission records available to export.");
        return;
    }

    const headers = ["Date", "Order Reference", "Item Description", "Gross Amount (GHS)", "Fee Rate", "Buyer Fee (GHS)", "Seller Fee (GHS)", "TrustLink Commission (GHS)", "Commission Status", "Buyer", "Seller"];
    const rows = allCommissionRecords.map(r => [
        r.date ? r.date.toISOString() : '',
        `"${r.id}"`,
        `"${(r.title || '').replace(/"/g, '""')}"`,
        r.amount.toFixed(2),
        `"${r.feePercent}% (${r.feeAllocation})"`,
        r.buyerFee.toFixed(2),
        r.sellerFee.toFixed(2),
        r.totalFee.toFixed(2),
        `"${r.commStatus}"`,
        `"${(r.buyer || '').replace(/"/g, '""')}"`,
        `"${(r.seller || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `trustlink_commissions_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

// -------------------------------------------------------------
// User Management (searchable) + Role Management
// -------------------------------------------------------------
let allUsers = [];

const loadUsersList = async () => {
    try {
        const usersSnap = await getDocs(collection(db, 'users'));
        allUsers = [];
        usersSnap.forEach(userDoc => allUsers.push({ id: userDoc.id, ...userDoc.data() }));
        renderUsersTable();
        renderRolesTable();
    } catch (error) {
        console.error("Error loading users:", error);
    }
};

const renderUsersTable = () => {
    const tbody = document.getElementById('admin-users-list');
    if (!tbody) return;
    const term = (document.getElementById('user-search')?.value || '').trim().toLowerCase();
    const list = allUsers.filter(u =>
        !term ||
        (u.email || '').toLowerCase().includes(term) ||
        (u.fullName || '').toLowerCase().includes(term)
    );

    tbody.innerHTML = '';
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center;">${term ? 'No users match your search' : 'No users found'}</td></tr>`;
        return;
    }

    list.forEach(u => {
        const email = u.email || 'N/A';
        const name = u.fullName || email.split('@')[0];
        const createdAt = toDate(u.createdAt);
        const dateStr = createdAt ? createdAt.toLocaleDateString() : 'Unknown';
        const isVerified = u.emailVerified ? '<span style="color: #10b981; font-weight: bold; font-size: 0.85rem;">Verified</span>' : '<span style="color: #f59e0b; font-weight: bold; font-size: 0.85rem;">Unverified</span>';
        const role = (u.role === 'admin' || u.role === 'support') ? `<span style="color: #9333ea; font-size: 0.8rem; margin-left: 8px;">(${escapeHtml(u.role)})</span>` : '';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escapeHtml(name)}</strong> ${role}</td>
            <td>${escapeHtml(email)}</td>
            <td>${dateStr}</td>
            <td>${isVerified}</td>
            <td></td>
        `;
        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-outline btn-sm';
        editBtn.style.cssText = 'padding: 4px 10px; font-size: 0.8rem; border-color: #cbd5e1; color: #334155;';
        editBtn.textContent = 'View / Edit';
        editBtn.addEventListener('click', () => openEditUserModal(u.id, name, email, u.role || 'user', u.emailVerified || false));
        tr.querySelector('td:last-child').appendChild(editBtn);
        tbody.appendChild(tr);
    });
};

document.getElementById('user-search')?.addEventListener('input', renderUsersTable);

const ROLE_LABELS = { admin: 'Super Admin', support: 'Support Agent' };

const renderRolesTable = () => {
    const tbody = document.getElementById('admin-roles-list');
    if (!tbody) return;
    const admins = allUsers.filter(u => u.role === 'admin' || u.role === 'support');

    tbody.innerHTML = '';
    if (admins.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #64748b;">No administrators found. Create one on the left.</td></tr>';
        return;
    }

    admins.forEach(u => {
        const email = u.email || 'N/A';
        const name = u.fullName || email.split('@')[0];
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #e2e8f0';
        tr.innerHTML = `
            <td><strong>${escapeHtml(name)}</strong></td>
            <td>${escapeHtml(email)}</td>
            <td>${ROLE_LABELS[u.role] || escapeHtml(u.role)}</td>
            <td><span class="badge-status badge-success">Active</span></td>
            <td></td>
        `;
        const actions = tr.querySelector('td:last-child');

        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-outline';
        editBtn.style.cssText = 'padding: 4px 12px; font-size: 0.8rem; border-color: #cbd5e1; color: #334155;';
        editBtn.textContent = 'Edit Role';
        editBtn.addEventListener('click', () => openEditUserModal(u.id, name, email, u.role || 'user', u.emailVerified || false));
        actions.appendChild(editBtn);

        // Don't let the signed-in admin revoke themselves
        if (auth.currentUser && u.email !== auth.currentUser.email) {
            const revokeBtn = document.createElement('button');
            revokeBtn.className = 'btn btn-outline';
            revokeBtn.style.cssText = 'padding: 4px 12px; font-size: 0.8rem; border-color: #ef4444; color: #ef4444; margin-left: 8px;';
            revokeBtn.textContent = 'Revoke';
            revokeBtn.addEventListener('click', async () => {
                if (!confirm(`Revoke admin access for ${email}? They will become a regular user.`)) return;
                try {
                    await updateDoc(doc(db, "users", u.id), { role: 'user' });
                    loadUsersList();
                } catch (error) {
                    alert("Failed to revoke access: " + error.message);
                }
            });
            actions.appendChild(revokeBtn);
        }

        tbody.appendChild(tr);
    });
};

// User Modal Logic
let currentEditUserId = null;
const editUserModal = document.getElementById('edit-user-modal');

const openEditUserModal = (id, name, email, role, verified) => {
    currentEditUserId = id;
    document.getElementById('edit-user-email').value = email;
    document.getElementById('edit-user-name').value = name;
    document.getElementById('edit-user-role').value = role;
    document.getElementById('edit-user-verified').checked = verified;

    editUserModal.classList.remove('hidden');
};
window.openEditUserModal = openEditUserModal;

document.getElementById('close-user-modal').addEventListener('click', () => {
    editUserModal.classList.add('hidden');
});
document.getElementById('cancel-user-edit').addEventListener('click', () => {
    editUserModal.classList.add('hidden');
});

document.getElementById('delete-user-btn')?.addEventListener('click', async () => {
    if (!currentEditUserId) return;
    const email = document.getElementById('edit-user-email').value;

    if (auth.currentUser && email === auth.currentUser.email) {
        alert("You cannot delete your own account while signed in.");
        return;
    }
    if (!confirm(`Permanently delete ${email}?\n\nTheir profile, role, and wallet record will be removed. This cannot be undone.`)) return;

    const btn = document.getElementById('delete-user-btn');
    btn.disabled = true;
    btn.textContent = 'Deleting...';

    try {
        await deleteDoc(doc(db, "users", currentEditUserId));
        currentEditUserId = null;
        editUserModal.classList.add('hidden');
        alert("User deleted. Note: their sign-in account still exists in Firebase Authentication - remove it from the Firebase console if needed.");
        loadUsersList();
        fetchAdminStats();
    } catch (error) {
        console.error("Error deleting user:", error);
        alert("Failed to delete user: " + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Delete User';
    }
});

document.getElementById('save-user-edit').addEventListener('click', async () => {
    if (!currentEditUserId) return;

    const saveBtn = document.getElementById('save-user-edit');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        const newName = document.getElementById('edit-user-name').value;
        const newRole = document.getElementById('edit-user-role').value;
        const newVerified = document.getElementById('edit-user-verified').checked;

        await updateDoc(doc(db, "users", currentEditUserId), {
            fullName: newName,
            role: newRole,
            emailVerified: newVerified
        });

        alert("User details updated successfully!");
        editUserModal.classList.add('hidden');
        loadUsersList(); // Refresh both users and roles tables
    } catch (error) {
        console.error("Error updating user:", error);
        alert("Failed to update user: " + error.message);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
    }
});

// -------------------------------------------------------------
// Dispute Resolution
// -------------------------------------------------------------
let currentDisputeId = null;
const refundBtn = document.getElementById('btn-refund-buyer');
const releaseBtn = document.getElementById('btn-release-seller');

const setDisputeButtonsEnabled = (enabled) => {
    if (refundBtn) refundBtn.disabled = !enabled;
    if (releaseBtn) releaseBtn.disabled = !enabled;
};

const loadDisputes = async () => {
    const listEl = document.getElementById('admin-disputes-list');
    if (!listEl) return;
    try {
        const snap = await getDocs(collection(db, 'escrows'));
        const disputes = [];
        snap.forEach(d => {
            if (normStatus(d.data().status) === 'disputed') {
                disputes.push({ id: d.id, ...d.data() });
            }
        });

        const badge = document.getElementById('disputes-badge');
        if (badge) {
            badge.textContent = disputes.length;
            badge.style.display = disputes.length > 0 ? '' : 'none';
        }
        adminAlerts.disputes = disputes.length;
        renderAdminNotifs();

        listEl.innerHTML = '';
        currentDisputeId = null;
        setDisputeButtonsEnabled(false);

        if (disputes.length === 0) {
            listEl.innerHTML = '<div style="padding: 20px; color: #64748b; font-size: 0.9rem;">No open disputes.</div>';
            const title = document.getElementById('dispute-title');
            if (title) title.textContent = 'No open disputes';
            const msgs = document.getElementById('admin-dispute-messages');
            if (msgs) msgs.innerHTML = '';
            return;
        }

        disputes.forEach(d => {
            const div = document.createElement('div');
            div.className = 'chat-contact';
            const amount = formatGHS(parseFloat(d.amount) || 0);
            div.innerHTML = `
                <div class="contact-info">
                    <h4>${escapeHtml(d.description || 'Escrow ' + d.id.slice(0, 6).toUpperCase())}</h4>
                    <p>${amount} · ${escapeHtml(d.buyerEmail || d.buyerPhone || 'Unknown buyer')}</p>
                </div>
            `;
            div.addEventListener('click', () => selectDispute(d, div));
            listEl.appendChild(div);
        });
    } catch (error) {
        console.error("Error loading disputes:", error);
    }
};

const selectDispute = (d, el) => {
    currentDisputeId = d.id;
    document.querySelectorAll('#admin-disputes-list .chat-contact').forEach(c => c.classList.remove('active'));
    el.classList.add('active');

    const title = document.getElementById('dispute-title');
    if (title) title.textContent = (d.description || 'Dispute') + ' — ' + formatGHS(parseFloat(d.amount) || 0);

    const created = toDate(d.createdAt);
    const msgs = document.getElementById('admin-dispute-messages');
    if (msgs) {
        msgs.innerHTML = `
            <div class="system-message" style="padding: 10px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 0.85rem;">
                Escrow ref: ${escapeHtml(d.id)}
            </div>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; font-size: 0.9rem; color: #334155; line-height: 2;">
                <strong style="display: block; font-size: 1rem; color: #0f172a; margin-bottom: 8px;">Dispute Details</strong>
                <div><strong>Item:</strong> ${escapeHtml(d.description || 'N/A')}</div>
                <div><strong>Amount in escrow:</strong> ${formatGHS(parseFloat(d.amount) || 0)}</div>
                <div><strong>Seller:</strong> ${escapeHtml(d.sellerName || d.sellerId || 'Unknown')}</div>
                <div><strong>Buyer:</strong> ${escapeHtml(d.buyerEmail || d.buyerPhone || 'Unknown')}</div>
                <div><strong>Created:</strong> ${created ? created.toLocaleString() : 'Unknown'}</div>
                ${d.disputeReason ? `<div><strong>Reason:</strong> ${escapeHtml(d.disputeReason)}</div>` : ''}
            </div>
        `;
    }

    setDisputeButtonsEnabled(true);
};

const resolveDispute = async (newStatus, confirmMsg) => {
    if (!currentDisputeId) return;
    if (!confirm(confirmMsg)) return;
    try {
        await updateDoc(doc(db, "escrows", currentDisputeId), {
            status: newStatus,
            resolvedAt: new Date(),
            resolvedBy: auth.currentUser ? auth.currentUser.email : 'admin'
        });
        await loadDisputes();
        fetchAdminStats();
    } catch (error) {
        console.error("Error resolving dispute:", error);
        alert("Failed to resolve dispute: " + error.message);
    }
};

refundBtn?.addEventListener('click', () => resolveDispute('REFUNDED', 'Refund the escrowed funds to the buyer? This closes the dispute.'));
releaseBtn?.addEventListener('click', () => resolveDispute('RELEASED', 'Release the escrowed funds to the seller? This closes the dispute.'));

// -------------------------------------------------------------
// Notification bell: open disputes + pending withdrawals
// -------------------------------------------------------------
const adminAlerts = { disputes: 0, withdrawals: 0 };

const goToView = (targetId) => {
    document.querySelector(`.nav-item[data-target="${targetId}"]`)?.click();
    document.getElementById('notif-dropdown')?.classList.add('hidden');
};

const renderAdminNotifs = () => {
    const dot = document.getElementById('notif-dot');
    const list = document.getElementById('notif-list');
    if (!list) return;
    const total = adminAlerts.disputes + adminAlerts.withdrawals;
    if (dot) dot.classList.toggle('hidden', total === 0);

    list.innerHTML = '';
    if (total === 0) {
        list.innerHTML = '<div class="notif-empty">All clear 🎉</div>';
        return;
    }
    if (adminAlerts.disputes > 0) {
        const item = document.createElement('div');
        item.className = 'notif-item';
        item.innerHTML = `<h5>⚖️ ${adminAlerts.disputes} open dispute${adminAlerts.disputes === 1 ? '' : 's'}</h5><p>Buyers are waiting for a resolution. Tap to review.</p>`;
        item.addEventListener('click', () => goToView('view-disputes'));
        list.appendChild(item);
    }
    if (adminAlerts.withdrawals > 0) {
        const item = document.createElement('div');
        item.className = 'notif-item';
        item.innerHTML = `<h5>💸 ${adminAlerts.withdrawals} pending withdrawal${adminAlerts.withdrawals === 1 ? '' : 's'}</h5><p>Sellers are waiting for their payout. Tap to process.</p>`;
        item.addEventListener('click', () => goToView('view-approvals'));
        list.appendChild(item);
    }
};

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

// -------------------------------------------------------------
// Payouts: withdrawal requests + full transaction log
// -------------------------------------------------------------
const NETWORK_NAMES = { '13': 'MTN MoMo', '6': 'Telecel Cash', '7': 'AT Money' };

const userEmailById = (uid) => {
    const u = allUsers.find(x => x.id === uid);
    return u ? (u.email || u.fullName || uid) : (uid || 'Unknown');
};

const loadPayoutsAdmin = async () => {
    const wBody = document.getElementById('admin-withdrawals-list');
    const tBody = document.getElementById('admin-transactions-list');
    if (!wBody && !tBody) return;
    try {
        const snap = await getDocs(collection(db, 'transactions'));
        const all = [];
        snap.forEach(d => all.push({ id: d.id, ...d.data() }));
        all.sort((a, b) => {
            const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
            const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
            return tb - ta;
        });

        // ---- Pending withdrawal requests ----
        if (wBody) {
            const pending = all.filter(t => normStatus(t.type) === 'withdrawal' && normStatus(t.status) === 'pending');
            adminAlerts.withdrawals = pending.length;
            renderAdminNotifs();
            wBody.innerHTML = '';
            if (pending.length === 0) {
                wBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #64748b;">No pending withdrawal requests.</td></tr>';
            }
            pending.forEach(t => {
                const created = toDate(t.createdAt);
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${created ? created.toLocaleString() : '—'}</td>
                    <td>${escapeHtml(userEmailById(t.userId))}</td>
                    <td><strong>${formatGHS(parseFloat(t.amount) || 0)}</strong></td>
                    <td>${escapeHtml(t.momoNumber || '—')}</td>
                    <td>${NETWORK_NAMES[t.network] || escapeHtml(t.network || '—')}</td>
                    <td></td>
                `;
                const actions = tr.querySelector('td:last-child');

                const approveBtn = document.createElement('button');
                approveBtn.className = 'btn btn-primary';
                approveBtn.style.cssText = 'padding: 4px 12px; font-size: 0.8rem; background: var(--success); border-color: var(--success);';
                approveBtn.textContent = 'Approve';
                approveBtn.addEventListener('click', async () => {
                    if (!confirm(`Are you sure you want to approve payout of ${formatGHS(parseFloat(t.amount) || 0)} to ${t.momoNumber} (${NETWORK_NAMES[t.network] || t.network})?\n\nThis will automatically disburse funds via Moolre API.`)) return;
                    approveBtn.disabled = true;
                    approveBtn.textContent = 'Processing...';
                    try {
                        // Fast MVP Approach: Call Moolre directly from frontend
                        await executeMoolrePayout(t.id, parseFloat(t.amount) || 0, t.momoNumber, t.network);
                        
                        await updateDoc(doc(db, "transactions", t.id), {
                            status: 'completed',
                            processedAt: new Date(),
                            processedBy: auth.currentUser ? auth.currentUser.email : 'admin'
                        });
                        
                        // SMS the seller that their payout is on its way
                        try {
                            if (t.momoNumber) {
                                await sendEscrowStatusSMS(t.momoNumber, `TrustLink: Your withdrawal of ${formatGHS(parseFloat(t.amount) || 0)} has been approved and sent to your ${NETWORK_NAMES[t.network] || 'mobile money'} wallet (${t.momoNumber}).`, `${t.id}-payout`);
                            }
                        } catch (smsErr) { console.warn("Payout SMS failed:", smsErr); }
                        loadPayoutsAdmin();
                        fetchAdminStats();
                    } catch (error) {
                        alert("Failed to approve: " + error.message);
                        approveBtn.disabled = false;
                        approveBtn.textContent = 'Approve';
                    }
                });
                actions.appendChild(approveBtn);

                const rejectBtn = document.createElement('button');
                rejectBtn.className = 'btn btn-outline';
                rejectBtn.style.cssText = 'padding: 4px 12px; font-size: 0.8rem; border-color: #ef4444; color: #ef4444; margin-left: 8px;';
                rejectBtn.textContent = 'Reject';
                rejectBtn.addEventListener('click', async () => {
                    if (!confirm(`Reject this withdrawal? ${formatGHS(parseFloat(t.amount) || 0)} will be refunded to the user's TrustLink balance.`)) return;
                    rejectBtn.disabled = true;
                    try {
                        await updateDoc(doc(db, "transactions", t.id), {
                            status: 'rejected',
                            processedAt: new Date(),
                            processedBy: auth.currentUser ? auth.currentUser.email : 'admin'
                        });
                        // Refund the reserved funds
                        const userRef = doc(db, "users", t.userId);
                        const userSnap = await getDoc(userRef);
                        if (userSnap.exists()) {
                            const refundAmount = parseFloat(t.amount) || 0;
                            const bal = parseFloat(userSnap.data().walletBalance || 0);
                            await updateDoc(userRef, { walletBalance: bal + refundAmount });
                            
                            // Add a deposit transaction so the user sees the refund in their history
                            await addDoc(collection(db, "transactions"), {
                                userId: t.userId,
                                type: 'deposit',
                                amount: refundAmount,
                                fee: 0,
                                status: 'completed',
                                description: 'Refund: Rejected Withdrawal',
                                originalTxId: t.id,
                                createdAt: serverTimestamp()
                            });
                        }
                        // Tell the seller their funds were returned
                        try {
                            if (t.momoNumber) {
                                await sendEscrowStatusSMS(t.momoNumber, `TrustLink: Your withdrawal request of ${formatGHS(parseFloat(t.amount) || 0)} was declined. The full amount has been refunded to your TrustLink wallet balance. Contact support for details.`, `${t.id}-payout`);
                            }
                        } catch (smsErr) { console.warn("Rejection SMS failed:", smsErr); }
                        loadPayoutsAdmin();
                        fetchAdminStats();
                    } catch (error) {
                        alert("Failed to reject: " + error.message);
                        rejectBtn.disabled = false;
                    }
                });
                actions.appendChild(rejectBtn);

                wBody.appendChild(tr);
            });
        }

        // ---- Full transaction log ----
        if (tBody) {
            tBody.innerHTML = '';
            if (all.length === 0) {
                tBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #64748b;">No transactions yet.</td></tr>';
                return;
            }
            const statusColors = { completed: '#10b981', pending: '#f59e0b', rejected: '#ef4444' };
            all.slice(0, 100).forEach(t => {
                const created = toDate(t.createdAt);
                const isCredit = normStatus(t.type) === 'deposit';
                const color = statusColors[normStatus(t.status)] || '#64748b';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${created ? created.toLocaleString() : '—'}</td>
                    <td>${escapeHtml(userEmailById(t.userId))}</td>
                    <td style="text-transform: capitalize;">${escapeHtml(t.type || '—')}</td>
                    <td>${escapeHtml(t.description || '—')}</td>
                    <td style="color: ${isCredit ? '#10b981' : '#ef4444'}; font-weight: 600;">${isCredit ? '+' : '-'} ${formatGHS(parseFloat(t.amount) || 0)}</td>
                    <td>${formatGHS(parseFloat(t.fee) || 0)}</td>
                    <td><span style="color: ${color}; font-weight: 700; font-size: 0.8rem; text-transform: uppercase;">${escapeHtml(t.status || '—')}</span></td>
                `;
                tBody.appendChild(tr);
            });
        }
    } catch (error) {
        console.error("Error loading payouts:", error);
    }
};

// -------------------------------------------------------------
// Escrow Management (view + delete test data)
// -------------------------------------------------------------
let allEscrows = [];

const loadEscrowsAdmin = async () => {
    const tbody = document.getElementById('admin-escrows-list');
    if (!tbody) return;
    try {
        const snap = await getDocs(collection(db, 'escrows'));
        allEscrows = [];
        snap.forEach(d => allEscrows.push({ id: d.id, ...d.data() }));
        renderEscrowsAdmin();
    } catch (error) {
        console.error("Error loading escrows:", error);
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #ef4444;">Failed to load escrows</td></tr>';
    }
};

const ESCROW_STATUS_COLORS = {
    pending_payment: '#f59e0b', funded: '#3b82f6', dispatched: '#10b981',
    completed: '#10b981', disputed: '#ef4444', refunded: '#ef4444', released: '#10b981'
};

const renderEscrowsAdmin = () => {
    const tbody = document.getElementById('admin-escrows-list');
    if (!tbody) return;
    const term = (document.getElementById('escrow-search')?.value || '').trim().toLowerCase();
    const list = allEscrows.filter(e =>
        !term ||
        (e.description || '').toLowerCase().includes(term) ||
        (e.sellerName || '').toLowerCase().includes(term) ||
        (e.buyerEmail || '').toLowerCase().includes(term) ||
        (e.buyerPhone || '').toLowerCase().includes(term)
    );

    tbody.innerHTML = '';
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #64748b;">${term ? 'No escrows match your search' : 'No escrows found'}</td></tr>`;
        return;
    }

    // Newest first
    list.sort((a, b) => {
        const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
        const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
        return tb - ta;
    });

    list.forEach(e => {
        const created = toDate(e.createdAt);
        const status = normStatus(e.status);
        const color = ESCROW_STATUS_COLORS[status] || '#64748b';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escapeHtml(e.description || 'Escrow ' + e.id.slice(0, 6))}</strong></td>
            <td>${formatGHS(parseFloat(e.amount) || 0)}</td>
            <td>${escapeHtml(e.sellerName || e.sellerId || '—')}</td>
            <td>${escapeHtml(e.buyerEmail || e.buyerPhone || '—')}</td>
            <td><span style="color: ${color}; font-weight: 700; font-size: 0.8rem; text-transform: uppercase;">${escapeHtml(e.status || 'unknown')}</span></td>
            <td>${created ? created.toLocaleDateString() : '—'}</td>
            <td></td>
        `;
        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-outline';
        delBtn.style.cssText = 'padding: 4px 12px; font-size: 0.8rem; border-color: #ef4444; color: #ef4444;';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', async () => {
            if (!confirm(`Permanently delete this escrow?\n\n"${e.description || e.id}" — ${formatGHS(parseFloat(e.amount) || 0)}\n\nThis cannot be undone and it will disappear from analytics.`)) return;
            delBtn.disabled = true;
            delBtn.textContent = 'Deleting...';
            try {
                await deleteDoc(doc(db, "escrows", e.id));
                await loadEscrowsAdmin();
                fetchAdminStats();
                loadDisputes();
            } catch (error) {
                alert("Failed to delete escrow: " + error.message);
                delBtn.disabled = false;
                delBtn.textContent = 'Delete';
            }
        });
        tr.querySelector('td:last-child').appendChild(delBtn);
        tbody.appendChild(tr);
    });
};

document.getElementById('escrow-search')?.addEventListener('input', renderEscrowsAdmin);

// -------------------------------------------------------------
// Platform settings (fee configuration)
// -------------------------------------------------------------
const loadPlatformSettings = async () => {
    const feeInput = document.getElementById('platform-fee');
    if (!feeInput) return;
    try {
        const snap = await getDoc(doc(db, "settings", "platform"));
        if (snap.exists() && snap.data().feePercent !== undefined) {
            feeInput.value = snap.data().feePercent;
        }
    } catch (error) {
        console.error("Error loading platform settings:", error);
    }
};

document.getElementById('btn-save-fee')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-save-fee');
    const fee = parseFloat(document.getElementById('platform-fee').value);
    if (isNaN(fee) || fee < 0 || fee > 100) {
        alert("Please enter a valid fee percentage between 0 and 100.");
        return;
    }
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
        await setDoc(doc(db, "settings", "platform"), { feePercent: fee, updatedAt: new Date() }, { merge: true });
        btn.textContent = 'Saved ✓';
        setTimeout(() => { btn.textContent = 'Save Changes'; btn.disabled = false; }, 1500);
    } catch (error) {
        alert("Failed to save fee: " + error.message);
        btn.textContent = 'Save Changes';
        btn.disabled = false;
    }
});

// Initialize when document loads
document.addEventListener('DOMContentLoaded', async () => {
    initCharts();
});

// Admin Creation Logic using secondary app
const btnCreateAdmin = document.getElementById('btn-create-admin');
if (btnCreateAdmin) {
    btnCreateAdmin.addEventListener('click', async () => {
        const name = document.getElementById('new-admin-name').value.trim();
        const email = document.getElementById('new-admin-email').value.trim();
        const password = document.getElementById('new-admin-password').value;
        const role = document.getElementById('new-admin-role').value;

        if (!name || !email || !password) {
            alert("Please fill in all fields to create an admin.");
            return;
        }

        btnCreateAdmin.textContent = "Creating...";
        btnCreateAdmin.disabled = true;

        try {
            // Initialize a secondary app to avoid logging out the current admin
            const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
            const secondaryAuth = getAuth(secondaryApp);

            let isUpgrade = false;
            try {
                // Try to create the new user
                const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
                const newUser = userCredential.user;

                // Add the user to Firestore with the selected role
                await setDoc(doc(db, "users", newUser.uid), {
                    fullName: name,
                    email: email,
                    role: role,
                    createdAt: new Date(),
                    emailVerified: true // Admins created by an admin are automatically verified
                });
            } catch (err) {
                if (err.code === 'auth/email-already-in-use') {
                    // Upgrade existing user instead
                    const q = query(collection(db, "users"), where("email", "==", email));
                    const querySnapshot = await getDocs(q);

                    if (querySnapshot.empty) {
                        throw new Error("Email is in use, but user record not found in database. Cannot upgrade.");
                    }

                    const existingUserDoc = querySnapshot.docs[0];
                    await updateDoc(doc(db, "users", existingUserDoc.id), {
                        role: role,
                        emailVerified: true
                    });

                    isUpgrade = true;
                } else {
                    throw err; // Re-throw if it's a different error
                }
            }

            // Sign out the secondary instance
            await signOut(secondaryAuth);

            if (isUpgrade) {
                alert("This user already existed in the system. They have been successfully upgraded to " + role + "!");
            } else {
                alert("Administrator successfully created!");
            }

            // Clear inputs
            document.getElementById('new-admin-name').value = '';
            document.getElementById('new-admin-email').value = '';
            document.getElementById('new-admin-password').value = '';

            // Refresh the role management table
            loadUsersList();

        } catch (error) {
            console.error("Error creating admin:", error);
            alert("Failed to create admin: " + error.message);
        } finally {
            btnCreateAdmin.textContent = "Create Administrator";
            btnCreateAdmin.disabled = false;
        }
    });
}
