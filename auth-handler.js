import { auth, db } from "./firebase-config.js";
import { sendMoolreOTP } from "./moolre-service.js";
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    onAuthStateChanged,
    signOut,
    GoogleAuthProvider,
    signInWithPopup,
    sendPasswordResetEmail,
    sendEmailVerification
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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
    
    // Trigger animation
    setTimeout(() => toast.classList.add("show"), 10);
    
    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Check for pending toasts on load
const pendingToast = sessionStorage.getItem("authToast");
if (pendingToast) {
    showToast(pendingToast);
    sessionStorage.removeItem("authToast");
}

// Listen to auth state
onAuthStateChanged(auth, async (user) => {
    const isAuthPage = window.location.pathname.includes("login.html") || window.location.pathname.includes("signup.html") || window.location.pathname.includes("verify.html");
    
    if (user) {
        // If user visits login/signup while already logged in, redirect them
        if (isAuthPage && !sessionStorage.getItem("justAuth")) {
            if (user.email === "admin@trustlink.com" || user.email === "test@trustlink.com") {
                window.location.href = "admin-dashboard.html"; 
            } else {
                window.location.href = "dashboard.html"; 
            }
        }
        
        // If on a main page with navbar, update the navbar to show Profile
        const navLinks = document.querySelector(".nav-links");
        if (navLinks && !isAuthPage) {
            // Default to email name or 'Profile'
            let displayName = user.email.split('@')[0];
            
            // Try to fetch full name from Firestore
            try {
                const docSnap = await getDoc(doc(db, "users", user.uid));
                if (docSnap.exists() && docSnap.data().fullName) {
                    displayName = docSnap.data().fullName;
                }
            } catch(e) {
                console.log("Could not fetch user profile", e);
            }
            
            // Update UI
            // Find existing auth buttons
            const loginBtn = navLinks.querySelector(".btn-secondary");
            const signupBtn = navLinks.querySelector(".btn-primary");
            
            if (loginBtn) loginBtn.style.display = "none";
            if (signupBtn) signupBtn.style.display = "none";
            
            // Check if profile menu already exists to prevent duplicates
            if (!navLinks.querySelector(".profile-menu")) {
                const profileMenu = document.createElement("div");
                profileMenu.className = "profile-menu";
                profileMenu.innerHTML = `
                    <button class="profile-btn">
                        <div class="avatar" style="width: 24px; height: 24px; margin: 0; background: linear-gradient(135deg, var(--primary), var(--secondary));"></div>
                        ${displayName}
                    </button>
                    <div class="profile-dropdown">
                        <a href="dashboard.html" class="dropdown-item">Dashboard</a>
                        <a href="#" class="dropdown-item">Settings</a>
                        <hr style="border-color: var(--surface-border); margin: 5px 0;">
                        <button class="dropdown-item danger" id="sign-out-btn">Sign Out</button>
                    </div>
                `;
                navLinks.appendChild(profileMenu);
                
                document.getElementById("sign-out-btn").addEventListener("click", async () => {
                    await signOut(auth);
                    sessionStorage.setItem("authToast", "Successfully signed out.");
                    window.location.reload();
                });
            }
        }
    } else {
        // User is signed out, make sure buttons are visible if on main page
        const navLinks = document.querySelector(".nav-links");
        if (navLinks && !isAuthPage) {
            const loginBtn = navLinks.querySelector(".btn-secondary");
            const signupBtn = navLinks.querySelector(".btn-primary");
            if (loginBtn) loginBtn.style.display = "inline-flex";
            if (signupBtn) signupBtn.style.display = "inline-flex";
            
            const profileMenu = navLinks.querySelector(".profile-menu");
            if (profileMenu) profileMenu.remove();
        }
    }
});

