// Execute immediately since script is placed at end of body
// -------------------------------------------------------------
// Mobile Menu Controller
// -------------------------------------------------------------
const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
const navLinks = document.querySelector('.nav-links');

// Ensure mobile navigation backdrop exists
let navBackdrop = document.querySelector('.mobile-nav-backdrop');
if (!navBackdrop) {
    navBackdrop = document.createElement('div');
    navBackdrop.className = 'mobile-nav-backdrop';
    document.body.appendChild(navBackdrop);
}

const closeMobileMenu = () => {
    if (!navLinks) return;
    navLinks.classList.remove('active');
    if (navBackdrop) navBackdrop.classList.remove('active');
    document.body.style.overflow = '';
    if (mobileMenuBtn) {
        mobileMenuBtn.classList.remove('active');
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
    }
    // Also close any profile dropdown inside navLinks
    const profileMenu = navLinks.querySelector('.profile-menu');
    if (profileMenu) {
        profileMenu.classList.remove('open');
    }
};

const openMobileMenu = () => {
    if (!navLinks) return;
    navLinks.classList.add('active');
    if (navBackdrop) navBackdrop.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (mobileMenuBtn) {
        mobileMenuBtn.classList.add('active');
        mobileMenuBtn.setAttribute('aria-expanded', 'true');
    }
};

const toggleMobileMenu = (e) => {
    if (e) e.stopPropagation();
    if (navLinks && navLinks.classList.contains('active')) {
        closeMobileMenu();
    } else {
        openMobileMenu();
    }
};

if (mobileMenuBtn && navLinks) {
    mobileMenuBtn.addEventListener('click', toggleMobileMenu);

    // Close when tapping anywhere on the backdrop
    if (navBackdrop) {
        navBackdrop.addEventListener('click', closeMobileMenu);
        navBackdrop.addEventListener('touchstart', closeMobileMenu, { passive: true });
    }

    // Close on any click / tap outside the nav links and hamburger button (free space on page)
    document.addEventListener('click', (e) => {
        if (navLinks.classList.contains('active')) {
            if (!navLinks.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
                closeMobileMenu();
            }
        }
    });

    // Close when clicking links, or toggle mobile dropdowns
    navLinks.addEventListener('click', (e) => {
        const dropdownToggle = e.target.closest('.nav-link-dropdown-toggle');
        if (dropdownToggle) {
            e.preventDefault();
            const parentDropdown = dropdownToggle.closest('.nav-dropdown');
            if (parentDropdown) {
                const isOpen = parentDropdown.classList.contains('open');
                // Close other dropdowns
                document.querySelectorAll('.nav-dropdown').forEach(d => {
                    d.classList.remove('open');
                    d.classList.remove('active');
                });
                if (!isOpen) {
                    parentDropdown.classList.add('open');
                }
            }
            return;
        }

        const targetLink = e.target.closest('a');
        if (targetLink && !targetLink.classList.contains('nav-link-dropdown-toggle')) {
            closeMobileMenu();
        }
    });

    // Close on Escape key press
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && navLinks.classList.contains('active')) {
            closeMobileMenu();
        }
    });
}

// -------------------------------------------------------------
// Desktop Dropdown Hover Manager (with grace delay)
// Fixes the "gap between trigger and panel" problem and the
// position:fixed mega-menu that CSS :hover can't track.
// -------------------------------------------------------------
(function initDropdowns() {
    const CLOSE_DELAY = 180; // ms grace period before closing

    document.querySelectorAll('.nav-dropdown').forEach(dropdown => {
        let closeTimer = null;

        const open = () => {
            if (window.innerWidth <= 991) return;
            // Close any other open dropdowns first
            document.querySelectorAll('.nav-dropdown.active').forEach(other => {
                if (other !== dropdown) other.classList.remove('active');
            });
            clearTimeout(closeTimer);
            dropdown.classList.add('active');
        };

        const scheduleClose = () => {
            if (window.innerWidth <= 991) return;
            clearTimeout(closeTimer);
            closeTimer = setTimeout(() => {
                dropdown.classList.remove('active');
            }, CLOSE_DELAY);
        };

        const cancelClose = () => {
            clearTimeout(closeTimer);
        };

        // Trigger: hovering the toggle button
        const toggle = dropdown.querySelector('.nav-link-dropdown-toggle');
        if (toggle) {
            toggle.addEventListener('mouseenter', open);
            toggle.addEventListener('mouseleave', scheduleClose);
        }

        // Panel: hovering the dropdown menu keeps it open
        const menu = dropdown.querySelector('.dropdown-menu');
        if (menu) {
            menu.addEventListener('mouseenter', cancelClose);
            menu.addEventListener('mouseleave', scheduleClose);
        }

        // Close when clicking a link inside
        dropdown.addEventListener('click', (e) => {
            if (e.target.closest('a[href]')) {
                dropdown.classList.remove('active');
            }
        });
    });

    // Close all dropdowns on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.nav-dropdown')) {
            document.querySelectorAll('.nav-dropdown.active').forEach(d => d.classList.remove('active'));
        }
    });

    // Close all on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.nav-dropdown.active').forEach(d => d.classList.remove('active'));
        }
    });
})();

    // Navbar Scroll Effect
    const navbar = document.querySelector('.navbar');
    let ticking = false;
    window.addEventListener('scroll', () => {
        if (!ticking) {
            window.requestAnimationFrame(() => {
                if (window.scrollY > 50) {
                    navbar.classList.add('scrolled');
                } else if (window.scrollY === 0) {
                    navbar.classList.remove('scrolled');
                }
                ticking = false;
            });
            ticking = true;
        }
    });

    // Initial check
    if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
    }

    // Scroll Animations (Intersection Observer)
    const fadeUpElements = document.querySelectorAll('.fade-up');
    
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    fadeUpElements.forEach(element => {
        observer.observe(element);
    });

    // Mockup Animation Loop
    const steps = document.querySelectorAll('.mockup-progress .step');
    const lines = document.querySelectorAll('.mockup-progress .step-line');
    
    if (steps.length > 0) {
        let currentStep = 2; // Start from 3rd step (index 2)
        
        setInterval(() => {
            // Reset
            steps.forEach(s => s.classList.remove('active'));
            lines.forEach(l => l.classList.remove('active'));
            
            // Advance step
            currentStep = (currentStep + 1) % steps.length;
            
            // Apply active classes
            for(let i=0; i<=currentStep; i++) {
                steps[i].classList.add('active');
                if(i < currentStep && lines[i]) {
                    lines[i].classList.add('active');
                }
            }
            
        }, 3000);
    }

    // -------------------------------------------------------------
    // Showcase Category Tabs Controller
    // -------------------------------------------------------------
    const showcaseTabs = document.querySelectorAll('.showcase-tab');
    const showcasePanes = document.querySelectorAll('.showcase-pane');

    if (showcaseTabs.length > 0 && showcasePanes.length > 0) {
        showcaseTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.getAttribute('data-tab');
                if (!targetTab) return;

                // Update active tab states
                showcaseTabs.forEach(t => {
                    t.classList.remove('active');
                    t.setAttribute('aria-selected', 'false');
                });
                tab.classList.add('active');
                tab.setAttribute('aria-selected', 'true');

                // Switch visible pane
                showcasePanes.forEach(pane => {
                    if (pane.id === `pane-${targetTab}`) {
                        pane.classList.add('active');
                    } else {
                        pane.classList.remove('active');
                    }
                });
            });
        });
    }
