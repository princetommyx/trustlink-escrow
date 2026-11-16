import { auth, db } from "./firebase-config.js";
import { callApi } from "./api-client.js";
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    onAuthStateChanged,
    signOut,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    sendPasswordResetEmail,
    sendEmailVerification,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, setDoc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { startUserSession, clearUserSession } from "./session-manager.js";

// Helper for XSS safe text escaping
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Helper to strip any emojis from toast text
function stripEmojis(text) {
    if (!text) return '';
    return String(text)
        .replace(/\p{Extended_Pictographic}/gu, '')
        .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2300}-\u{23FF}\u{2B50}\u{200D}\u{FE0F}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Global Modern Toast Function for Auth Pages
export function showModernToast(title, message = "", type = "success") {
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
        <button class="modern-toast-close" type="button" aria-label="Close notification">&times;</button>
        <div class="modern-toast-progress"></div>
    `;

    const closeBtn = toast.querySelector(".modern-toast-close");
    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            toast.classList.remove("show");
            toast.classList.add("hide");
            setTimeout(() => { if (toast.parentElement) toast.remove(); }, 400);
        });
    }

    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add("show");
    });

    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.remove("show");
            toast.classList.add("hide");
            setTimeout(() => {
                if (toast.parentElement) toast.remove();
            }, 400);
        }
    }, 4500);
}
window.showModernToast = showModernToast;

// Global Toast Function (backwards compatibility)
function showToast(message, isError = false) {
    showModernToast(isError ? "Error" : "Notice", message, isError ? "error" : "success");
}

const pendingToast = sessionStorage.getItem("authToast");
const pendingToastType = sessionStorage.getItem("authToastType") || (sessionStorage.getItem("authToastIsError") === "true" ? "error" : "success");
if (pendingToast) {
    showModernToast(pendingToast, pendingToastType);
    sessionStorage.removeItem("authToast");
    sessionStorage.removeItem("authToastIsError");
    sessionStorage.removeItem("authToastType");
}

// Handle URL query parameters for deactivation or deletion confirmation
const authUrlParams = new URLSearchParams(window.location.search);
if (authUrlParams.get("deactivated") === "true") {
    showModernToast("Account Deactivated", "Your account has been deactivated. Sign back in anytime to reactivate.", "info");
} else if (authUrlParams.get("deleted") === "true") {
    showModernToast("Account Deleted", "Your account and all associated data have been permanently removed.", "success");
}

// Listen to auth state
onAuthStateChanged(auth, async (user) => {
    const isAuthPage = window.location.pathname.includes("login.html") || window.location.pathname.includes("signup.html") || window.location.pathname.includes("verify.html");
    
    if (user) {
        if (isAuthPage && !sessionStorage.getItem("justAuth")) {
            let isAdmin = false;
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (!userDoc.exists()) {
                    await setDoc(doc(db, "users", user.uid), {
                        fullName: user.displayName || user.email.split('@')[0],
                        email: user.email,
                        lastLoginAt: new Date()
                    });
                } else {
                    const data = userDoc.data();
                    if (data.role === "admin" || data.role === "support") isAdmin = true;

                    // Automatically reactivate deactivated account upon successful login
                    if (data.accountStatus === "deactivated" || data.isDeactivated) {
                        await updateDoc(doc(db, "users", user.uid), {
                            accountStatus: "active",
                            isDeactivated: false,
                            reactivatedAt: new Date()
                        });
                        sessionStorage.setItem("authToast", "Welcome back! Your account has been reactivated.");
                        sessionStorage.setItem("authToastIsError", "false");
                    }
                }
            } catch(e) {
                console.error("Error checking user doc:", e);
            }
            
            if (user.email === "admin@trustlink.com" || user.email === "test@trustlink.com") {
                isAdmin = true;
            }

            if (isAdmin) {
                window.location.href = "admin-dashboard.html"; 
            } else {
                window.location.href = "dashboard.html"; 
            }
        }
        
        const navLinks = document.querySelector(".nav-links");
        if (navLinks && !isAuthPage) {
            let displayName = user.email.split('@')[0];
            try {
                const docSnap = await getDoc(doc(db, "users", user.uid));
                if (docSnap.exists() && docSnap.data().fullName) {
                    displayName = docSnap.data().fullName;
                }
            } catch(e) {}
            
            // Seamlessly update CTA group without destroying Solutions/Company dropdowns
            const navCtaGroup = document.querySelector(".nav-cta-group");
            if (navCtaGroup) {
                navCtaGroup.innerHTML = `
                    <a href="dashboard.html" class="btn-nav-transact">
                        Dashboard <span class="btn-arrow">&rarr;</span>
                    </a>
                    <a href="#" id="nav-logout-btn" class="btn-nav-contact" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.3);">
                        Logout (${displayName})
                    </a>
                `;
            }

            // Update login link in dropdown menu if present
            const dropdownLoginLink = document.querySelector('.dropdown-menu a[href="login.html"]');
            if (dropdownLoginLink) {
                dropdownLoginLink.href = "dashboard.html";
                const title = dropdownLoginLink.querySelector(".item-title");
                const desc = dropdownLoginLink.querySelector(".item-desc");
                if (title) title.textContent = "Dashboard";
                if (desc) desc.textContent = `Signed in as ${displayName}`;
            }
            
            const logoutBtn = document.getElementById("nav-logout-btn");
            if (logoutBtn) {
                logoutBtn.addEventListener("click", async (e) => {
                    e.preventDefault();
                    clearUserSession();
                    await signOut(auth);
                    window.location.href = "index.html";
                });
            }
        }
    }
});

// Utility to distinguish email from Ghanaian phone number
function normalizeIdentifier(val) {
    val = val.trim();
    if (val.includes("@")) return val;
    let digits = val.replace(/\D/g, '');
    if (digits.startsWith("0")) {
        digits = "233" + digits.substring(1);
    }
    return `${digits}@phone.trustlink.app`;
}

function showError(msg) {
    let errDiv = document.querySelector(".auth-error-msg");
    if (!errDiv) {
        errDiv = document.createElement("div");
        errDiv.className = "auth-error-msg";
        errDiv.setAttribute("role", "alert");
        errDiv.setAttribute("aria-live", "assertive");
        errDiv.style.cssText = "color: #ef4444; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); padding: 10px; border-radius: 8px; margin-bottom: 15px; font-size: 0.85rem; text-align: center;";
        const form = document.querySelector(".auth-form");
        if (form) form.insertBefore(errDiv, form.children[2]);
    }
    errDiv.textContent = msg;
    errDiv.style.display = "block";
}

// Handle Signup Form
const signupForm = document.getElementById("signup-form");
if (signupForm) {
    signupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const name = document.getElementById("name").value;
        const rawEmailOrPhone = document.getElementById("email").value;
        const email = normalizeIdentifier(rawEmailOrPhone);
        const password = document.getElementById("password").value;
        const btn = document.querySelector(".auth-btn");

        btn.disabled = true;
        btn.textContent = "VERIFYING...";

        try {
            if (email.endsWith("@phone.trustlink.app")) {
                const phone = rawEmailOrPhone.replace(/\D/g, '');
                
                const requestOtp = callApi('requestPhoneVerificationOtp');
                await requestOtp({ phone });
                
                sessionStorage.setItem("pendingSignup", JSON.stringify({
                    type: "phone",
                    name, email, rawEmailOrPhone, password
                }));
                window.location.href = "verify.html";
                return;
            } else {
                sessionStorage.setItem("justAuth", "true");
                const rememberMe = document.getElementById("remember-me")?.checked === true;
                await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);

                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;
                
                const isAdmin = (email === "admin@trustlink.com" || email === "test@trustlink.com");
                
                if (!isAdmin) {
                    await sendEmailVerification(user);
                }
                
                await setDoc(doc(db, "users", user.uid), {
                    fullName: name,
                    email: email,
                    originalIdentifier: rawEmailOrPhone,
                    createdAt: new Date(),
                    phoneVerified: false
                });

                startUserSession({ rememberMe, userType: isAdmin ? 'admin' : 'user' });

                sessionStorage.setItem("authToast", "Account created successfully!");
                if (isAdmin) {
                    window.location.href = "admin-dashboard.html";
                } else {
                    window.location.href = "dashboard.html";
                }
            }
        } catch (error) {
            console.error("Signup error:", error);
            showError(error.message || "Failed to create account.");
            btn.disabled = false;
            btn.textContent = "Create account";
        }
    });
}

// Handle Login Form
const loginForm = document.getElementById("login-form");
if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const rawEmailOrPhone = document.getElementById("email").value;
        const email = normalizeIdentifier(rawEmailOrPhone);
        const password = document.getElementById("password").value;
        const rememberMe = document.getElementById("remember-me")?.checked === true;
        const btn = document.querySelector(".auth-btn");

        btn.disabled = true;
        btn.textContent = "SIGNING IN...";

        try {
            sessionStorage.setItem("justAuth", "true");
            
            // Set persistence explicitly based on Remember Me choice
            await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);

            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            let isAdmin = (email === "admin@trustlink.com" || email === "test@trustlink.com");
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists()) {
                    const data = userDoc.data();
                    if (data.role === "admin" || data.role === "support") isAdmin = true;
                }
            } catch(e) {}

            startUserSession({ rememberMe, userType: isAdmin ? 'admin' : 'user' });

            sessionStorage.setItem("authToast", "Welcome back!");
            if (isAdmin) {
                window.location.href = "admin-dashboard.html";
            } else {
                window.location.href = "dashboard.html";
            }
        } catch (error) {
            console.error("Login error:", error);
            showError("Invalid login credentials. Please check email/phone and password.");
            btn.disabled = false;
            btn.textContent = "Sign in";
        }
    });
}

// Helper to finalize Google user sign in
async function processGoogleUser(user, rememberMe = true) {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    let isAdmin = (user.email === "admin@trustlink.com" || user.email === "test@trustlink.com");
    if (!userSnap.exists()) {
        await setDoc(userRef, {
            fullName: user.displayName || (user.email ? user.email.split('@')[0] : 'User'),
            email: user.email,
            createdAt: new Date(),
            photoURL: user.photoURL || ''
        });
    } else {
        const data = userSnap.data();
        if (data.role === "admin" || data.role === "support") isAdmin = true;
    }
    
    startUserSession({ rememberMe, userType: isAdmin ? 'admin' : 'user' });

    sessionStorage.setItem("authToast", "Signed in with Google!");
    if (isAdmin) {
        window.location.href = "admin-dashboard.html";
    } else {
        window.location.href = "dashboard.html";
    }
}

// Handle Google Sign In
const googleBtn = document.getElementById("google-signin-btn") || document.getElementById("google-auth-btn");
if (googleBtn) {
    googleBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        
        // Immediate user feedback: Toast + Button Loading state
        showModernToast("Connecting to Google...", "Opening Google Sign-In popup. Please select your Google account.", "info");
        
        const origContent = googleBtn.innerHTML;
        googleBtn.style.pointerEvents = "none";
        googleBtn.style.opacity = "0.75";
        googleBtn.classList.add("loading-pulse");

        const resetBtn = () => {
            googleBtn.style.pointerEvents = "auto";
            googleBtn.style.opacity = "1";
            googleBtn.classList.remove("loading-pulse");
            googleBtn.innerHTML = origContent;
        };

        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        const rememberMe = document.getElementById("remember-me")?.checked !== false;
        
        sessionStorage.setItem("justAuth", "true");
        
        try {
            // Trigger popup IMMEDIATELY to avoid browser popup blockers
            const result = await signInWithPopup(auth, provider);
            
            // Set persistence in background
            setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence).catch(() => {});
            
            if (result && result.user) {
                showModernToast("Signed in with Google!", "Welcome! Redirecting to your dashboard...", "success");
                await processGoogleUser(result.user, rememberMe);
            } else {
                resetBtn();
            }
        } catch (error) {
            console.warn("Google Auth popup event:", error.code, error.message);
            resetBtn();
            
            // User manually closed the popup
            if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
                showModernToast("Sign-In Cancelled", "Google Sign-In was closed. Tap Google icon again to retry.", "info");
                return;
            }
            
            // If popup was blocked or unsupported, fallback to redirect
            if (error.code === 'auth/popup-blocked' || error.code === 'auth/operation-not-supported-in-this-environment') {
                showModernToast("Redirecting to Google...", "Popup was blocked by your browser. Redirecting you to Google...", "info");
                try {
                    await signInWithRedirect(auth, provider);
                    return;
                } catch (redirectErr) {
                    console.error("Google Auth redirect error:", redirectErr);
                }
            }
            
            showModernToast("Sign-In Failed", error.message || "Google Sign-In failed. Please try again.", "error");
            showError(error.message || "Google Sign-In failed. Please try again.");
        }
    });
}

// Check for redirect result on auth pages (handles mobile redirect sign-ins)
if (window.location.pathname.includes("login.html") || window.location.pathname.includes("signup.html")) {
    getRedirectResult(auth).then(async (result) => {
        if (result && result.user) {
            sessionStorage.setItem("justAuth", "true");
            await processGoogleUser(result.user, true);
        }
    }).catch((err) => {
        if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
            console.warn("Google redirect check:", err);
        }
    });
}

// Handle Password Reset
const resetForm = document.getElementById("reset-form");
if (resetForm) {
    resetForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("email").value;
        const btn = document.querySelector(".auth-btn");
        btn.disabled = true;
        btn.textContent = "SENDING...";

        try {
            await sendPasswordResetEmail(auth, email);
            showToast("Password reset link sent to your email!");
            setTimeout(() => {
                window.location.href = "login.html";
            }, 2000);
        } catch (error) {
            showError(error.message);
            btn.disabled = false;
            btn.textContent = "SEND RESET LINK";
        }
    });
}

// Handle Verify Page
const verifyForm = document.getElementById("verify-form");
if (verifyForm && window.location.pathname.includes("verify.html")) {
    const pendingDataStr = sessionStorage.getItem("pendingSignup");
    if (!pendingDataStr) {
        window.location.href = "signup.html";
    } else {
        const pendingData = JSON.parse(pendingDataStr);

        const phoneSection = document.getElementById("phone-verification-section");
        const emailSection = document.getElementById("email-verification-section");
        const title = document.getElementById("verify-title");
        const subtitle = document.getElementById("verify-subtitle");

        if (pendingData.type === "phone") {
            phoneSection.style.display = "block";
            title.textContent = "Verify Phone Number";
            subtitle.textContent = `We sent a 6-digit verification code via SMS to ${pendingData.rawEmailOrPhone}.`;
            
            const verifyBtn = document.getElementById("verify-otp-btn");
            const otpInput = document.getElementById("otp-input");
            const otpError = document.getElementById("otp-error");

            verifyBtn.addEventListener("click", async (e) => {
                e.preventDefault();
                verifyBtn.disabled = true;
                verifyBtn.textContent = "VERIFYING...";
                otpError.style.display = "none";

                try {
                    const verifyOtp = callApi('verifyPhoneVerificationOtp');
                    const res = await verifyOtp({
                        phone: pendingData.rawEmailOrPhone,
                        otpCode: otpInput.value.trim()
                    });

                    if (res.data && res.data.verified) {
                        sessionStorage.setItem("justAuth", "true");
                        const userCredential = await createUserWithEmailAndPassword(auth, pendingData.email, pendingData.password);
                        const user = userCredential.user;
                        
                        await setDoc(doc(db, "users", user.uid), {
                            fullName: pendingData.name,
                            email: pendingData.email,
                            originalIdentifier: pendingData.rawEmailOrPhone,
                            createdAt: new Date(),
                            phoneVerified: true
                        });
                        
                        startUserSession({ rememberMe: false, userType: 'user' });
                        sessionStorage.removeItem("pendingSignup");
                        sessionStorage.setItem("authToast", "Phone verified! Account created successfully.");
                        window.location.href = "dashboard.html";
                    } else {
                        throw new Error("Verification failed.");
                    }
                } catch (error) {
                    console.error("OTP verification error:", error);
                    otpError.textContent = error.message || "Invalid code. Please try again.";
                    otpError.style.display = "block";
                    verifyBtn.disabled = false;
                    verifyBtn.textContent = "VERIFY CODE";
                }
            });

            document.getElementById("cancel-verify").addEventListener("click", () => {
                sessionStorage.removeItem("pendingSignup");
            });

        } else {
            emailSection.style.display = "block";
            title.textContent = "Verify Your Email";
            subtitle.textContent = `Check your inbox for ${pendingData.email}.`;

            document.getElementById("check-email-btn").addEventListener("click", () => {
                sessionStorage.setItem("authToast", "Please login once you've clicked the email link.");
                window.location.href = "login.html";
            });
        }
    }
}
