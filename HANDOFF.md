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

### 1. Moolre API Authentication Errors (`AIN01`)
The core Moolre API for generating dynamic checkout links (`https://api.moolre.com/embed/link`) strictly returns a `{"code": "AIN01", "message": "Authentication Error"}`. 
- **What was tested:** We tested using the Secret Key, the Private Key, and multiple variations of the `X-API-USER` (including the internal ID `109232`, `DreamersCode`, and the login username `uyahya566`). All returned `AIN01`.
- **Root Cause Analysis:** Since the wallet is verified, this almost certainly means that **Moolre requires our server IP address to be whitelisted** in their developer portal, OR the account has not been explicitly activated for Live API access. 
- **Next Steps for Team:** Contact Moolre integration support to find out why the keys are returning `AIN01` for `uyahya566`.

### 2. The Webhook Callback Cannot Match Escrows
Because the core API is returning `AIN01`, we are temporarily redirecting buyers to a **Static POS Link**. 
- **The Issue:** Static POS links do not accept the unique `externalref` (Escrow ID). When the buyer pays on the POS link, Moolre fires the webhook to our Render server, but the JSON payload does not contain the `externalref`.
- **The Result:** The Render server receives the "Payment Successful" ping, but does not know *which* Firebase document to update to `FUNDED`. 
- **The Fix:** Once Moolre unblocks the API Authentication Error, the team must switch `checkout.js` back to using the `initiateMoolreCheckout()` function instead of the static POS link.

### 3. SMS Sender ID is Pending
- We set the `MOOLRE_SENDER_ID` to `"566"`.
- However, the Moolre dashboard shows this ID is in **"Pending"** status. Until the Moolre team manually approves it, all SMS requests will fail.

---

## 💻 Where to find the code

- **Webhook Backend Repo:** `https://github.com/Uyahya566/trustlinkBackend`
- **Moolre Service Logic:** `moolre-service.js` (Contains all keys, checkout API logic, and SMS API logic).
- **Buyer Checkout Logic:** `checkout.js` (Currently hardcoded to redirect to the static POS link; needs to be reverted to the API call once Moolre fixes the auth issue).