// Helper to show inline errors on forms
function showError(message) {
    let errorDiv = document.getElementById("auth-error");
    if (!errorDiv) {
        errorDiv = document.createElement("div");
        errorDiv.id = "auth-error";
        errorDiv.style.color = "#ef4444";
        errorDiv.style.fontSize = "0.9rem";
        errorDiv.style.marginBottom = "16px";
        errorDiv.style.textAlign = "center";
        
        const formOptions = document.querySelector(".form-options");
        if (formOptions) {
            formOptions.parentElement.insertBefore(errorDiv, formOptions);
        } else {
            const btn = document.querySelector(".auth-btn");
            if(btn) btn.parentElement.insertBefore(errorDiv, btn);
        }
    }
    errorDiv.textContent = message;
}

// Helper to normalize email or phone number input
function normalizeIdentifier(input) {
    input = input.trim();
    if (input.includes('@')) {
        return input;
    }
    // If no @, treat as phone number, strip non-digits and append domain
    const normalized = input.replace(/\D/g, '');
    if (normalized.length > 0) {
        return `${normalized}@phone.trustlink.app`;
    }
    return `${input}@phone.trustlink.app`;
}

// Handle Signup
const signupForm = document.querySelector("form.auth-form");
if (signupForm && window.location.pathname.includes("signup.html")) {
    signupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const name = document.getElementById("name").value;
        const rawEmailOrPhone = document.getElementById("email").value;
        const email = normalizeIdentifier(rawEmailOrPhone);
        const password = document.getElementById("password").value;
        const confirmPassword = document.getElementById("confirm-password").value;
        const btn = document.querySelector(".auth-btn");

        if (password !== confirmPassword) {
            return showError("Passwords do not match.");
        }

        btn.disabled = true;
        btn.textContent = "VERIFYING...";

        try {
            if (email.endsWith("@phone.trustlink.app")) {
                const phone = rawEmailOrPhone.replace(/\D/g, '');
                const generatedOtp = Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit OTP
                
                await sendMoolreOTP(phone, generatedOtp);
                
                // Store pending data and redirect
                sessionStorage.setItem("pendingSignup", JSON.stringify({
                    type: "phone",
                    name, email, rawEmailOrPhone, password, otp: generatedOtp
                }));
                window.location.href = "verify.html";
                return;
            } else {
                // Email signup
                sessionStorage.setItem("justAuth", "true");
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;
                
                const isAdmin = (email === "admin@trustlink.com" || email === "test@trustlink.com");
                
                if (!isAdmin) {
                    await sendEmailVerification(user);
                }
                
                // Store additional user data in Firestore
                await setDoc(doc(db, "users", user.uid), {
                    fullName: name,
                    email: email,
                    originalIdentifier: rawEmailOrPhone,
                    createdAt: new Date(),
                    emailVerified: isAdmin ? true : false,
                    role: isAdmin ? "admin" : "user"
                });

                if (isAdmin) {
                    window.location.href = "admin-dashboard.html";
                    return;
                }

                // Store pending state for redirect
                sessionStorage.setItem("pendingSignup", JSON.stringify({ type: "email" }));
                window.location.href = "verify.html";
                return;
            }
        } catch (error) {
            showError(error.message);
            btn.disabled = false;
            btn.textContent = "SIGN UP";
            sessionStorage.removeItem("justAuth");
        }
    });
}

// Handle Login
const loginForm = document.querySelector("form.auth-form");
if (loginForm && window.location.pathname.includes("login.html")) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const rawEmailOrPhone = document.getElementById("email").value;
        const email = normalizeIdentifier(rawEmailOrPhone);
        const password = document.getElementById("password").value;
        const btn = document.querySelector(".auth-btn");

        btn.disabled = true;
        btn.textContent = "SIGNING IN...";

        try {
            sessionStorage.setItem("justAuth", "true");
            await signInWithEmailAndPassword(auth, email, password);
            sessionStorage.setItem("authToast", "Successfully signed in! Welcome back.");
            
            if (email === "admin@trustlink.com" || email === "test@trustlink.com") {
                window.location.href = "admin-dashboard.html";
            } else {
                window.location.href = "dashboard.html";
            }
        } catch (error) {
            showError("Invalid email or password.");
            btn.disabled = false;
            btn.textContent = "SIGN IN";
            sessionStorage.removeItem("justAuth");
        }
    });
}

