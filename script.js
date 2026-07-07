// Execute immediately since script is placed at end of body
    // Mobile Menu Toggle
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const navLinks = document.querySelector('.nav-links');

    if (mobileMenuBtn && navLinks) {
        mobileMenuBtn.addEventListener('click', () => {
            navLinks.classList.toggle('active');
            // Toggle hamburger animation
            const spans = mobileMenuBtn.querySelectorAll('span');
            if (navLinks.classList.contains('active')) {
                spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
                spans[1].style.opacity = '0';
                spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
            } else {
                spans[0].style.transform = 'none';
                spans[1].style.opacity = '1';
                spans[2].style.transform = 'none';
            }
        });
    }

    // Navbar Scroll Effect
    const navbar = document.querySelector('.navbar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.add('scrolled'); // keep it or remove it depending on preference, let's toggle it
            if(window.scrollY === 0) navbar.classList.remove('scrolled');
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
