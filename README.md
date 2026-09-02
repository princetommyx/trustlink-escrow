# 🛡️ TrustLink Escrow — Protected Mobile Money Payments for Social Sales in Ghana

[![Production Domain](https://img.shields.io/badge/Production-www.trustlinkgh.online-0284C7?style=for-the-badge&logo=googlechrome&logoColor=white)](https://www.trustlinkgh.online/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Ghana%20Mobile%20Money%20(MTN%20%7C%20Telecel%20%7C%20AT)-0F172A?style=for-the-badge)](#-system-architecture--tech-stack)

> **TrustLink Escrow** is a state-driven, multi-channel protected payment infrastructure designed for social media vendors (Instagram DMs, TikTok, X, WhatsApp Status) and e-commerce merchants across Ghana and West Africa.

---

![TrustLink Escrow Logo](img/logo.png)

---

## 🌐 Live Website

* **Production URL:** [https://www.trustlinkgh.online/](https://www.trustlinkgh.online/)
* **Developer API Docs:** [https://www.trustlinkgh.online/api-docs](https://www.trustlinkgh.online/api-docs)
* **Terms of Use:** [https://www.trustlinkgh.online/terms.html](https://www.trustlinkgh.online/terms.html)
* **Privacy Policy:** [https://www.trustlinkgh.online/privacy.html](https://www.trustlinkgh.online/privacy.html)

---

## 📌 Executive Summary

Social commerce in Ghana relies heavily on Direct Messages (DMs) across WhatsApp, Instagram, and TikTok, where buyers and sellers often face mutual distrust. Buyers fear non-delivery or fraudulent sellers, while sellers fear unpaid dispatches and illegitimate payment claims.

**TrustLink Escrow solves this fundamental trust gap.** Sellers generate instant protected payment links in seconds, buyers pay securely via **Moolre Mobile Money (MTN MoMo, Telecel Cash, AT Money)**, funds are ring-fenced safely in logical escrow, automated SMS/WhatsApp alerts guide fulfillment, and funds release to the vendor's wallet upon buyer delivery confirmation or admin dispute resolution.

---

## 💻 Tech Stack & Architecture

* **Frontend Core:** HTML5, Modern Vanilla CSS3 (Design Tokens & CSS Variables), JavaScript (ES6+ Modules).
* **Animations:** Lightweight CSS Transitions & IntersectionObserver, GSAP utilities.
* **Authentication & Database:** Google Firebase (Auth, Firestore, Cloud Storage).
* **Backend & Cloud Services:** Firebase Cloud Functions (Node.js/Express REST API endpoints, webhooks, WhatsApp state machine).
* **Payment Gateway:** Moolre Fintech API (Automated Mobile Money USSD Push collections, payouts/disbursements, transactional SMS gateway).
* **Messaging Gateways:** Meta WhatsApp Business Cloud API & Twilio WhatsApp API.
* **E-commerce Plugin:** Official WooCommerce WordPress Payment Gateway Plugin (`trustlink-woocommerce-plugin/`).

---

## 🔥 Key Platform Features & Functions

### 1. Vendor & Seller Control Center (`dashboard.html`)

* **Real-time Wallet Overview:** Live snapshot indicators for Available Balance, Escrowed Funds, and Total Completed Volume.
* **Instant Link Generator:** Mint shareable payment links with custom descriptions, item amounts in Ghana Cedis (`GH₵`), buyer contact details, and flexible fee split configurations (*50/50 split*, *Buyer pays 100%*, *Seller pays 100%*).
* **Product Catalog:** Manage saved product items and generate checkout links with 1 click.
* **Mobile Money Disbursements:** Withdraw funds directly to Ghanaian mobile money accounts (MTN, Telecel, AT) with automated validation and safety refund fallback.

### 2. Buyer Checkout & Payment Room (`checkout.html`)

* **In-App Social Browser Optimization:** Ultra-fast loading inside Instagram, TikTok, and WhatsApp browsers.
* **Dual Mobile Money Gateway:** USSD Push Prompt directly to buyer's handset or fallback dynamic virtual account transfer.
* **Real-Time Payment Verification:** Automated polling and webhook listeners transition transaction state to `FUNDS_ESCROWED`.

### 3. Buyer Confirmation & Delivery Room (`confirm.html`)

* **Live Progress Timeline:** Interactive visual status tracker (`Awaiting Payment` ➔ `Funds Escrowed` ➔ `Shipped` ➔ `Delivered`).
* **4-Digit Delivery Verification:** Secure confirmation interface allowing buyers to release funds to the seller upon receiving goods.
* **Dispute Lock:** One-click dispute trigger freezing payouts in state `DISPUTED` for admin review.

### 4. Interactive WhatsApp Bot Engine (`functions/index.js`)

* **1-Line Escrow Creation:** Mint checkout links directly from WhatsApp text (`CREATE <Amount> <Item> <Buyer Phone>`).
* **Conversational Order Wizard:** Multi-step guided bot flow walking sellers through order setup.
* **Order Tracking & Balance:** Send `STATUS`, `SHIP <EscrowID>`, or `BALANCE` directly via chat.

### 5. Developer REST API & WooCommerce Plugin (`api-docs.html`)

* **REST API Sandbox:** Developer preview documentation portal with interactive sandbox and code snippets in Python, Node.js, cURL, and PHP.
* **WooCommerce Plugin:** Ready-to-deploy PHP plugin file enabling WooCommerce webstores to offer TrustLink Escrow checkout.

---

## 🔄 Transaction State Machine

```
[INITIATED] ──► [PENDING_PAYMENT] ──► [FUNDS_ESCROWED] ──► [ITEM_SHIPPED] ──► [COMPLETED] ──► [SELLER_WALLET_CREDITED]
                                                                │
                                                                └──► [DISPUTED] ──► [REFUNDED / FORCED_RELEASE]
```

---

## 🤝 Rules for Collaboration

We welcome contributions to TrustLink Escrow! To maintain architectural integrity and design uniformity, all contributors must observe these core engineering rules:

1. **Preserve the Core Stack:** Do **not** migrate the repository to React, Next.js, Vue, TypeScript, Tailwind, or external heavy frameworks.
2. **Follow Visual Guidelines:** Inspect [docs/DESIGN_GUIDELINES.md](docs/DESIGN_GUIDELINES.md) before designing UI components. Maintain the Slate Navy (`#0F172A`), Accent Blue (`#2563EB`), `Lora` editorial serif for hero/section headlines, and `Outfit`/`Inter` for everything else.
3. **No Unverified Claims:** Do not add unverified marketing guarantees or fake metrics.
4. **Ghana Localization:** Visible currency amounts must use `GH₵` for display and `GHS` for backend payloads.
5. **Preserve State Machine Constants:** Do not rename database fields or state machine constants (`PENDING_PAYMENT`, `FUNDS_ESCROWED`, `ITEM_SHIPPED`, `COMPLETED`, `DISPUTED`, `REFUNDED`).
6. **No Placeholder Links:** Do not use `href="#"` for dead links. All legal text must point to `terms.html` or `privacy.html`.

---

## 📄 Project Documentation

* [Project Status & Progress Log](docs/PROJECT_STATUS.md)
* [UI/UX Design Guidelines](docs/DESIGN_GUIDELINES.md)
* [Terms of Use](terms.html)
* [Privacy Policy](privacy.html)

---

## 📜 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

*© 2026 TrustLink Escrow. Built for secure social commerce.*
