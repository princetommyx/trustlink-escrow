import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, collection, getDocs, query, where, getCountFromServer, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

    // Set Admin Name
    try {
        const docSnap = await getDoc(doc(db, "users", user.uid));
        if (docSnap.exists() && docSnap.data().fullName) {
            document.getElementById('user-name').textContent = docSnap.data().fullName;
        } else {
            document.getElementById('user-name').textContent = 'Admin (' + user.email.split('@')[0] + ')';
        }
    } catch(e) {
        document.getElementById('user-name').textContent = 'Admin (' + user.email.split('@')[0] + ')';
    }
});

document.getElementById('btn-signout').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = "login.html";
});

// -------------------------------------------------------------
// Chart.js Implementations
// -------------------------------------------------------------
const initCharts = () => {
    // Shared chart options for light background
    Chart.defaults.color = '#475569';
    Chart.defaults.font.family = "'Inter', sans-serif";
    const gridColor = 'rgba(0, 0, 0, 0.05)';
    const tooltipOptions = {
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        titleColor: '#0f172a',
        bodyColor: '#334155',
        borderColor: 'rgba(0, 0, 0, 0.1)',
        borderWidth: 1,
        padding: 12,
        boxPadding: 6
    };

    const labels = ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5']; // Placeholder for now
    const depositData = [0, 0, 0, 0, 0];
    const withdrawData = [0, 0, 0, 0, 0];
    
    // 1. Deposit & Withdraw Report (Bar/Line Chart combo or Dual Bar)
    const ctxDW = document.getElementById('depositWithdrawChart');
    if (ctxDW) {
        new Chart(ctxDW, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Deposited',
                        data: depositData,
                        backgroundColor: '#10b981', // Emerald green
                        borderRadius: 4,
                        barPercentage: 0.6,
                        categoryPercentage: 0.8
                    },
                    {
                        label: 'Withdrawn',
                        data: withdrawData,
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
                    tooltip: tooltipOptions
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: gridColor },
                        border: { display: false }
                    },
                    x: {
                        grid: { display: false },
                        border: { display: false }
                    }
                }
            }
        });
    }

    const plusTxData = [0, 0, 0, 0, 0];
    const minusTxData = [0, 0, 0, 0, 0];

    // 2. Transactions Report (Line Chart)
    const ctxTx = document.getElementById('transactionsChart');
    if (ctxTx) {
        new Chart(ctxTx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Plus Transactions',
                        data: plusTxData,
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
                        data: minusTxData,
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
                    tooltip: tooltipOptions
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: gridColor },
                        border: { display: false }
                    },
                    x: {
                        grid: { display: false },
                        border: { display: false }
                    }
                }
            }
        });
    }
};

const formatGHS = (amount) => {
    return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', minimumFractionDigits: 0 }).format(amount);
};

const fetchAdminStats = async () => {
    try {
        // Users
        const usersCol = collection(db, 'users');
        const totalUsersSnap = await getCountFromServer(usersCol);
        const totalUsers = totalUsersSnap.data().count;
        document.getElementById('stat-total-users').textContent = totalUsers.toLocaleString();
        document.getElementById('stat-active-users').textContent = totalUsers.toLocaleString(); // Replace with active logic if needed
        
        const unvEmailSnap = await getCountFromServer(query(usersCol, where('emailVerified', '==', false)));
        document.getElementById('stat-email-unverified-users').textContent = unvEmailSnap.data().count.toLocaleString();
        
        const unvMobileSnap = await getCountFromServer(query(usersCol, where('phoneVerified', '==', false)));
        document.getElementById('stat-mobile-unverified-users').textContent = unvMobileSnap.data().count.toLocaleString();

        // Escrow
        const escrowDocs = await getDocs(collection(db, 'escrows'));
        let tEscrow = 0, eFunded = 0, cEscrow = 0, dEscrow = 0;
        escrowDocs.forEach(doc => {
            const data = doc.data();
            const amt = parseFloat(data.amount) || 0;
            tEscrow += amt;
            if (data.status === 'funded' || data.status === 'active') eFunded += amt;
            else if (data.status === 'canceled' || data.status === 'cancelled') cEscrow += amt;
            else if (data.status === 'disputed') dEscrow += amt;
        });
        document.getElementById('stat-total-escrowed').textContent = formatGHS(tEscrow);
        document.getElementById('stat-escrowed-funded').textContent = formatGHS(eFunded);
        document.getElementById('stat-canceled-escrow').textContent = formatGHS(cEscrow);
        document.getElementById('stat-disputed-escrow').textContent = formatGHS(dEscrow);

        // Transactions (Deposits/Withdrawals)
        const txDocs = await getDocs(collection(db, 'transactions'));
        let tDep = 0, pDep = 0, rDep = 0, dCharge = 0;
        let tWith = 0, pWith = 0, rWith = 0, wCharge = 0;

        txDocs.forEach(doc => {
            const data = doc.data();
            const amt = parseFloat(data.amount) || 0;
            const fee = parseFloat(data.fee) || 0;
            if (data.type === 'deposit') {
                if (data.status === 'completed') tDep += amt;
                else if (data.status === 'pending') pDep += amt;
                else if (data.status === 'rejected') rDep += amt;
                dCharge += fee;
            } else if (data.type === 'withdrawal') {
                if (data.status === 'completed') tWith += amt;
                else if (data.status === 'pending') pWith += amt;
                else if (data.status === 'rejected') rWith += amt;
                wCharge += fee;
            }
        });

        document.getElementById('stat-total-deposits').textContent = formatGHS(tDep);
        document.getElementById('stat-pending-deposits').textContent = formatGHS(pDep);
        document.getElementById('stat-rejected-deposits').textContent = formatGHS(rDep);
        document.getElementById('stat-deposit-charges').textContent = formatGHS(dCharge);

        document.getElementById('stat-total-withdrawals').textContent = formatGHS(tWith);
        document.getElementById('stat-pending-withdrawals').textContent = formatGHS(pWith);
        document.getElementById('stat-rejected-withdrawals').textContent = formatGHS(rWith);
        document.getElementById('stat-withdrawal-charges').textContent = formatGHS(wCharge);

        initCharts(txDocs);
    } catch (error) {
        console.error("Error loading stats:", error);
    }
};

// Initialize when document loads
document.addEventListener('DOMContentLoaded', () => {
    fetchAdminStats();
});
