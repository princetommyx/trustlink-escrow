import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initSessionTracker } from "./session-manager.js";

// --- Authentication (Optional for viewing docs) ---
let currentApiKey = '';
onAuthStateChanged(auth, async (user) => {
    if (user) {
        initSessionTracker({ auth, userType: 'user' });
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
                const data = userDoc.data();
                
                document.getElementById('user-name').textContent = data.fullName || user.email.split('@')[0];
                document.getElementById('user-email').textContent = user.email;
                
                if (data.photoURL) {
                    const avatar = document.getElementById('sidebar-avatar');
                    avatar.style.backgroundImage = `url('${data.photoURL}')`;
                }

                if (data.apiKey) {
                    currentApiKey = data.apiKey;
                    const apiKeyInputs = document.querySelectorAll('input.param-value');
                    apiKeyInputs.forEach(input => {
                        if (input.value === 'tl_live_your_api_key_here' || input.value === 'tl_live_your_api_key') {
                            input.value = data.apiKey;
                        }
                    });
                    
                    const codeAreas = document.querySelectorAll('code');
                    codeAreas.forEach(code => {
                        code.innerHTML = code.innerHTML.replace('tl_live_your_api_key', data.apiKey);
                    });
                }
            }
        } catch (error) {
            console.error("Error fetching user data:", error);
        }
    } else {
        document.getElementById('user-name').textContent = 'Guest User';
        document.getElementById('user-email').textContent = 'Login to view your API Key';
    }
});

// --- UI Interactivity ---

const sidebar = document.getElementById('api-sidebar');
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileCloseBtn = document.getElementById('mobile-close');

if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.add('open');
    });
}

if (mobileCloseBtn) {
    mobileCloseBtn.addEventListener('click', () => {
        sidebar.classList.remove('open');
    });
}

document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768) {
        if (sidebar && mobileMenuBtn && !sidebar.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
            sidebar.classList.remove('open');
        }
    }
});

// Navigation Logic
const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
const views = document.querySelectorAll('.view-section');

navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        const targetId = item.getAttribute('data-target');
        if (!targetId) return;
        
        e.preventDefault();
        
        navItems.forEach(nav => nav.classList.remove('active'));
        views.forEach(view => {
            view.classList.add('hidden');
            view.style.display = 'none';
            view.classList.remove('active');
        });
        
        item.classList.add('active');
        
        const targetView = document.getElementById(targetId);
        if (targetView) {
            targetView.classList.remove('hidden');
            targetView.classList.add('active');
            if (targetId === 'view-endpoints') {
                targetView.style.display = 'flex';
            } else {
                targetView.style.display = 'block';
            }
        }
        
        if (window.innerWidth <= 768 && sidebar) {
            sidebar.classList.remove('open');
        }
    });
});

// Request Config Tabs
const configTabs = document.querySelectorAll('.tabs-header .tab-btn');
const configContents = document.querySelectorAll('.request-card .tab-content');

configTabs.forEach(tab => {
    if(tab.closest('.code-tabs')) return;
    
    tab.addEventListener('click', () => {
        configTabs.forEach(t => t.classList.remove('active'));
        configContents.forEach(c => c.classList.remove('active'));
        
        tab.classList.add('active');
        const targetId = `tab-${tab.dataset.tab}`;
        const targetContent = document.getElementById(targetId);
        if (targetContent) targetContent.classList.add('active');
    });
});

// Code / Response Tabs
const codeTabs = document.querySelectorAll('.code-tabs .tab-btn');
const codeAreas = document.querySelectorAll('.code-area');

codeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        codeTabs.forEach(t => t.classList.remove('active'));
        codeAreas.forEach(c => c.classList.remove('active'));
        
        tab.classList.add('active');
        const targetId = `code-${tab.dataset.codeTab}`;
        const targetArea = document.getElementById(targetId);
        if (targetArea) targetArea.classList.add('active');
    });
});

// Real / Developer Preview Sandbox Execution
const btnSend = document.getElementById('btn-send-test');
if (btnSend) {
    btnSend.addEventListener('click', async () => {
        btnSend.disabled = true;
        const originalText = btnSend.innerHTML;
        btnSend.innerHTML = `<svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="16"></circle></svg> Sending...`;

        const responseCodeEl = document.querySelector('#code-response code');

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);

            const apiKey = currentApiKey || 'tl_live_preview_key';
            const res = await fetch('/api/v1/escrows', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey
                },
                body: JSON.stringify({
                    amount: 450.00,
                    description: "Jordan 4 Retro Sneakers",
                    currency: "GHS"
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            const status = res.status;
            const resText = await res.text();
            let parsedJson;
            try { parsedJson = JSON.parse(resText); } catch(e) { parsedJson = resText; }

            if (responseCodeEl) {
                responseCodeEl.textContent = `// HTTP Status: ${status}\n` + JSON.stringify(parsedJson, null, 2);
            }
        } catch (err) {
            if (responseCodeEl) {
                responseCodeEl.textContent = `// Developer Preview / Beta Mode Notice\n{\n  "status": "DEVELOPER_PREVIEW",\n  "message": "Live sandbox requests will connect directly to /api/v1/escrows upon backend deployment.",\n  "error": ${JSON.stringify(err.message || "Endpoint not reachable")}\n}`;
            }
        } finally {
            btnSend.disabled = false;
            btnSend.innerHTML = originalText;
            const responseTab = document.querySelector('.code-tabs .tab-btn[data-code-tab="response"]');
            if (responseTab) responseTab.click();
        }
    });
}

// Copy Code Button
const btnCopy = document.getElementById('btn-copy-code');
if (btnCopy) {
    btnCopy.addEventListener('click', () => {
        const activeCodeArea = document.querySelector('.code-area.active code');
        if (activeCodeArea) {
            navigator.clipboard.writeText(activeCodeArea.innerText).then(() => {
                const originalText = btnCopy.innerHTML;
                btnCopy.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Copied!`;
                btnCopy.style.color = '#22C55E';

                setTimeout(() => {
                    btnCopy.innerHTML = originalText;
                    btnCopy.style.color = '';
                }, 2000);
            });
        }
    });
}

const style = document.createElement('style');
style.textContent = `
@keyframes spin { 100% { transform: rotate(360deg); } }
@keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
`;
document.head.appendChild(style);
