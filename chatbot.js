/**
 * TrustLink Customer Support Chatbot
 * Powered by DeepSeek API
 */

(function () {
    // ─── CONFIG ─────────────────────────────────────────────────────────────
    const DEEPSEEK_API_KEY = 'YOUR_DEEPSEEK_API_KEY_HERE'; // ← Replace with your DeepSeek API key
    const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
    const MODEL = 'deepseek-chat';

    const SYSTEM_PROMPT = `You are Trusty, TrustLink's friendly and professional customer support assistant.

TrustLink is a secure escrow platform for social commerce in Ghana. It allows sellers (vendors) to create escrow contracts for their products, and buyers to make safe payments through those contracts. Funds are held in escrow until the buyer confirms receipt.

Key facts about TrustLink:
- Sellers create escrow contracts by linking products and entering the buyer's details.
- Buyers receive a payment link via email/SMS and pay through the checkout page.
- Payments are processed through Moolre (a Ghanaian payment gateway supporting Mobile Money and cards).
- Once a buyer pays, the escrow status changes to "Funded".
- The seller then dispatches the goods and marks the order as "Dispatched".
- After the buyer confirms receipt, funds are released to the seller. The escrow status becomes "Completed".
- If there's a dispute, either party can raise it and TrustLink admin will intervene.

Common support topics:
1. How escrow works - explain the step-by-step process above
2. Payment issues - advise them to check their Moolre account, or retry payment with a different method (web vs USSD)
3. Account/login problems - advise password reset via the "Forget password?" link
4. Tracking escrow status - users can check status in their dashboard under "Escrow Contracts"
5. Contacting human support - email: support@trustlinkgh.online

Tone: Warm, concise, helpful. Never make up information. If unsure, refer them to support@trustlinkgh.online.
Keep responses short and easy to read. Use bullet points for multi-step instructions.`;

    const QUICK_REPLIES = [
        '💡 How does escrow work?',
        '💳 Payment not going through',
        '🔑 Can\'t log in',
        '📦 Track my escrow',
        '📞 Talk to a human',
    ];

    // ─── STATE ───────────────────────────────────────────────────────────────
    let isOpen = false;
    let isTyping = false;
    let conversationHistory = [];

    // ─── INJECT HTML ─────────────────────────────────────────────────────────
    function injectWidget() {
        // Inject CSS
        if (!document.querySelector('link[href="chatbot.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'chatbot.css';
            document.head.appendChild(link);
        }

        const widget = document.createElement('div');
        widget.id = 'tl-chatbot-root';
        widget.innerHTML = `
            <!-- Chat Panel -->
            <div id="tl-chat-panel">
                <!-- Header -->
                <div id="tl-chat-header">
                    <div class="tl-avatar">🛡️</div>
                    <div class="tl-header-info">
                        <h4>Trusty · TrustLink Support</h4>
                        <p><span class="tl-online-dot"></span> Online · Usually replies instantly</p>
                    </div>
                </div>

                <!-- Messages -->
                <div id="tl-messages"></div>

                <!-- Quick Replies -->
                <div id="tl-quick-replies">
                    ${QUICK_REPLIES.map(q => `<button class="tl-quick-btn" onclick="tlQuickReply(this)">${q}</button>`).join('')}
                </div>

                <!-- Input Row -->
                <div id="tl-input-row">
                    <input id="tl-input" type="text" placeholder="Ask Trusty anything…" autocomplete="off" />
                    <button id="tl-send-btn" onclick="tlSend()" title="Send">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z"/>
                        </svg>
                    </button>
                </div>
            </div>

            <!-- Floating Bubble -->
            <button id="tl-chat-bubble" onclick="tlToggleChat()" aria-label="Open support chat">
                <!-- Chat icon -->
                <svg class="chat-icon" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24">
                    <path fill-rule="evenodd" d="M4.804 21.644A6.707 6.707 0 006 21.75a6.721 6.721 0 003.583-1.029c.774.182 1.584.279 2.417.279 5.322 0 9.75-3.97 9.75-9 0-5.03-4.428-9-9.75-9s-9.75 3.97-9.75 9c0 2.409 1.025 4.587 2.674 6.192.232.226.277.428.254.543a3.73 3.73 0 01-.814 1.686.75.75 0 00.44 1.223 3.702 3.702 0 002-.563z" clip-rule="evenodd"/>
                </svg>
                <!-- Close icon -->
                <svg class="close-icon" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24">
                    <path fill-rule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clip-rule="evenodd"/>
                </svg>
            </button>
        `;
        document.body.appendChild(widget);

        // Handle Enter key
        document.getElementById('tl-input').addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                tlSend();
            }
        });

        // Show greeting after short delay
        setTimeout(showGreeting, 800);
    }

    // ─── GREETING ────────────────────────────────────────────────────────────
    function showGreeting() {
        appendBotMessage("👋 Hi! I'm **Trusty**, TrustLink's support assistant.\n\nI can help you with escrow questions, payment issues, account problems, and more. What can I help you with today?");
    }

    // ─── TOGGLE ──────────────────────────────────────────────────────────────
    window.tlToggleChat = function () {
        isOpen = !isOpen;
        const panel = document.getElementById('tl-chat-panel');
        const bubble = document.getElementById('tl-chat-bubble');
        panel.classList.toggle('open', isOpen);
        bubble.classList.toggle('open', isOpen);
        if (isOpen) {
            setTimeout(() => document.getElementById('tl-input').focus(), 300);
        }
    };

    // ─── QUICK REPLY ─────────────────────────────────────────────────────────
    window.tlQuickReply = function (btn) {
        const text = btn.textContent.replace(/^[^\w]+/, '').trim(); // strip emoji prefix
        document.getElementById('tl-input').value = text;
        // Hide quick replies after first use
        document.getElementById('tl-quick-replies').style.display = 'none';
        tlSend();
    };

    // ─── SEND ────────────────────────────────────────────────────────────────
    window.tlSend = async function () {
        const input = document.getElementById('tl-input');
        const message = input.value.trim();
        if (!message || isTyping) return;

        input.value = '';
        appendUserMessage(message);

        conversationHistory.push({ role: 'user', content: message });

        await getBotReply();
    };

    // ─── API CALL ────────────────────────────────────────────────────────────
    async function getBotReply() {
        if (DEEPSEEK_API_KEY === 'YOUR_DEEPSEEK_API_KEY_HERE') {
            appendBotMessage("⚠️ The chatbot isn't configured yet. Please add your DeepSeek API key in `chatbot.js`.\n\nIn the meantime, reach us at **support@trustlinkgh.online**.");
            return;
        }

        isTyping = true;
        document.getElementById('tl-send-btn').disabled = true;
        const typingEl = showTyping();

        try {
            const response = await fetch(DEEPSEEK_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                },
                body: JSON.stringify({
                    model: MODEL,
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        ...conversationHistory,
                    ],
                    temperature: 0.7,
                    max_tokens: 500,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error?.message || 'API error');
            }

            const reply = data.choices?.[0]?.message?.content || "I'm having trouble responding right now.";
            conversationHistory.push({ role: 'assistant', content: reply });
            removeTyping(typingEl);
            appendBotMessage(reply);

        } catch (err) {
            removeTyping(typingEl);
            appendBotMessage("Sorry, I'm having trouble connecting right now. Please try again or email us at **support@trustlinkgh.online**.");
            console.error('[TrustLink Chatbot]', err);
        } finally {
            isTyping = false;
            document.getElementById('tl-send-btn').disabled = false;
        }
    }

    // ─── HELPERS ─────────────────────────────────────────────────────────────
    function appendBotMessage(text) {
        const msgs = document.getElementById('tl-messages');
        const el = document.createElement('div');
        el.className = 'tl-msg bot';
        el.innerHTML = `
            <div class="tl-msg-avatar">🛡️</div>
            <div class="tl-bubble">${formatText(text)}</div>
        `;
        msgs.appendChild(el);
        scrollToBottom();
    }

    function appendUserMessage(text) {
        const msgs = document.getElementById('tl-messages');
        const el = document.createElement('div');
        el.className = 'tl-msg user';
        el.innerHTML = `<div class="tl-bubble">${escapeHtml(text)}</div>`;
        msgs.appendChild(el);
        scrollToBottom();
    }

    function showTyping() {
        const msgs = document.getElementById('tl-messages');
        const el = document.createElement('div');
        el.className = 'tl-msg bot tl-typing-row';
        el.innerHTML = `
            <div class="tl-msg-avatar">🛡️</div>
            <div class="tl-typing"><span></span><span></span><span></span></div>
        `;
        msgs.appendChild(el);
        scrollToBottom();
        return el;
    }

    function removeTyping(el) {
        el?.remove();
    }

    function scrollToBottom() {
        const msgs = document.getElementById('tl-messages');
        if (msgs) msgs.scrollTop = msgs.scrollHeight;
    }

    // Simple markdown-ish formatter: **bold**, *italic*, newlines, bullet points
    function formatText(text) {
        return escapeHtml(text)
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/\n- /g, '\n• ')
            .replace(/\n/g, '<br>');
    }

    function escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ─── INIT ────────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectWidget);
    } else {
        injectWidget();
    }
})();
