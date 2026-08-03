/**
 * TrustLink Escrow - Legal Pages Interactive JavaScript (terms.html & privacy.html)
 */
document.addEventListener('DOMContentLoaded', () => {
    // 1. Table of Contents Intersection Observer & Highlighting
    const tocLinks = document.querySelectorAll('.legal-toc-link');
    const sections = document.querySelectorAll('.legal-section');

    if (sections.length > 0 && tocLinks.length > 0) {
        const observerOptions = {
            root: null,
            rootMargin: '-100px 0px -60% 0px',
            threshold: 0
        };

        const sectionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const activeId = entry.target.getAttribute('id');
                    tocLinks.forEach(link => {
                        const href = link.getAttribute('href');
                        if (href === `#${activeId}`) {
                            link.classList.add('active');
                            link.setAttribute('aria-current', 'true');
                        } else {
                            link.classList.remove('active');
                            link.removeAttribute('aria-current');
                        }
                    });
                }
            });
        }, observerOptions);

        sections.forEach(section => sectionObserver.observe(section));
    }

    // 2. Smooth Scroll for TOC Anchor Links
    tocLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            const href = link.getAttribute('href');
            if (href && href.startsWith('#')) {
                const targetEl = document.querySelector(href);
                if (targetEl) {
                    e.preventDefault();
                    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    targetEl.scrollIntoView({
                        behavior: prefersReduced ? 'auto' : 'smooth'
                    });
                    // Focus target heading for accessibility
                    targetEl.setAttribute('tabindex', '-1');
                    targetEl.focus({ preventScroll: true });
                }
            }
        });
    });

    // 3. Back-to-Top Button Controller
    const backToTopBtn = document.getElementById('legal-back-top');
    if (backToTopBtn) {
        let scrollTicking = false;
        window.addEventListener('scroll', () => {
            if (!scrollTicking) {
                window.requestAnimationFrame(() => {
                    if (window.scrollY > 400) {
                        backToTopBtn.classList.add('visible');
                    } else {
                        backToTopBtn.classList.remove('visible');
                    }
                    scrollTicking = false;
                });
                scrollTicking = true;
            }
        });

        backToTopBtn.addEventListener('click', () => {
            const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            window.scrollTo({
                top: 0,
                behavior: prefersReduced ? 'auto' : 'smooth'
            });
        });
    }
});
