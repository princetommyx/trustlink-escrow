# TrustLink Escrow - Moolre Integration Handoff Notes

## 🟢 What Was Successfully Added

1. **Moolre SMS Notifications (`moolre-service.js`)**
   - Successfully integrated the `open/sms/send` API. 
   - Uses the verified VAS Key.
   - Dynamically generates the SMS text containing the specific Buyer's Checkout link (`checkout.html?id=ESCROW_ID`).

2. **Standalone Webhook Server (`webhook-server/`)**
   - Created a standalone Node.js Express webhook server deployed on Render (`trustlinkbackend.onrender.com/webhook/moolre`).
   - Bypassed the need for Firebase Cloud Functions (which required a paid Blaze plan).
   - Server successfully connects to Firebase Admin SDK via Environment Variables and updates the Escrow status to `FUNDED` when a valid payload with an `externalref` is received.

3. **Frontend Fallback Mechanisms (`dashboard.js`, `checkout.js`)**
   - Implemented a graceful fallback: If the SMS fails to send, the app automatically opens the Buyer Checkout page for the seller so they can still test.
   - Temporarily replaced the broken dynamic API checkout link with the static POS Wallet link (`https://pos.moolre.com/k91Dp2VHFArnB0uCUytiNfW7ls5daw`) to allow end-to-end UI testing for buyers.
   - Loaded all brand new API Keys (Public, Private, Secret, VAS) into the codebase.

---

## 🔴 Specific Issues Faced (Blockers)

### 1. Moolre API Authentication Errors (`AIN01`) — ✅ RESOLVED (July 8, 2026)
**Root cause found:** the API keys and the `X-API-USER` username belonged to two different Moolre accounts. The old public key was issued to user ID `109232`, but requests were authenticated under a different username. Moolre validates that the keys belong to the username's account, so every call failed with `AIN01`. No IP whitelisting or live activation was required.

**Fix:** fresh keys generated under the `sasulabs` account (user ID `107834`) and set `MOOLRE_API_USER = "sasulabs"`. Verified working: `/embed/link` returns `POS09` with a real `authorization_url`, and `/open/transact/status` authenticates correctly.

**⚠️ Remaining:** the VAS key (SMS/WhatsApp) is still from the old account — generate a new VAS key under `sasulabs` and re-approve the SMS Sender ID (`Trustlink`) on that account, or messaging will keep failing. Original notes below for history:


The core Moolre API for generating dynamic checkout links (`https://api.moolre.com/embed/link`) strictly returns a `{"code": "AIN01", "message": "Authentication Error"}`. 
- **What was tested:** We tested using the Secret Key, the Private Key, and multiple variations of the `X-API-USER` (including the internal ID `109232`, `DreamersCode`, and the login username `uyahya566`). All returned `AIN01`.
- **Root Cause Analysis:** Since the wallet is verified, this almost certainly means that **Moolre requires our server IP address to be whitelisted** in their developer portal, OR the account has not been explicitly activated for Live API access. 
- **Next Steps for Team:** Contact Moolre integration support to find out why the keys are returning `AIN01` for `uyahya566`.

### 2. The Webhook Callback Cannot Match Escrows
Because the core API is returning `AIN01`, buyers may end up on a **Static POS Link**. 
- **The Issue:** Static POS links do not accept the unique `externalref` (Escrow ID). When the buyer pays on the POS link, Moolre fires the webhook to our Render server, but the JSON payload does not contain the `externalref`.
- **The Result:** The Render server receives the "Payment Successful" ping, but does not know *which* Firebase document to update to `FUNDED`. 
- **✅ UPDATE (July 7, 2026):** `checkout.js` now tries `initiateMoolreCheckout()` (with the escrow ID as `externalref`) **first**, and only falls back to the static POS link if the API call fails. Once Moolre unblocks the authentication error, dynamic checkout links will start working automatically — **no code change needed**. The static link now lives in one place: `MOOLRE_STATIC_POS_LINK` in `moolre-service.js`.

### 3. SMS Sender ID is Pending
- We set the `MOOLRE_SENDER_ID` to `"566"`.
- However, the Moolre dashboard shows this ID is in **"Pending"** status. Until the Moolre team manually approves it, all SMS requests will fail.

---

## 💻 Where to find the code

- **Webhook Backend Repo:** `https://github.com/Uyahya566/trustlinkBackend`
- **Moolre Service Logic:** `moolre-service.js` (Contains all keys, checkout API logic, and SMS API logic).
- **Buyer Checkout Logic:** `checkout.js` (Tries the dynamic Moolre API first, auto-falls back to the static POS link — self-heals once Moolre fixes the auth issue).

---

## 🛠️ Work Completed on July 7, 2026

1. **Modern UI refresh (all pages)**
   - New electric blue → cyan design system in `styles.css` (`--primary: #3B82F6`, `--secondary: #06B6D4`). Everything inherits from CSS variables, so the whole site updated consistently.
   - Auth pages redesigned: deep-navy gradient panel and gradient submit button in `auth.css` (replaced the old black/gold button).
   - Fixed broken Google Fonts URLs (`googleapis.com` → `fonts.googleapis.com`) in `signup.html` and `admin-login.html` — those pages were silently rendering fallback fonts.

2. **Admin dashboard functional upgrades (`admin-dashboard.js` / `admin-dashboard.html`)**
   - **Charts now use real Firestore data** (escrows + transactions bucketed per day) with working "Last 7/14/30 days" range selectors. Previously they always plotted zeros.
   - **User Management search box works** (filters by name/email as you type).
   - **Role Management table is live** — lists real admins/support from Firestore, with Edit Role and Revoke (self-revoke is blocked).
   - **Disputes view is live** — lists escrows with status `DISPUTED`, shows dispute details, and the Refund Buyer / Release to Seller buttons actually update the escrow (`REFUNDED` / `RELEASED`, with `resolvedAt`/`resolvedBy`). The sidebar disputes badge count is now real (was hardcoded "3").
   - **Platform fee is persisted** to Firestore at `settings/platform` (`feePercent`) instead of a fake alert.
   - **Bug fix:** stats compared statuses in lowercase (`'funded'`) but escrows store uppercase (`'FUNDED'`) — status comparisons are now case-insensitive, so Escrow Analytics cards show real numbers.
   - **Security fix:** user-supplied names/emails are now HTML-escaped before rendering (was vulnerable to HTML/script injection via a user's display name).

3. **Checkout self-healing fallback** — see the ✅ UPDATE under blocker #2 above.

### ⚠️ Still outstanding
- Moolre `AIN01` auth error — waiting on Moolre support (likely IP whitelisting / live API activation for `uyahya566`).
- SMS Sender ID `566` still **Pending** approval on the Moolre dashboard.
- "Change Password", "Generate Report", and category tags in admin Settings are still UI placeholders.
- API keys are still hardcoded in `moolre-service.js` and exposed client-side — must move to a backend before production.
- `admin-dashboard.js` still has two hardcoded bypass admin emails (`admin@trustlink.com`, `test@trustlink.com`) — remove once role-based access is fully trusted, and remember client-side checks are cosmetic; real enforcement must be in `firestore.rules`.
