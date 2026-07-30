import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// --- Authentication Guard ---
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        // Redirect if not logged in
        window.location.href = 'login.html';
    } else {
        // User is logged in, fetch their data
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
                const data = userDoc.data();
                
                // Update Sidebar User Profile
                document.getElementById('user-name').textContent = data.fullName || user.email.split('@')[0];
                document.getElementById('user-email').textContent = user.email;
                
                if (data.photoURL) {
                    const avatar = document.getElementById('sidebar-avatar');
                    avatar.style.backgroundImage = `url('${data.photoURL}')`;
                }

                // If user has generated an API key, update the headers mockup to show it
                if (data.apiKey) {
                    const apiKeyInputs = document.querySelectorAll('input.param-value');
                    apiKeyInputs.forEach(input => {
                        if (input.value === 'tl_live_your_api_key_here' || input.value === 'tl_live_your_api_key') {
                            input.value = data.apiKey;
                        }
                    });
                    
                    // Update code snippets too
                    const codeAreas = document.querySelectorAll('code');
                    codeAreas.forEach(code => {
                        code.innerHTML = code.innerHTML.replace('tl_live_your_api_key', data.apiKey);
                    });
                }
            }
        } catch (error) {
            console.error("Error fetching user data:", error);
        }
    }
});

// --- UI Interactivity ---

// Mobile Sidebar Toggle
const sidebar = document.getElementById('api-sidebar');
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileCloseBtn = document.getElementById('mobile-close');

mobileMenuBtn.addEventListener('click', () => {
    sidebar.classList.add('open');
});

mobileCloseBtn.addEventListener('click', () => {
    sidebar.classList.remove('open');
});

// Close sidebar on mobile when clicking outside
document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768) {
        if (!sidebar.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
            sidebar.classList.remove('open');
        }
    }
});

// Request Config Tabs (Body, Headers, Auth)
const configTabs = document.querySelectorAll('.tabs-header .tab-btn');
const configContents = document.querySelectorAll('.request-card .tab-content');

configTabs.forEach(tab => {
    if(tab.closest('.code-tabs')) return; // skip code panel tabs
    
    tab.addEventListener('click', () => {
        // Remove active class from all
        configTabs.forEach(t => t.classList.remove('active'));
        configContents.forEach(c => c.classList.remove('active'));
        
        // Add active class to clicked tab and corresponding content
        tab.classList.add('active');
        const targetId = `tab-${tab.dataset.tab}`;
        document.getElementById(targetId).classList.add('active');
    });
});

// Code / Response Tabs
const codeTabs = document.querySelectorAll('.code-tabs .tab-btn');
const codeAreas = document.querySelectorAll('.code-area');

codeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        // Remove active class from all
        codeTabs.forEach(t => t.classList.remove('active'));
        codeAreas.forEach(c => c.classList.remove('active'));
        
        // Add active class to clicked tab
        tab.classList.add('active');
        const targetId = `code-${tab.dataset.codeTab}`;
        document.getElementById(targetId).classList.add('active');
    });
});

// Send Test Request Button Logic (Mock UI for now)
const btnSend = document.getElementById('btn-send-test');
btnSend.addEventListener('click', () => {
    btnSend.innerHTML = `<svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="16"></circle></svg> Sending...`;
    
    setTimeout(() => {
        btnSend.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Send Request`;
        
        // Switch to Response tab automatically
        document.querySelector('.code-tabs .tab-btn[data-code-tab="response"]').click();
        
        // Show a little success toast
        const toast = document.createElement('div');
        toast.textContent = "Request successful! Check the response panel.";
        toast.style.position = 'fixed';
        toast.style.bottom = '20px';
        toast.style.right = '20px';
        toast.style.background = '#0F172A';
        toast.style.color = '#FFF';
        toast.style.padding = '12px 24px';
        toast.style.borderRadius = '8px';
        toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
        toast.style.zIndex = '1000';
        toast.style.animation = 'fadeUp 0.3s ease';
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }, 800);
});

// Copy Code Button
const btnCopy = document.getElementById('btn-copy-code');
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

// CSS for animations
const style = document.createElement('style');
style.textContent = `
@keyframes spin { 100% { transform: rotate(360deg); } }
@keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
`;
document.head.appendChild(style);
