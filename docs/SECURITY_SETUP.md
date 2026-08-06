# 🔐 Security Architecture & Secret Management Guide

> **Security Mandate:** TrustLink Escrow adheres to zero-trust design principles. No API secrets, private keys, database admin tokens, or payment credentials may be committed to version control or exposed in browser client-side code.

---

## 🏛️ Secret Classification & Distribution

| Classification | Category | Storage Location | Example Variables |
| :--- | :--- | :--- | :--- |
| **High Security (Restricted)** | Payment Gateway Secrets | Firebase Secret Manager (GCP Cloud KMS) | `MOOLRE_SECRET_KEY`, `MOOLRE_PRIVATE_KEY`, `MOOLRE_VAS_KEY`, `MOOLRE_ACCOUNT_NUMBER` |
| **High Security (Restricted)** | Messaging & SMS Gateways | Vercel Environment Variables (Server-side) | `SASUSYNC_API_KEY`, `ARKESEL_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN` |
| **Medium Security** | Service Identifiers | Vercel / Cloud Functions Env | `WHATSAPP_PHONE_NUMBER_ID`, `SASUSYNC_SENDER_ID` |
| **Public** | Client-Side SDK Keys | `firebase-config.js` | Firebase Client Web API Key, Project ID, App ID |

---

## 🚀 Setting Up Secrets in Production

### 1. Firebase Secret Manager (Cloud Functions)
To configure secrets for Firebase Cloud Functions without exposing them in codebase configs, run:

```bash
# Set Moolre Payment Gateway Credentials
firebase functions:secrets:set MOOLRE_SECRET_KEY
firebase functions:secrets:set MOOLRE_PUBLIC_KEY
firebase functions:secrets:set MOOLRE_PRIVATE_KEY
firebase functions:secrets:set MOOLRE_VAS_KEY
firebase functions:secrets:set MOOLRE_API_USER
firebase functions:secrets:set MOOLRE_ACCOUNT_NUMBER

# Set SMS Gateway Key for Cloud Functions
firebase functions:secrets:set SASUSYNC_API_KEY
```

### 2. Vercel Dashboard (Serverless Functions)
In your Vercel Project Settings (`Settings` ➔ `Environment Variables`), configure the following keys for `Production` and `Preview` environments:

- `SASUSYNC_API_KEY`
- `SASUSYNC_SENDER_ID` (e.g. `TrustEscrow`)
- `ARKESEL_API_KEY`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_VERIFY_TOKEN`

---

## 🔄 Secret Rotation Runbook

In the event of a suspected leak or scheduled 90-day rotation:

1. **Generate New Credentials** in the respective provider portal (Moolre Merchant Portal, Meta Business Manager, or SasuSync Dashboard).
2. **Update Secret Stores** using the Firebase CLI commands above and updating Vercel environment variables.
3. **Deploy Backend**:
   ```bash
   firebase deploy --only functions
   vercel --prod
   ```
4. **Revoke Old Keys** in the provider dashboard immediately after confirming successful operation with the new keys.
5. **Run Security Scanner**:
   ```bash
   npm test
   ```

---

## 🛡️ Database & Rule Validation

All Firestore database access is governed by [firestore.rules](file:///Users/wm/Desktop/trustlink-escrow/firestore.rules).
- Client applications can never directly alter user wallet balances or platform fee allocations.
- Escrow records enforce strict status lifecycle state machines.
- All financial state changes record immutable events in the `audit_logs` collection.
