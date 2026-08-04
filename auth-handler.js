import { auth, db, functionsApp, httpsCallable } from "./firebase-config.js";
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    onAuthStateChanged,
    signOut,
    GoogleAuthProvider,
    signInWithPopup,
    sendPasswordResetEmail,
    sendEmailVerification,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { startUserSession, clearUserSession } from "./session-manager.js";

// Global Toast Function
function showToast(message, isError = false) {
    let container = document.querySelector(".toast-container");
    if (!container) {
        container = document.createElement("div");
        container.className = "toast-container";
        document.body.appendChild(container);
    }
    
    const toast = document.createElement("div");
    toast.className = `toast ${isError ? 'toast-error' : ''}`;
    toast.innerHTML = `
        <span style="font-size: 20px;">${isError ? '❌' : '✅'}</span>
        <div>${message}</div>
    `;
    
    container.appendChild(toast);
    setTimeout(() => toast.classList.add("show"), 10);
    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

const pendingToast = sessionStorage.getItem("authToast");
const pendingToastIsError = sessionStorage.getItem("authToastIsError") === "true";
if (pendingToast) {
    showToast(pendingToast, pendingToastIsError);
    sessionStorage.removeItem("authToast");
    sessionStorage.removeItem("authToastIsError");
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
            
            navLinks.innerHTML = `
                <a href="index.html">Home</a>
                <a href="dashboard.html">Dashboard</a>
                <a href="#" id="nav-logout-btn" style="color: #ef4444;">Logout (${displayName})</a>
            `;
            
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
                
                const requestOtp = httpsCallable(functionsApp, 'requestPhoneVerificationOtp');
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

// Handle Google Sign In
const googleBtn = document.getElementById("google-signin-btn") || document.getElementById("google-auth-btn");
if (googleBtn) {
    googleBtn.addEventListener("click", async () => {
        const provider = new GoogleAuthProvider();
        const rememberMe = document.getElementById("remember-me")?.checked === true;
        try {
            sessionStorage.setItem("justAuth", "true");
            
            // Set persistence explicitly based on Remember Me choice
            await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);

            const result = await signInWithPopup(auth, provider);
            const user = result.user;
            const userRef = doc(db, "users", user.uid);
            const userSnap = await getDoc(userRef);
            let isAdmin = (user.email === "admin@trustlink.com" || user.email === "test@trustlink.com");
            if (!userSnap.exists()) {
                await setDoc(userRef, {
                    fullName: user.displayName,
                    email: user.email,
                    createdAt: new Date(),
                    photoURL: user.photoURL
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
        } catch (error) {
            console.error("Google Auth error:", error);
            showError("Google Sign-In failed. Please try again.");
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
                    const verifyOtp = httpsCallable(functionsApp, 'verifyPhoneVerificationOtp');
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
