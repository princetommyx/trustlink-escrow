# TrustLink Escrow - Telegram Seller Bot Setup Guide

> **Why Telegram for Sellers?** Telegram is 100% free, requires zero Meta verification or paid message templates, supports instant push notifications, and offers interactive inline action buttons and step-by-step guided wizards.

---

## 1. Create the Bot with @BotFather (2 Minutes)

1. Open Telegram and search for [**@BotFather**](https://t.me/botfather).
2. Start the chat and send the command:
   ```
   /newbot
   ```
3. Enter a friendly name for your bot:
   ```
   TrustLink Escrow Bot
   ```
4. Enter a unique username ending in `bot` (e.g. `TrustLinkEscrowBot` or `TrustLinkGhBot`).
5. **Copy the Bot API Token** provided by BotFather (it looks like `7123456789:AAFn_XXXXXXX-XXXXXXXXXXXXXX`).

---

## 2. Configure Commands in @BotFather

To enable auto-complete commands in the Telegram chat UI:

1. Send `/setcommands` to **@BotFather**.
2. Select your bot.
3. Paste the following command list:
```text
start - Open the main menu and dashboard
new - Guided 4-step escrow link creator
create - 1-line fast link creation (/create <amount> <item> <phone>)
balance - Check available wallet & escrow balance
orders - View recent escrow sales and contracts
ship - Mark an order as shipped (/ship <escrowId>)
link - Connect your web dashboard account (/link <phone>)
cancel - Abort current creation wizard
help - How TrustLink Escrow works
```

---

## 3. Set the Webhook URL

Telegram delivers updates to your server via HTTPS webhook. Run this single `curl` command in your terminal:

```bash
# Replace <YOUR_TELEGRAM_BOT_TOKEN> with your actual token from BotFather:
curl -F "url=https://www.trustlinkgh.online/api/webhook/telegram" \
     https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook
```

You will receive the confirmation:
```json
{"ok": true, "result": true, "description": "Webhook was set"}
```

---

## 4. Set Environment Variables in Vercel

In your **Vercel Dashboard** (`Project Settings` -> `Environment Variables`), configure:

| Key | Value | Description |
| :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | `your_bot_token_from_botfather` | The Bot API Token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | *(Optional random secret)* | Optional secret for `X-Telegram-Bot-Api-Secret-Token` |

---

## 5. How Sellers Use the Bot

### A. Fast 1-Line Creation
Sellers can create an escrow link in 5 seconds by typing:
```text
/create 450 Nike Air Jordan 0244112233
```

### B. Guided 5-Step Interactive Wizard
Type `/new` and the bot will prompt:
1. **Item Name:** `iPhone 13 Pro Max`
2. **Price in GH₵:** `6500`
3. **Buyer Phone:** `0555987654`
4. **Delivery Timeline:** Taps `[ 📦 Tomorrow ]` or `[ 🚚 In 2 - 3 Days ]` inline button
5. **Fee Split:** Taps `[ 50/50 Split ]` inline button.

### C. 1-Tap Actions & Push Notifications
- **`[ Send SMS to Buyer ]`**: Dispatches the exact site-standard SMS payment invitation to the buyer's phone with the direct payment link.
- **`[ Share on WhatsApp ]`**: Opens WhatsApp with pre-filled escrow protection text and checkout URL.
- **Push Alerts**: When the buyer completes Mobile Money payment, the seller receives a real-time Telegram notification.
- **Order Fulfillment**: When shipped, the seller taps `[ Mark as Shipped ]` directly inside Telegram.
- **Commands**: `/create`, `/new`, `/sms <escrowId>`, `/balance`, `/orders`, `/ship <escrowId>`, `/link <phone>`, `/cancel`.
