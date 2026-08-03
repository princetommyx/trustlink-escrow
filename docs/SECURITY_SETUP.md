# 🔐 Security Setup & Secret Management Guide

> **Important:** This guide documents the secret names and command-line instructions required to configure Firebase Secret Manager for production deployment. Never commit secret values or private keys to source code or version control.

---

## 🔑 Required Firebase Secrets

The following secret keys must be set in Firebase Secret Manager for your project before deploying Cloud Functions:

| Secret Name | Purpose | Function Access |
| :--- | :--- | :--- |
| `MOOLRE_SECRET_KEY` | Moolre API Secret Key | `api`, `moolre` backend functions |
| `MOOLRE_PUBLIC_KEY` | Moolre JWT Public Key | `api`, `moolre` backend functions |
| `MOOLRE_PRIVATE_KEY` | Moolre API Private Key | `api`, `moolre` backend functions |
| `MOOLRE_VAS_KEY` | Moolre VAS Key (SMS & Notifications) | `api`, `moolre` backend functions |
| `MOOLRE_API_USER` | Moolre API User Account Identifier | `api`, `moolre` backend functions |
| `MOOLRE_ACCOUNT_NUMBER` | Moolre Merchant Account Number | `api`, `moolre` backend functions |

---

## 🚀 Setting Secrets via Firebase CLI

Run the following commands in your terminal (replacing placeholders with your real rotated production credentials when prompted):

```bash
# Set Moolre Secrets
firebase functions:secrets:set MOOLRE_SECRET_KEY
firebase functions:secrets:set MOOLRE_PUBLIC_KEY
firebase functions:secrets:set MOOLRE_PRIVATE_KEY
firebase functions:secrets:set MOOLRE_VAS_KEY
firebase functions:secrets:set MOOLRE_API_USER
firebase functions:secrets:set MOOLRE_ACCOUNT_NUMBER
```

---

## 📋 Recommended Deployment Sequence

1. **Rotate Credentials:** Revoke all previously exposed Moolre API keys and generate new credentials in your Moolre Merchant Dashboard.
2. **Set Firebase Secrets:** Execute the `firebase functions:secrets:set` commands above for the `trustlink-escrow` Firebase project.
3. **Deploy Backend Functions:** Deploy updated Cloud Functions:
   ```bash
   firebase deploy --only functions
   ```
4. **Deploy Frontend & Vercel Rewrites:** Deploy static frontend assets and Vercel routing rewrites (`vercel.json`).
5. **Verify API Endpoints:** Test endpoint routing to `https://www.trustlinkgh.online/api/v1/escrows` using authorized sandbox API keys.
6. **Git History Sanitation:** Coordinated history cleanup after credential revocation.
