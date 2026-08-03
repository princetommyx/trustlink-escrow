// moolre-service.js
// Safe pure-client utilities and secure backend proxy calls for TrustLink Escrow.

/**
 * Normalizes a Ghanaian phone number to international format (233XXXXXXXXX) or local 10-digit format.
 * Accepts "055 123 4567", "+233551234567", "0551234567" etc.
 * @param {string} phone - The phone number in any common format.
 * @returns {string} Digits-only phone string.
 */
export function normalizePhone(phone) {
    let p = String(phone || '').replace(/[^0-9]/g, '');
    if (p.startsWith('0')) p = '233' + p.slice(1);
    return p;
}

/**
 * Standard 10-digit local format (e.g. 0551234567).
 */
export function formatGhanaPhoneNumber(phone) {
    let digits = String(phone || '').replace(/[^\d]/g, '');
    if (digits.startsWith('233') && digits.length === 12) {
        return '0' + digits.slice(3);
    }
    if (!digits.startsWith('0') && digits.length === 9) {
        return '0' + digits;
    }
    return digits;
}

/**
 * Formats currency in Ghana Cedis (GH₵).
 */
export function formatCurrency(amount) {
    const num = parseFloat(amount) || 0;
    return `GH₵ ${num.toFixed(2)}`;
}

/**
 * Splits the platform fee between buyer and seller based on the escrow's
 * fee allocation ('buyer' | 'seller' | 'split').
 * Buyer pays: amount + buyerFee. Seller receives: amount - sellerFee.
 * @returns {{ totalFee: number, buyerFee: number, sellerFee: number, buyerTotal: number, sellerNet: number }}
 */
export function computeFeeSplit(amount, feePercent = 3, allocation = 'split') {
    const amt = parseFloat(amount) || 0;
    const pct = (parseFloat(feePercent) || 0) / 100;
    const totalFee = Math.round(amt * pct * 100) / 100;
    let buyerFee = 0, sellerFee = 0;
    if (allocation === 'buyer') buyerFee = totalFee;
    else if (allocation === 'seller') sellerFee = totalFee;
    else {
        buyerFee = Math.round(totalFee / 2 * 100) / 100;
        sellerFee = Math.round((totalFee - buyerFee) * 100) / 100;
    }
    return {
        totalFee,
        buyerFee,
        sellerFee,
        buyerTotal: Math.round((amt + buyerFee) * 100) / 100,
        sellerNet: Math.round((amt - sellerFee) * 100) / 100
    };
}

/**
 * Generates a cryptographically random hex token (for one-time links).
 * @param {number} bytes - Number of random bytes (default 16 = 32 hex chars).
 */
export function generateSecureToken(bytes = 16) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256 hash of a string, returned as hex.
 */
export async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Best-effort extraction of a user's phone number from profile data.
 */
export function pickUserPhone(userData) {
    if (!userData) return "";
    if (userData.phone) return userData.phone;
    const oi = String(userData.originalIdentifier || '');
    if (/^[+0-9 ()-]{9,}$/.test(oi)) return oi;
    return "";
}

/**
 * Secure Backend Proxy Call: Requests a phone verification OTP via server-side Cloud Function.
 */
export async function sendMoolreOTP(phone) {
    try {
        const response = await fetch("/api/v1/otp/request", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });
        const data = await response.json();
        if (!response.ok) {
            return { status: 0, message: data.error || "Failed to dispatch OTP." };
        }
        return { status: 1, message: "Verification OTP dispatched successfully." };
    } catch (err) {
        return { status: 0, message: "Network error requesting verification code." };
    }
}