// Handle Google Auth
const googleBtn = document.getElementById("google-auth-btn");
if (googleBtn) {
    googleBtn.addEventListener("click", async () => {
        try {
            googleBtn.disabled = true;
            googleBtn.innerHTML = "Please wait...";
            
            // Set justAuth before to prevent onAuthStateChanged from firing a redirect early
            sessionStorage.setItem("justAuth", "true");
            
            const provider = new GoogleAuthProvider();
            const result = await signInWithPopup(auth, provider);
            const user = result.user;
            
            // Store or update user in Firestore
            await setDoc(doc(db, "users", user.uid), {
                fullName: user.displayName || user.email.split('@')[0],
                email: user.email,
                lastLoginAt: new Date()
            }, { merge: true });
            
            sessionStorage.setItem("authToast", `Welcome back, ${user.displayName || 'there'}!`);
            window.location.href = "dashboard.html";
        } catch (error) {
            console.error(error);
            showError(error.message);
            googleBtn.disabled = false;
            sessionStorage.removeItem("justAuth");
            // The text differs slightly between login/signup but this is fine as a generic reset
            googleBtn.innerHTML = '<img src="img/google.svg" alt="Google" class="google-icon"> Continue with Google';
        }
    });
}

// Handle Password Reset
const resetForm = document.querySelector("form.reset-form");
if (resetForm && window.location.pathname.includes("reset-password.html")) {
    resetForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const rawEmailOrPhone = document.getElementById("reset-email").value;
        const email = normalizeIdentifier(rawEmailOrPhone);
        const btn = document.querySelector(".auth-btn");

        btn.disabled = true;
        btn.textContent = "SENDING...";

        try {
            await sendPasswordResetEmail(auth, email);
            sessionStorage.setItem("authToast", "Password reset email sent! Check your inbox.");
            window.location.href = "login.html";
        } catch (error) {
            let msg = "Failed to send reset email. Please try again.";
            if (error.code === 'auth/user-not-found') {
                msg = "No account found with this email address or phone number.";
            } else if (error.code === 'auth/invalid-email') {
                msg = "Please enter a valid email address or phone number.";
            }
            showError(msg);
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
            subtitle.textContent = `We sent a 4-digit code to ${pendingData.rawEmailOrPhone}.`;
            
            const verifyBtn = document.getElementById("verify-otp-btn");
            const otpInput = document.getElementById("otp-input");
            const otpError = document.getElementById("otp-error");

            verifyBtn.addEventListener("click", async (e) => {
                e.preventDefault();
                if (otpInput.value === pendingData.otp) {
                    verifyBtn.disabled = true;
                    verifyBtn.textContent = "VERIFYING...";
                    
                    try {
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
                        
                        sessionStorage.removeItem("pendingSignup");
                        sessionStorage.setItem("authToast", "Phone verified! Account created successfully.");
                        window.location.href = "dashboard.html";
                    } catch (error) {
                        showError(error.message);
                        verifyBtn.disabled = false;
                        verifyBtn.textContent = "VERIFY CODE";
                    }
                } else {
                    otpError.style.display = "block";
                }
            });

        } else if (pendingData.type === "email") {
            emailSection.style.display = "block";
            title.textContent = "Verify Email Address";
            subtitle.style.display = "none";
            
            const checkEmailBtn = document.getElementById("check-email-btn");
            checkEmailBtn.addEventListener("click", async (e) => {
                e.preventDefault();
                checkEmailBtn.disabled = true;
                checkEmailBtn.textContent = "CHECKING...";
                
                if (auth.currentUser) {
                    await auth.currentUser.reload();
                    if (auth.currentUser.emailVerified) {
                        sessionStorage.removeItem("pendingSignup");
                        sessionStorage.setItem("authToast", "Email verified! Account created successfully.");
                        window.location.href = "dashboard.html";
                    } else {
                        showError("Email not verified yet. Please check your inbox and click the link.");
                        checkEmailBtn.disabled = false;
                        checkEmailBtn.textContent = "I'VE VERIFIED MY EMAIL";
                    }
                } else {
                    window.location.href = "login.html";
                }
            });
        }
    }
}
