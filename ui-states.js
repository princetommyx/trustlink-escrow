/**
 * ui-states.js — TrustLink Escrow Shared UI State Utility
 * Exposes window.TrustLinkUI for use in both classic scripts and ES modules.
 * Security: All dynamic text is inserted via textContent, never innerHTML.
 * No external dependencies. No bundler required.
 */

(function (global) {
    'use strict';

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /** Safe element creation helper */
    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                if (k === 'class') {
                    node.className = attrs[k];
                } else if (k === 'style') {
                    node.style.cssText = attrs[k];
                } else if (k.startsWith('data-')) {
                    node.setAttribute(k, attrs[k]);
                } else if (k === 'aria-label' || k === 'role' || k === 'aria-live'
                    || k === 'aria-atomic' || k === 'aria-modal' || k === 'aria-describedby'
                    || k === 'tabindex' || k === 'aria-invalid' || k === 'aria-expanded'
                    || k === 'aria-controls' || k === 'aria-busy' || k === 'aria-hidden') {
                    node.setAttribute(k, attrs[k]);
                } else {
                    node[k] = attrs[k];
                }
            });
        }
        if (children) {
            children.forEach(function (c) {
                if (typeof c === 'string') {
                    node.appendChild(document.createTextNode(c));
                } else if (c instanceof Node) {
                    node.appendChild(c);
                }
            });
        }
        return node;
    }

    /** SVG inline helper — only for hardcoded paths, never user content */
    function svg(pathsHtml) {
        var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        s.setAttribute('viewBox', '0 0 24 24');
        s.setAttribute('fill', 'none');
        s.setAttribute('stroke', 'currentColor');
        s.setAttribute('stroke-width', '1.75');
        s.setAttribute('stroke-linecap', 'round');
        s.setAttribute('stroke-linejoin', 'round');
        s.setAttribute('aria-hidden', 'true');
        s.style.cssText = 'width:32px;height:32px;';
        // Safe: pathsHtml is developer-controlled hardcoded SVG path strings only
        s.innerHTML = pathsHtml;
        return s;
    }

    function svgSmall(pathsHtml) {
        var s = svg(pathsHtml);
        s.style.cssText = 'width:16px;height:16px;flex-shrink:0;';
        return s;
    }

    // Hardcoded inline SVG path strings for each state type
    var ICONS = {
        empty: '<path d="M20 7H4C2.9 7 2 7.9 2 9v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2z"/><path d="M16 3H8L6 7h12l-2-4z"/>',
        emptyProduct: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/><rect x="2" y="4" width="20" height="16" rx="2"/>',
        emptyTx: '<path d="M9 12l2 2 4-4"/><path d="M3 9a9 9 0 1118 0 9 9 0 01-18 0z"/>',
        emptyWallet: '<path d="M21 12V7H5a2 2 0 010-4h14v4"/><path d="M3 5v14a2 2 0 002 2h16v-5"/><path d="M18 12a1 1 0 000 2h2v-2h-2z"/>',
        emptyNotif: '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>',
        emptySearch: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
        emptyDispute: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
        error: '<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>',
        warning: '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
        offline: '<line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0119 12.55"/><path d="M5 12.55a10.94 10.94 0 015.17-2.39"/><path d="M10.71 5.05A16 16 0 0122.56 9"/><path d="M1.42 9a15.91 15.91 0 014.7-2.88"/><path d="M8.53 16.11a6 6 0 016.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
        payment: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4l2 2"/>',
        timer: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
        lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>',
    };

    // -------------------------------------------------------------------------
    // 1. renderState — shows an empty / error / no-results state in a container
    // -------------------------------------------------------------------------
    /**
     * @param {Element} container
     * @param {Object} opts
     *   type: 'empty'|'error'|'warning'|'pending'|'offline'|'search'
     *   icon: 'empty'|'error'|'offline'|'payment'|'timer'|'lock'|... (optional)
     *   title: string
     *   message: string
     *   actions: [{label, onClick, style:'primary'|'secondary'|'accent', href}]
     *   refId: string (optional error reference)
     */
    function renderState(container, opts) {
        if (!container) return;
        // Remove existing state to prevent stacking
        clearState(container);

        var type = opts.type || 'empty';
        var iconKey = opts.icon || type;
        var iconClass = 'tl-icon-' + type;
        var iconPath = ICONS[iconKey] || ICONS['empty'];

        var iconEl = el('div', { class: 'tl-state-icon ' + iconClass }, [svg(iconPath)]);
        var titleEl = el('p', { class: 'tl-state-title' });
        titleEl.textContent = opts.title || '';
        var msgEl = el('p', { class: 'tl-state-message' });
        msgEl.textContent = opts.message || '';

        var stateEl = el('div', {
            class: 'tl-state',
            role: type === 'error' ? 'alert' : 'status',
            'aria-live': type === 'error' ? 'assertive' : 'polite',
            'aria-atomic': 'true'
        }, [iconEl, titleEl, msgEl]);

        if (opts.refId) {
            var refEl = el('p', { class: 'tl-state-ref' });
            refEl.textContent = 'Ref: ' + opts.refId;
            stateEl.appendChild(refEl);
        }

        if (opts.actions && opts.actions.length) {
            var actionsEl = el('div', { class: 'tl-state-actions' });
            opts.actions.forEach(function (action) {
                var btnStyle = 'tl-state-btn tl-state-btn-' + (action.style || 'primary');
                var btn;
                if (action.href) {
                    btn = el('a', { class: btnStyle, href: action.href });
                } else {
                    btn = el('button', { class: btnStyle, type: 'button' });
                    btn.addEventListener('click', action.onClick || function () {});
                }
                btn.textContent = action.label;
                actionsEl.appendChild(btn);
            });
            stateEl.appendChild(actionsEl);
        }

        stateEl.setAttribute('data-tl-state', '1');
        container.appendChild(stateEl);
    }

    function clearState(container) {
        if (!container) return;
        var existing = container.querySelector('[data-tl-state]');
        if (existing) existing.remove();
    }

    // -------------------------------------------------------------------------
    // 2. setButtonLoading / restoreButton
    // -------------------------------------------------------------------------
    /**
     * @param {HTMLButtonElement} button
     * @param {boolean} isLoading
     * @param {Object} opts  { loadingLabel: string }
     */
    function setButtonLoading(button, isLoading, opts) {
        if (!button) return;
        opts = opts || {};
        if (isLoading) {
            if (!button.dataset.tlOrigLabel) {
                button.dataset.tlOrigLabel = button.textContent.trim();
            }
            if (!button.dataset.tlOrigDisabled) {
                button.dataset.tlOrigDisabled = button.disabled ? '1' : '0';
            }
            button.disabled = true;
            button.classList.add('tl-btn-loading');

            var spinner = el('span', { class: 'tl-btn-spinner', 'aria-hidden': 'true' });
            var labelSpan = el('span');
            labelSpan.textContent = opts.loadingLabel || button.dataset.tlOrigLabel || 'Loading…';

            // Clear and rebuild inner content
            while (button.firstChild) button.removeChild(button.firstChild);
            button.style.minWidth = button.dataset.tlOrigWidth || (button.offsetWidth + 'px');
            button.dataset.tlOrigWidth = button.dataset.tlOrigWidth || (button.offsetWidth + 'px');
            button.style.display = 'inline-flex';
            button.style.alignItems = 'center';
            button.style.justifyContent = 'center';
            button.style.gap = '8px';
            button.appendChild(spinner);
            button.appendChild(labelSpan);
        } else {
            button.disabled = (button.dataset.tlOrigDisabled === '1');
            button.classList.remove('tl-btn-loading');
            while (button.firstChild) button.removeChild(button.firstChild);
            button.textContent = button.dataset.tlOrigLabel || '';
            button.style.minWidth = '';
            delete button.dataset.tlOrigLabel;
            delete button.dataset.tlOrigDisabled;
            delete button.dataset.tlOrigWidth;
        }
    }

    // -------------------------------------------------------------------------
    // 3. Field validation helpers
    // -------------------------------------------------------------------------
    function setFieldError(input, message) {
        if (!input) return;
        var errorId = (input.id || 'field') + '-tl-error';
        input.setAttribute('aria-invalid', 'true');
        input.classList.add('tl-input-invalid');

        // Set aria-describedby without removing any existing descriptor
        var existing = input.getAttribute('aria-describedby') || '';
        if (existing.indexOf(errorId) === -1) {
            input.setAttribute('aria-describedby', (existing ? existing + ' ' : '') + errorId);
        }

        var errEl = document.getElementById(errorId);
        if (!errEl) {
            errEl = el('div', {
                class: 'tl-field-error',
                id: errorId,
                role: 'alert',
                'aria-live': 'polite'
            });
            // Error icon
            var icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.setAttribute('viewBox', '0 0 24 24');
            icon.setAttribute('fill', 'none');
            icon.setAttribute('stroke', 'currentColor');
            icon.setAttribute('stroke-width', '2');
            icon.setAttribute('aria-hidden', 'true');
            icon.style.cssText = 'width:14px;height:14px;flex-shrink:0;margin-top:1px;';
            icon.innerHTML = '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
            var textNode = el('span', { class: 'tl-field-error-text' });
            errEl.appendChild(icon);
            errEl.appendChild(textNode);

            // Insert after input's parent (.form-group) or after input
            var parent = input.parentElement;
            if (parent && parent.classList.contains('password-wrapper')) {
                parent = parent.parentElement;
            }
            if (parent) {
                parent.appendChild(errEl);
            } else {
                input.insertAdjacentElement('afterend', errEl);
            }
        }

        var textEl = errEl.querySelector('.tl-field-error-text');
        if (textEl) textEl.textContent = message;
        errEl.style.display = 'flex';

        // Clear error when field value changes
        input._tlErrorListener = input._tlErrorListener || function () {
            if (input.value.trim().length > 0) {
                clearFieldError(input);
            }
        };
        input.removeEventListener('input', input._tlErrorListener);
        input.addEventListener('input', input._tlErrorListener);
    }

    function clearFieldError(input) {
        if (!input) return;
        input.removeAttribute('aria-invalid');
        input.classList.remove('tl-input-invalid');
        var errorId = (input.id || 'field') + '-tl-error';
        var errEl = document.getElementById(errorId);
        if (errEl) errEl.style.display = 'none';
        // Clean up aria-describedby
        var desc = input.getAttribute('aria-describedby') || '';
        desc = desc.replace(errorId, '').trim();
        if (desc) {
            input.setAttribute('aria-describedby', desc);
        } else {
            input.removeAttribute('aria-describedby');
        }
    }

    function clearFormErrors(form) {
        if (!form) return;
        form.querySelectorAll('.tl-input-invalid').forEach(function (input) {
            clearFieldError(input);
        });
        var summary = form.querySelector('.tl-form-error-summary');
        if (summary) summary.remove();
    }

    function focusFirstInvalidField(form) {
        if (!form) return;
        var first = form.querySelector('[aria-invalid="true"]');
        if (first) first.focus();
    }

    // -------------------------------------------------------------------------
    // 4. Slow network feedback
    // -------------------------------------------------------------------------
    var _slowNetworkTimers = {};

    /**
     * Shows a slow-network message after `delay` ms if task hasn't resolved.
     * Returns an object with a clear() method.
     */
    function runWithNetworkFeedback(task, opts) {
        opts = opts || {};
        var delay = opts.delay !== undefined ? opts.delay : 4000;
        var container = opts.container; // Element to append message to
        var msgEl = null;
        var timer = null;

        if (container && delay > 0) {
            timer = setTimeout(function () {
                if (!msgEl) {
                    msgEl = el('div', { class: 'tl-slow-network-msg', role: 'status', 'aria-live': 'polite' });
                    var spinSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    spinSvg.setAttribute('viewBox', '0 0 24 24');
                    spinSvg.setAttribute('fill', 'none');
                    spinSvg.setAttribute('stroke', 'currentColor');
                    spinSvg.setAttribute('stroke-width', '2');
                    spinSvg.setAttribute('aria-hidden', 'true');
                    spinSvg.innerHTML = '<path d="M21 12a9 9 0 11-6.219-8.56"/>';
                    var textSpan = document.createElement('span');
                    textSpan.textContent = opts.message || 'This is taking longer than usual. Please keep this page open.';
                    msgEl.appendChild(spinSvg);
                    msgEl.appendChild(textSpan);
                    container.appendChild(msgEl);
                }
            }, delay);
        }

        var clear = function () {
            if (timer) clearTimeout(timer);
            if (msgEl && msgEl.parentNode) msgEl.parentNode.removeChild(msgEl);
            msgEl = null;
        };

        if (task && typeof task.then === 'function') {
            return task.finally ? task.finally(clear) : task.then(clear, function (err) { clear(); return Promise.reject(err); });
        }

        return { clear: clear };
    }

    // -------------------------------------------------------------------------
    // 5. Toast — extends existing system without replacing it
    // -------------------------------------------------------------------------
    /**
     * If an existing toast system is present, we piggyback on it.
     * Otherwise we create our own minimal one.
     */
    function stripEmojis(text) {
        if (!text) return '';
        return String(text)
            .replace(/\p{Extended_Pictographic}/gu, '')
            .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2300}-\u{23FF}\u{2B50}\u{200D}\u{FE0F}]/gu, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function showToast(opts) {
        var message = typeof opts === 'string' ? opts : (opts.message || '');
        message = stripEmojis(message);
        var isError = opts.isError || false;
        var duration = opts.duration || 3500;

        // Check if existing toast system is available (auth-handler.js creates .toast-container)
        var container = document.querySelector('.toast-container');
        if (!container) {
            container = el('div', {
                class: 'toast-container',
                role: 'status',
                'aria-live': 'polite',
                'aria-atomic': 'true'
            });
            document.body.appendChild(container);
        }

        var toast = el('div', { class: 'toast' + (isError ? ' toast-error' : '') });
        // Build toast content safely with textContent
        var iconSpan = el('span');
        iconSpan.setAttribute('aria-hidden', 'true');
        iconSpan.style.cssText = 'font-size:18px;flex-shrink:0;';
        iconSpan.textContent = isError ? '✕' : '✓';
        var msgDiv = el('div');
        msgDiv.textContent = message;

        toast.style.cssText = 'display:flex;align-items:center;gap:10px;';
        toast.appendChild(iconSpan);
        toast.appendChild(msgDiv);

        container.appendChild(toast);
        setTimeout(function () { toast.classList.add('show'); }, 10);
        setTimeout(function () {
            toast.classList.remove('show');
            setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }, duration);
    }

    // -------------------------------------------------------------------------
    // 6. Connectivity Banner
    // -------------------------------------------------------------------------
    var _connectivityBanner = null;
    var _lastConnectivityState = null;
    var _reconnectTimer = null;

    function _ensureBanner() {
        if (_connectivityBanner) return _connectivityBanner;
        _connectivityBanner = el('div', {
            class: 'tl-network-banner',
            role: 'status',
            'aria-live': 'polite',
            'aria-atomic': 'true'
        });
        var iconEl = el('span', { class: 'tl-network-banner-icon', 'aria-hidden': 'true' });
        var textEl = el('span', { class: 'tl-network-banner-text' });
        var closeBtn = el('button', {
            class: 'tl-network-banner-close',
            'aria-label': 'Dismiss'
        });
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', function () {
            _connectivityBanner.classList.remove('tl-visible');
        });
        _connectivityBanner.appendChild(iconEl);
        _connectivityBanner.appendChild(textEl);
        _connectivityBanner.appendChild(closeBtn);
        document.body.insertBefore(_connectivityBanner, document.body.firstChild);
        return _connectivityBanner;
    }

    /**
     * @param {Object} opts
     *   state: 'offline'|'reconnected'
     */
    function showConnectivityState(opts) {
        opts = opts || {};
        var state = opts.state || 'offline';

        // Debounce same-state announcements
        if (_lastConnectivityState === state && state === 'offline') return;
        _lastConnectivityState = state;

        var banner = _ensureBanner();
        var textEl = banner.querySelector('.tl-network-banner-text');
        var iconEl = banner.querySelector('.tl-network-banner-icon');

        banner.classList.remove('tl-offline', 'tl-reconnected');

        if (state === 'offline') {
            banner.classList.add('tl-offline');
            iconEl.textContent = '⚡';
            if (textEl) {
                var title = el('strong');
                title.textContent = "You're offline — ";
                var msg = document.createTextNode("Some TrustLink features are unavailable. Your changes have not been submitted.");
                while (textEl.firstChild) textEl.removeChild(textEl.firstChild);
                textEl.appendChild(title);
                textEl.appendChild(msg);
            }
            banner.classList.add('tl-visible');
            if (_reconnectTimer) clearTimeout(_reconnectTimer);
        } else if (state === 'reconnected') {
            banner.classList.add('tl-reconnected');
            iconEl.textContent = '✓';
            if (textEl) {
                var title2 = el('strong');
                title2.textContent = "Connection restored — ";
                var msg2 = document.createTextNode("You're back online.");
                while (textEl.firstChild) textEl.removeChild(textEl.firstChild);
                textEl.appendChild(title2);
                textEl.appendChild(msg2);
            }
            banner.classList.add('tl-visible');
            _lastConnectivityState = null; // allow re-showing offline if it happens again
            if (_reconnectTimer) clearTimeout(_reconnectTimer);
            _reconnectTimer = setTimeout(function () {
                banner.classList.remove('tl-visible');
            }, 4000);
        }
    }

    // -------------------------------------------------------------------------
    // 7. Session Expired Dialog
    // -------------------------------------------------------------------------
    var _sessionDialog = null;

    function showSessionExpired(opts) {
        opts = opts || {};
        if (_sessionDialog) return; // prevent duplicates

        var overlay = el('div', {
            class: 'tl-session-overlay',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': 'Session expired',
            tabindex: '-1'
        });

        var dialog = el('div', { class: 'tl-session-dialog' });

        // Lock icon
        var iconWrap = el('div', { class: 'tl-session-dialog-icon' });
        var lockSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        lockSvg.setAttribute('viewBox', '0 0 24 24');
        lockSvg.setAttribute('fill', 'none');
        lockSvg.setAttribute('stroke', 'currentColor');
        lockSvg.setAttribute('stroke-width', '2');
        lockSvg.setAttribute('stroke-linecap', 'round');
        lockSvg.setAttribute('stroke-linejoin', 'round');
        lockSvg.setAttribute('aria-hidden', 'true');
        lockSvg.innerHTML = '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>';
        iconWrap.appendChild(lockSvg);

        var heading = el('h2');
        heading.textContent = opts.title || 'Your session has expired';

        var message = el('p');
        message.textContent = opts.message || 'For your security, please sign in again to continue.';

        var actionBtn = el('button', { class: 'tl-session-dialog-btn', type: 'button' });
        actionBtn.textContent = opts.actionLabel || 'Sign in again';

        actionBtn.addEventListener('click', function () {
            if (opts.onAction) {
                opts.onAction();
            } else {
                // Default: safe same-origin redirect to login.html
                var returnUrl = window.location.pathname + window.location.search;
                // Validate same-origin
                if (returnUrl.startsWith('/') || returnUrl.startsWith('./') || !returnUrl.startsWith('http')) {
                    try { sessionStorage.setItem('tl_return_url', returnUrl); } catch(e) {}
                }
                window.location.href = 'login.html';
            }
        });

        dialog.appendChild(iconWrap);
        dialog.appendChild(heading);
        dialog.appendChild(message);
        dialog.appendChild(actionBtn);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        _sessionDialog = overlay;

        // Prevent background scroll
        document.body.style.overflow = 'hidden';

        // Focus management
        overlay.focus();

        // Focus trap
        overlay.addEventListener('keydown', function (e) {
            if (e.key === 'Tab') {
                // Only one focusable element (actionBtn), trap focus there
                e.preventDefault();
                actionBtn.focus();
            }
            // No Escape dismiss — session expired must be acknowledged
        });

        setTimeout(function () { actionBtn.focus(); }, 50);
    }

    // -------------------------------------------------------------------------
    // 8. Connectivity monitoring
    // -------------------------------------------------------------------------
    function _initConnectivityMonitor() {
        window.addEventListener('online', function () {
            showConnectivityState({ state: 'reconnected' });
        });
        window.addEventListener('offline', function () {
            showConnectivityState({ state: 'offline' });
        });
        // Check initial state
        if (!navigator.onLine) {
            setTimeout(function () {
                showConnectivityState({ state: 'offline' });
            }, 1000);
        }
    }

    // -------------------------------------------------------------------------
    // 9. Skeleton helpers
    // -------------------------------------------------------------------------
    function renderSkeletonRows(container, count) {
        if (!container) return;
        clearState(container);
        var frag = document.createDocumentFragment();
        for (var i = 0; i < (count || 4); i++) {
            var row = el('div', { class: 'tl-skeleton-row' });
            var avatar = el('div', { class: 'tl-skeleton tl-skeleton-avatar' });
            var text = el('div', { class: 'tl-skeleton-text' });
            var line1 = el('div', { class: 'tl-skeleton tl-skeleton-line' });
            var line2 = el('div', { class: 'tl-skeleton tl-skeleton-line tl-skeleton-line-sm' });
            text.appendChild(line1);
            text.appendChild(line2);
            row.appendChild(avatar);
            row.appendChild(text);
            frag.appendChild(row);
        }
        var wrap = el('div', { 'aria-busy': 'true', 'aria-label': 'Loading…', 'data-tl-state': '1' });
        wrap.appendChild(frag);
        container.appendChild(wrap);
    }

    // -------------------------------------------------------------------------
    // 10. No search results helper
    // -------------------------------------------------------------------------
    /**
     * @param {Element} container — where to render the state
     * @param {string} query — the sanitized search term
     * @param {Function} onClear — callback when "Clear search" is clicked
     */
    function renderNoResults(container, query, onClear) {
        var safeQuery = String(query || '').trim().substring(0, 120);
        renderState(container, {
            type: 'search',
            icon: 'emptySearch',
            title: 'No results' + (safeQuery ? ' for "' + safeQuery + '"' : ''),
            message: 'Try another name, email, transaction ID or clear the filters.',
            actions: onClear ? [{
                label: 'Clear search',
                onClick: onClear,
                style: 'secondary'
            }] : []
        });
        // The title contains the query — but it was set via textContent in renderState,
        // so if the query contains HTML it is safely escaped.
        // However we must correct: renderState uses textContent for title, so the
        // concatenation above is safe — no XSS risk.
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------
    var TrustLinkUI = {
        renderState: renderState,
        clearState: clearState,
        setButtonLoading: setButtonLoading,
        setFieldError: setFieldError,
        clearFieldError: clearFieldError,
        clearFormErrors: clearFormErrors,
        focusFirstInvalidField: focusFirstInvalidField,
        showToast: showToast,
        showConnectivityState: showConnectivityState,
        showSessionExpired: showSessionExpired,
        runWithNetworkFeedback: runWithNetworkFeedback,
        renderSkeletonRows: renderSkeletonRows,
        renderNoResults: renderNoResults,
        init: _initConnectivityMonitor
    };

    // Expose globally
    global.TrustLinkUI = TrustLinkUI;

    // Auto-init connectivity monitoring when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _initConnectivityMonitor);
    } else {
        _initConnectivityMonitor();
    }

})(window);

// Unregister Service Worker to clear any buggy cached PWA state
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
        for (let registration of registrations) {
            registration.unregister().then(success => {
                if (success) console.log('Successfully unregistered service worker');
            });
        }
    });
}
