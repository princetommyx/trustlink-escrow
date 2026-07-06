import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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
    gsap.from('.stat-card', { opacity: 0, y: 30, duration: 0.8, stagger: 0.1, ease: 'power3.out', delay: 0.2 });
    // Animate portals
    gsap.from('.portal-card', { opacity: 0, y: 20, duration: 0.8, ease: 'power3.out', delay: 0.4 });
}

// Authentication Protection
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }
    
    // Check if Admin
    let isAdmin = false;
    if (user.email === 'admin@trustlink.com') {
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
