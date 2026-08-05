/**
 * solution-page.js - Interactive enhancement module for TrustLink Escrow Solution pages
 */
'use strict';

document.addEventListener('DOMContentLoaded', () => {
    // -------------------------------------------------------------
    // 1. Accessible FAQ Accordion Manager
    // -------------------------------------------------------------
    const faqButtons = document.querySelectorAll('.solution-faq-button');
    
    faqButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const isExpanded = btn.getAttribute('aria-expanded') === 'true';
            const item = btn.closest('.solution-faq-item');
            const parentList = btn.closest('.solution-faq-list');

            // Collapse all sibling questions in the list
            if (parentList) {
                parentList.querySelectorAll('.solution-faq-button').forEach(b => {
                    b.setAttribute('aria-expanded', 'false');
                    const it = b.closest('.solution-faq-item');
                    if (it) it.classList.remove('active');
                });
            }

            // Expand clicked question if it was not already open
            if (!isExpanded && item) {
                btn.setAttribute('aria-expanded', 'true');
                item.classList.add('active');
            }
        });
    });

    // -------------------------------------------------------------
    // 2. Sticky On-Page Navigation Scroll Spy
    // -------------------------------------------------------------
    const stickyLinks = document.querySelectorAll('.solution-nav-link');
    if (stickyLinks.length > 0) {
        const sections = Array.from(stickyLinks).map(link => {
            const targetId = link.getAttribute('href');
            return (targetId && targetId.startsWith('#')) ? document.querySelector(targetId) : null;
        }).filter(Boolean);

        if (sections.length > 0 && 'IntersectionObserver' in window) {
            const navObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const id = entry.target.getAttribute('id');
                        stickyLinks.forEach(link => {
                            const isMatch = link.getAttribute('href') === `#${id}`;
                            link.classList.toggle('active', isMatch);
                            if (isMatch) {
                                link.setAttribute('aria-current', 'location');
                            } else {
                                link.removeAttribute('aria-current');
                            }
                        });
                    }
                });
            }, {
                rootMargin: '-20% 0px -60% 0px',
                threshold: 0
            });

            sections.forEach(sec => navObserver.observe(sec));
        }
    }
});
