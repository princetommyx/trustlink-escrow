import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { initSessionTracker } from "./session-manager.js";

/**
 * TrustLink Escrow — Public API Documentation Interactivity Module
 * Namespaced selectors to avoid collisions with public site components.
 * Exposes copy utilities, code language tab switcher, client-side search engine,
 * IntersectionObserver scroll spy, and offline network listener.
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- 1. Session Persistence & Security Controls ---
    onAuthStateChanged(auth, (user) => {
        if (user) {
            initSessionTracker({ auth, userType: 'user' });
        }
        // Note: Secret API keys are strictly kept server-side and never exposed in DOM.
    });

    // --- 2. Clipboard Copy Utilities ---
    const btnCopyBaseUrl = document.getElementById('btn-copy-base-url');
    if (btnCopyBaseUrl) {
        btnCopyBaseUrl.addEventListener('click', () => {
            const baseUrlText = 'https://www.trustlinkgh.online/api/v1';
            copyTextToClipboard(baseUrlText, btnCopyBaseUrl, 'Copy URL', 'Copied URL!');
        });
    }

    const btnCopyHeroCode = document.getElementById('btn-copy-hero-code');
    if (btnCopyHeroCode) {
        btnCopyHeroCode.addEventListener('click', () => {
            const snippet = document.getElementById('hero-curl-snippet');
            if (snippet) {
                copyTextToClipboard(snippet.textContent, btnCopyHeroCode, 'Copy', 'Copied!');
            }
        });
    }

    const btnCopyCode = document.getElementById('btn-copy-code');
    if (btnCopyCode) {
        btnCopyCode.addEventListener('click', () => {
            const activePanelCode = document.querySelector('.code-tab-panel.active code');
            if (activePanelCode) {
                copyTextToClipboard(activePanelCode.textContent, btnCopyCode, 'Copy Code', 'Copied!');
            }
        });
    }

    function copyTextToClipboard(text, buttonEl, defaultLabel, successLabel) {
        if (!navigator.clipboard) {
            fallbackCopyText(text, buttonEl, defaultLabel, successLabel);
            return;
        }

        navigator.clipboard.writeText(text).then(() => {
            showCopySuccess(buttonEl, defaultLabel, successLabel);
        }).catch(() => {
            showCopyFailure(buttonEl, defaultLabel);
        });
    }

    function fallbackCopyText(text, buttonEl, defaultLabel, successLabel) {
        try {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            showCopySuccess(buttonEl, defaultLabel, successLabel);
        } catch (_) {
            showCopyFailure(buttonEl, defaultLabel);
        }
    }

    function showCopySuccess(buttonEl, defaultLabel, successLabel) {
        const textSpan = buttonEl.querySelector('span');
        if (textSpan) textSpan.textContent = successLabel;
        buttonEl.style.borderColor = '#10B981';
        buttonEl.style.color = '#10B981';

        setTimeout(() => {
            if (textSpan) textSpan.textContent = defaultLabel;
            buttonEl.style.borderColor = '';
            buttonEl.style.color = '';
        }, 2000);
    }

    function showCopyFailure(buttonEl, defaultLabel) {
        const textSpan = buttonEl.querySelector('span');
        if (textSpan) textSpan.textContent = 'Copy failed';
        buttonEl.style.borderColor = '#EF4444';
        buttonEl.style.color = '#EF4444';

        setTimeout(() => {
            if (textSpan) textSpan.textContent = defaultLabel;
            buttonEl.style.borderColor = '';
            buttonEl.style.color = '';
        }, 2000);
    }

    // --- 3. Accessible Code Language Tabs ---
    const codeTabBtns = Array.from(document.querySelectorAll('.code-tab-btn'));
    const codeTabPanels = Array.from(document.querySelectorAll('.code-tab-panel'));

    codeTabBtns.forEach((tabBtn, index) => {
        tabBtn.addEventListener('click', () => {
            activateTab(index);
        });

        tabBtn.addEventListener('keydown', (e) => {
            let targetIndex = index;
            if (e.key === 'ArrowRight') {
                targetIndex = (index + 1) % codeTabBtns.length;
            } else if (e.key === 'ArrowLeft') {
                targetIndex = (index - 1 + codeTabBtns.length) % codeTabBtns.length;
            } else if (e.key === 'Home') {
                targetIndex = 0;
            } else if (e.key === 'End') {
                targetIndex = codeTabBtns.length - 1;
            } else {
                return;
            }
            e.preventDefault();
            codeTabBtns[targetIndex].focus();
            activateTab(targetIndex);
        });
    });

    function activateTab(activeIndex) {
        codeTabBtns.forEach((btn, idx) => {
            const isSelected = idx === activeIndex;
            btn.classList.toggle('active', isSelected);
            btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        });

        codeTabPanels.forEach((panel, idx) => {
            const isSelected = idx === activeIndex;
            panel.classList.toggle('active', isSelected);
            if (isSelected) {
                panel.removeAttribute('hidden');
            } else {
                panel.setAttribute('hidden', '');
            }
        });
    }

    // --- 4. Client-Side Documentation Search Engine ---
    const searchInput = document.getElementById('api-search-input');
    const searchClearBtn = document.getElementById('btn-clear-search');
    const searchResultsDropdown = document.getElementById('search-results-dropdown');

    // Index all documentation sections
    const searchIndex = Array.from(document.querySelectorAll('.doc-section')).map(section => {
        const id = section.getAttribute('id');
        const heading = section.querySelector('h2')?.textContent || '';
        const paragraphs = Array.from(section.querySelectorAll('p, li, td'))
            .map(el => el.textContent)
            .join(' ');
        return {
            id,
            heading,
            text: (heading + ' ' + paragraphs).toLowerCase()
        };
    });

    let searchDebounceTimer = null;
    let selectedResultIndex = -1;

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchDebounceTimer);
            const query = searchInput.value.trim();

            if (searchClearBtn) {
                searchClearBtn.hidden = query.length === 0;
            }

            if (query.length < 2) {
                hideSearchResults();
                return;
            }

            searchDebounceTimer = setTimeout(() => {
                performSearch(query);
            }, 150);
        });

        searchInput.addEventListener('keydown', (e) => {
            const results = searchResultsDropdown.querySelectorAll('.search-result-item');
            if (!results.length) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedResultIndex = (selectedResultIndex + 1) % results.length;
                updateResultSelection(results);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedResultIndex = (selectedResultIndex - 1 + results.length) % results.length;
                updateResultSelection(results);
            } else if (e.key === 'Enter' && selectedResultIndex >= 0) {
                e.preventDefault();
                results[selectedResultIndex].click();
            } else if (e.key === 'Escape') {
                hideSearchResults();
            }
        });
    }

    if (searchClearBtn) {
        searchClearBtn.addEventListener('click', () => {
            searchInput.value = '';
            searchClearBtn.hidden = true;
            hideSearchResults();
            searchInput.focus();
        });
    }

    function performSearch(query) {
        const lowerQuery = query.toLowerCase();
        const matches = searchIndex.filter(item => item.text.includes(lowerQuery));

        searchResultsDropdown.innerHTML = '';
        selectedResultIndex = -1;

        if (matches.length === 0) {
            const noResults = document.createElement('div');
            noResults.className = 'search-no-results';
            noResults.textContent = 'No documentation sections match your search.';
            searchResultsDropdown.appendChild(noResults);
        } else {
            matches.forEach(match => {
                const item = document.createElement('a');
                item.className = 'search-result-item';
                item.href = `#${match.id}`;
                item.setAttribute('role', 'option');

                const title = document.createElement('span');
                title.className = 'search-result-title';
                title.textContent = match.heading;

                const snippet = document.createElement('span');
                snippet.className = 'search-result-snippet';
                snippet.textContent = `Section: ${match.heading}`;

                item.appendChild(title);
                item.appendChild(snippet);

                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    hideSearchResults();
                    const targetEl = document.getElementById(match.id);
                    if (targetEl) {
                        targetEl.scrollIntoView({ behavior: 'smooth' });
                        window.history.pushState(null, '', `#${match.id}`);
                    }
                });

                searchResultsDropdown.appendChild(item);
            });
        }

        searchResultsDropdown.hidden = false;
    }

    function updateResultSelection(results) {
        results.forEach((el, idx) => {
            if (idx === selectedResultIndex) {
                el.classList.add('selected');
                el.scrollIntoView({ block: 'nearest' });
            } else {
                el.classList.remove('selected');
            }
        });
    }

    function hideSearchResults() {
        if (searchResultsDropdown) searchResultsDropdown.hidden = true;
        selectedResultIndex = -1;
    }

    document.addEventListener('click', (e) => {
        if (searchResultsDropdown && !searchResultsDropdown.contains(e.target) && !searchInput.contains(e.target)) {
            hideSearchResults();
        }
    });

    // --- 5. IntersectionObserver Scroll Spy ---
    const sections = document.querySelectorAll('.doc-section');
    const tocLinks = document.querySelectorAll('.toc-item');

    if ('IntersectionObserver' in window && sections.length > 0) {
        const observerOptions = {
            root: null,
            rootMargin: '-100px 0px -60% 0px',
            threshold: 0
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const id = entry.target.getAttribute('id');
                    updateActiveTocLink(id);
                }
            });
        }, observerOptions);

        sections.forEach(section => observer.observe(section));
    }

    function updateActiveTocLink(activeId) {
        tocLinks.forEach(link => {
            const sectionTarget = link.getAttribute('data-section');
            if (sectionTarget === activeId) {
                link.classList.add('active');
                link.setAttribute('aria-current', 'location');
            } else {
                link.classList.remove('active');
                link.removeAttribute('aria-current');
            }
        });
    }

    // --- 6. Mobile TOC Drawer Toggle ---
    const btnTocToggle = document.getElementById('btn-toc-toggle');
    const apiDocsToc = document.getElementById('api-docs-toc');

    if (btnTocToggle && apiDocsToc) {
        btnTocToggle.addEventListener('click', () => {
            const isOpen = apiDocsToc.classList.toggle('open');
            btnTocToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });

        tocLinks.forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth < 1024 && apiDocsToc.classList.contains('open')) {
                    apiDocsToc.classList.remove('open');
                    btnTocToggle.setAttribute('aria-expanded', 'false');
                }
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && apiDocsToc.classList.contains('open')) {
                apiDocsToc.classList.remove('open');
                btnTocToggle.setAttribute('aria-expanded', 'false');
                btnTocToggle.focus();
            }
        });

        document.addEventListener('click', (e) => {
            if (window.innerWidth < 1024 &&
                apiDocsToc.classList.contains('open') &&
                !apiDocsToc.contains(e.target) &&
                !btnTocToggle.contains(e.target)) {
                apiDocsToc.classList.remove('open');
                btnTocToggle.setAttribute('aria-expanded', 'false');
            }
        });
    }

    // --- 7. Offline Network Listener ---
    const offlineBanner = document.getElementById('offline-banner');
    function updateNetworkStatus() {
        if (offlineBanner) {
            offlineBanner.hidden = navigator.onLine;
        }
    }

    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    updateNetworkStatus();
});
