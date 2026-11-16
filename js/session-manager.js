/**
 * TrustLink Escrow Session Manager
 * Handles client-side idle timeouts, "Remember Me" lifecycle,
 * cross-tab synchronization, and secure session termination.
 */

import { signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

export const SESSION_KEYS = {
    LAST_ACTIVE: 'trustlink_last_active',
    SESSION_START: 'trustlink_session_start',
    REMEMBER_ME: 'trustlink_remember_me',
    USER_TYPE: 'trustlink_user_type',
    LOGOUT_BROADCAST: 'trustlink_logout_broadcast'
};

// Timeout configurations in milliseconds
export const SESSION_CONFIG = {
    USER_IDLE_TIMEOUT: 30 * 60 * 1000,          // 30 minutes of idle inactivity
    USER_REMEMBERED_IDLE: 2 * 60 * 60 * 1000,    // 2 hours of idle inactivity if Remember Me
    USER_MAX_LIFETIME: 24 * 60 * 60 * 1000,      // 24 hours absolute max session lifetime
    ADMIN_IDLE_TIMEOUT: 15 * 60 * 1000,         // 15 minutes of idle inactivity for admins
    ADMIN_REMEMBERED_IDLE: 30 * 60 * 1000,       // 30 minutes of idle inactivity if Remember Me
    ADMIN_MAX_LIFETIME: 12 * 60 * 60 * 1000,     // 12 hours absolute max session lifetime
    WARNING_BEFORE_MS: 60 * 1000,               // Show warning 60 seconds before expiration
    ACTIVITY_THROTTLE_MS: 10 * 1000,            // Throttle activity updates to once per 10s
    CHECK_INTERVAL_MS: 15 * 1000                // Check session health every 15s
};

let trackerInterval = null;
let lastRecordedTime = 0;
let isWarningShown = false;
let warningModalEl = null;

/**
 * Starts or updates a fresh session in localStorage
 */
export function startUserSession({ rememberMe = false, userType = 'user' } = {}) {
    const now = Date.now();
    localStorage.setItem(SESSION_KEYS.SESSION_START, now.toString());
    localStorage.setItem(SESSION_KEYS.LAST_ACTIVE, now.toString());
    localStorage.setItem(SESSION_KEYS.REMEMBER_ME, rememberMe ? 'true' : 'false');
    localStorage.setItem(SESSION_KEYS.USER_TYPE, userType);
}

/**
 * Records user activity (throttled)
 */
export function recordUserActivity() {
    const now = Date.now();
    if (now - lastRecordedTime > SESSION_CONFIG.ACTIVITY_THROTTLE_MS) {
        lastRecordedTime = now;
        localStorage.setItem(SESSION_KEYS.LAST_ACTIVE, now.toString());
        
        // If a warning was showing, dismiss it upon user activity
        if (isWarningShown) {
            dismissExpiryWarning();
        }
    }
}

/**
 * Clears all TrustLink session data and broadcasts logout to other tabs
 */
export function clearUserSession() {
    localStorage.removeItem(SESSION_KEYS.LAST_ACTIVE);
    localStorage.removeItem(SESSION_KEYS.SESSION_START);
    localStorage.removeItem(SESSION_KEYS.REMEMBER_ME);
    localStorage.removeItem(SESSION_KEYS.USER_TYPE);
    
    // Broadcast logout event so all other open tabs log out immediately
    try {
        localStorage.setItem(SESSION_KEYS.LOGOUT_BROADCAST, Date.now().toString());
    } catch (e) {}

    if (trackerInterval) {
        clearInterval(trackerInterval);
        trackerInterval = null;
    }
    dismissExpiryWarning();
}

/**
 * Calculates current idle timeout and max lifetime based on user type and Remember Me setting
 */
export function getSessionLimits(userType = 'user') {
    const isRemembered = localStorage.getItem(SESSION_KEYS.REMEMBER_ME) === 'true';
    if (userType === 'admin') {
        return {
            idleTimeout: isRemembered ? SESSION_CONFIG.ADMIN_REMEMBERED_IDLE : SESSION_CONFIG.ADMIN_IDLE_TIMEOUT,
            maxLifetime: SESSION_CONFIG.ADMIN_MAX_LIFETIME
        };
    }
    return {
        idleTimeout: isRemembered ? SESSION_CONFIG.USER_REMEMBERED_IDLE : SESSION_CONFIG.USER_IDLE_TIMEOUT,
        maxLifetime: SESSION_CONFIG.USER_MAX_LIFETIME
    };
}

/**
 * Displays a non-intrusive session expiration warning
 */
function showExpiryWarning(remainingSeconds, onKeepAlive) {
    if (isWarningShown) return;
    isWarningShown = true;

    warningModalEl = document.createElement('div');
    warningModalEl.id = 'session-warning-modal';
    warningModalEl.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 999999;
        background: #0f172a;
        color: #ffffff;
        border: 1px solid #334155;
        border-radius: 12px;
        padding: 16px 20px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        gap: 16px;
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        font-size: 0.9rem;
        max-width: 420px;
        animation: sessionSlideIn 0.3s ease-out;
    `;

    warningModalEl.innerHTML = `
        <div style="font-size: 1.5rem;">⏱️</div>
        <div style="flex: 1;">
            <div style="font-weight: 600; margin-bottom: 2px;">Session Expiring Soon</div>
            <div style="color: #94a3b8; font-size: 0.8rem;">You will be logged out in <span id="session-countdown">${remainingSeconds}</span>s due to inactivity.</div>
        </div>
        <button id="session-keepalive-btn" style="
            background: #2563eb;
            color: #ffffff;
            border: none;
            border-radius: 8px;
            padding: 8px 14px;
            font-size: 0.8rem;
            font-weight: 600;
            cursor: pointer;
            white-space: nowrap;
            transition: background 0.2s;
        ">Stay Logged In</button>
    `;

    document.body.appendChild(warningModalEl);

    const keepAliveBtn = warningModalEl.querySelector('#session-keepalive-btn');
    if (keepAliveBtn) {
        keepAliveBtn.addEventListener('click', () => {
            recordUserActivity();
            if (onKeepAlive) onKeepAlive();
            dismissExpiryWarning();
        });
    }
}

/**
 * Dismisses the expiration warning
 */
function dismissExpiryWarning() {
    isWarningShown = false;
    if (warningModalEl) {
        warningModalEl.remove();
        warningModalEl = null;
    }
}

/**
 * Handles session expiration, signs out from Firebase Auth, and redirects to login
 */
export async function handleSessionTimeout(auth, userType = 'user', message = "Your session has expired due to inactivity. Please log in again.") {
    clearUserSession();
    try {
        await signOut(auth);
    } catch (e) {
        console.warn("Sign out during timeout warning:", e);
    }

    sessionStorage.setItem("authToast", message);
    sessionStorage.setItem("authToastIsError", "true");

    const targetUrl = userType === 'admin' ? 'admin-login.html' : 'login.html';
    window.location.href = targetUrl;
}

/**
 * Initializes the session tracker on authenticated pages
 */
export function initSessionTracker({ auth, userType = 'user', redirectUrl = null } = {}) {
    if (!auth) return;

    // Ensure session start and last active exist
    const now = Date.now();
    const existingStart = localStorage.getItem(SESSION_KEYS.SESSION_START);
    const existingLastActive = localStorage.getItem(SESSION_KEYS.LAST_ACTIVE);

    if (!existingStart) {
        localStorage.setItem(SESSION_KEYS.SESSION_START, now.toString());
    }
    if (!existingLastActive) {
        localStorage.setItem(SESSION_KEYS.LAST_ACTIVE, now.toString());
    }
    lastRecordedTime = parseInt(localStorage.getItem(SESSION_KEYS.LAST_ACTIVE) || now.toString(), 10);

    // 1. Listen for user activity events
    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    const onUserInteraction = () => recordUserActivity();

    activityEvents.forEach(evt => {
        window.addEventListener(evt, onUserInteraction, { passive: true });
    });

    // 2. Cross-tab synchronization via storage events
    window.addEventListener('storage', (e) => {
        if (e.key === SESSION_KEYS.LOGOUT_BROADCAST && e.newValue) {
            // Another tab logged out, immediately sign out this tab too
            clearUserSession();
            signOut(auth).finally(() => {
                const dest = userType === 'admin' ? 'admin-login.html' : 'login.html';
                window.location.href = dest;
            });
        } else if (e.key === SESSION_KEYS.LAST_ACTIVE && e.newValue) {
            // Another tab recorded activity, update local timestamp
            lastRecordedTime = parseInt(e.newValue, 10);
            if (isWarningShown) {
                dismissExpiryWarning();
            }
        }
    });

    // 3. Periodic Session Check Function
    const checkSessionState = async () => {
        const currentNow = Date.now();
        const lastActiveStr = localStorage.getItem(SESSION_KEYS.LAST_ACTIVE);
        const sessionStartStr = localStorage.getItem(SESSION_KEYS.SESSION_START);

        const lastActive = lastActiveStr ? parseInt(lastActiveStr, 10) : currentNow;
        const sessionStart = sessionStartStr ? parseInt(sessionStartStr, 10) : currentNow;
        const { idleTimeout, maxLifetime } = getSessionLimits(userType);

        const elapsedIdle = currentNow - lastActive;
        const elapsedSession = currentNow - sessionStart;

        // Check if absolute max lifetime reached
        if (elapsedSession >= maxLifetime) {
            console.log("[SESSION] Max session duration reached. Terminating session.");
            await handleSessionTimeout(auth, userType, "Your maximum session duration was reached. Please log in again.");
            return;
        }

        // Check if idle timeout reached
        if (elapsedIdle >= idleTimeout) {
            console.log("[SESSION] Idle timeout exceeded. Terminating session.");
            await handleSessionTimeout(auth, userType, "Your session has expired due to inactivity. Please log in again.");
            return;
        }

        // Check if near expiration (show warning)
        const timeRemaining = idleTimeout - elapsedIdle;
        if (timeRemaining <= SESSION_CONFIG.WARNING_BEFORE_MS) {
            const secondsLeft = Math.max(1, Math.ceil(timeRemaining / 1000));
            showExpiryWarning(secondsLeft, () => {
                recordUserActivity();
            });
            const countdownEl = document.getElementById('session-countdown');
            if (countdownEl) {
                countdownEl.textContent = secondsLeft.toString();
            }
        } else if (isWarningShown) {
            dismissExpiryWarning();
        }
    };

    // 4. Run periodic interval
    if (trackerInterval) clearInterval(trackerInterval);
    trackerInterval = setInterval(checkSessionState, SESSION_CONFIG.CHECK_INTERVAL_MS);

    // 5. Check when window regains focus or becomes visible (e.g. waking computer or switching tabs)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            checkSessionState();
        }
    });
    window.addEventListener('focus', checkSessionState);

    // Initial check immediately
    checkSessionState();
}
