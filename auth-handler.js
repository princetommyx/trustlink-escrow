import { auth, db } from "./firebase-config.js";
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    onAuthStateChanged,
    signOut,
    GoogleAuthProvider,
    signInWithPopup
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
    const isAuthPage = window.location.pathname.includes("login.html") || window.location.pathname.includes("signup.html");
    
    if (user) {
        // If user visits login/signup while already logged in, redirect them
        if (isAuthPage && !sessionStorage.getItem("justAuth")) {
            window.location.href = "index.html"; 
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
                        <a href="#" class="dropdown-item">Dashboard (Coming Soon)</a>
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

// Handle Signup
const signupForm = document.querySelector("form.auth-form");
if (signupForm && window.location.pathname.includes("signup.html")) {
    signupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const name = document.getElementById("name").value;
        const email = document.getElementById("email").value;
        const password = document.getElementById("password").value;
        const confirmPassword = document.getElementById("confirm-password").value;
        const btn = document.querySelector(".auth-btn");

        if (password !== confirmPassword) {
            return showError("Passwords do not match.");
        }

        btn.disabled = true;
        btn.textContent = "SIGNING UP...";

        try {
            sessionStorage.setItem("justAuth", "true");
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            
            // Store additional user data in Firestore
            await setDoc(doc(db, "users", user.uid), {
                fullName: name,
                email: email,
                createdAt: new Date()
            });

            sessionStorage.setItem("authToast", "Account created successfully! Welcome to TrustLink.");
            window.location.href = "index.html";
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
        
        const email = document.getElementById("email").value;
        const password = document.getElementById("password").value;
        const btn = document.querySelector(".auth-btn");

        btn.disabled = true;
        btn.textContent = "SIGNING IN...";

        try {
            sessionStorage.setItem("justAuth", "true");
            await signInWithEmailAndPassword(auth, email, password);
            sessionStorage.setItem("authToast", "Successfully signed in! Welcome back.");
            window.location.href = "index.html";
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
            window.location.href = "index.html";
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
