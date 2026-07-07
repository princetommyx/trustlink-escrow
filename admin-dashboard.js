import { auth, db, firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { onAuthStateChanged, signOut, getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, setDoc, getDoc, updateDoc, collection, getDocs, query, where, getCountFromServer, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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
    try {
        await signOut(auth);
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

        activityRecords = [];

        // Escrow (statuses are stored uppercase, e.g. PENDING_PAYMENT / FUNDED)
        const escrowDocs = await getDocs(collection(db, 'escrows'));
        let tEscrow = 0, eFunded = 0, cEscrow = 0, dEscrow = 0;
        escrowDocs.forEach(doc => {
            const data = doc.data();
            const amt = parseFloat(data.amount) || 0;
            const status = normStatus(data.status);
            tEscrow += amt;
            if (status === 'funded' || status === 'active') eFunded += amt;
            else if (status === 'canceled' || status === 'cancelled') cEscrow += amt;
            else if (status === 'disputed') dEscrow += amt;

            const date = toDate(data.createdAt);
            activityRecords.push({
                date,
                inAmt: ['funded', 'active', 'completed', 'released'].includes(status) ? amt : 0,
                outAmt: ['completed', 'released', 'refunded'].includes(status) ? amt : 0,
                plus: 1,
                minus: ['canceled', 'cancelled', 'refunded', 'disputed'].includes(status) ? 1 : 0
            });
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
            const status = normStatus(data.status);
            const type = normStatus(data.type);
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

            if (status === 'completed') {
                activityRecords.push({
                    date: toDate(data.createdAt),
                    inAmt: type === 'deposit' ? amt : 0,
                    outAmt: type === 'withdrawal' ? amt : 0,
                    plus: type === 'deposit' ? 1 : 0,
                    minus: type === 'withdrawal' ? 1 : 0
                });
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

        renderDwChart();
        renderTxChart();
    } catch (error) {
        console.error("Error loading stats:", error);
    }
};

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
document.addEventListener('DOMContentLoaded', () => {
    initCharts();
    fetchAdminStats();
    loadUsersList();
    loadDisputes();
    loadPlatformSettings();
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
