# 🎨 TrustLink Escrow — UI/UX Design & Collaboration Guidelines

> **Purpose:** Essential design system reference for engineering team members, UI designers, and open-source contributors working on TrustLink Escrow. Adhering to these guidelines ensures visual consistency, responsive performance, and premium user experience across all public pages, vendor dashboards, checkout flows, and legal documentation.

---

## 🎯 Design Philosophy

TrustLink Escrow builds confidence in social commerce across Ghana and West Africa. Our design aesthetic balances **fintech precision** with **modern, approachable simplicity**.

Key principles:
1. **Premium & Trustworthy:** Clean, high-contrast typography, generous whitespace, frosted-glass accents, and refined Slate blue color palettes.
2. **Mobile-First & In-App Browser Ready:** Lightweight HTML/CSS component structures that load instantly inside Instagram, TikTok, X, and WhatsApp browsers.
3. **Restrained Motion:** Smooth, micro-animations (180ms–350ms) that enhance usability without intruding or causing layout shifts.

---

## 🎨 Color Palette & Design Tokens

Always use CSS custom variables or the established hex tokens below instead of arbitrary color values.

### Brand & Neutrals

```css
:root {
    /* Brand Navy & Slate */
    --primary-dark: #0F172A;      /* Slate 900 - Primary headings, dark CTA cards, top navbar */
    --primary-surface: #1E293B;   /* Slate 800 - Secondary dark surfaces */
    --body-bg: #F8FAFC;          /* Slate 50 - Global light background */
    --card-bg: #FFFFFF;          /* Pure White - Card & modal containers */

    /* Accent & Interactive */
    --primary-blue: #2563EB;     /* Blue 600 - Primary buttons, key link accents */
    --primary-blue-hover: #1D4ED8;/* Blue 700 - Hover state for buttons */
    --primary-blue-light: #EFF6FF;/* Blue 50 - Subtle active callouts & TOC highlights */

    /* Typography Colors */
    --text-heading: #0F172A;     /* High-contrast headings */
    --text-body: #475569;        /* Slate 600 - Readable body text */
    --text-muted: #64748B;       /* Slate 500 - Form labels, metadata */
    --text-subtle: #94A3B8;      /* Slate 400 - Muted text on dark backgrounds */

    /* Borders & Shadows */
    --border-light: #E2E8F0;     /* Slate 200 - Standard card & divider borders */
    --border-subtle: #F1F5F9;    /* Slate 100 - Subtle section dividers */
    --shadow-sm: 0 4px 6px -1px rgba(0, 0, 0, 0.03);
    --shadow-md: 0 10px 15px -3px rgba(0, 0, 0, 0.05);
    --shadow-lg: 0 20px 25px -5px rgba(0, 0, 0, 0.10);
}
```

### Transaction State Machine Status Colors

Match Firestore transaction states with their official color coding:

| State Constant | Visual Category | Background | Text Color | Border / Accent |
| :--- | :--- | :--- | :--- | :--- |
| `PENDING_PAYMENT` | Warning / Awaiting | `#FEF3C7` (Amber 100) | `#D97706` (Amber 700) | `#F59E0B` |
| `FUNDS_ESCROWED` | Success / Ready to Ship | `#DCFCE7` (Emerald 100)| `#064E3B` (Emerald 900)| `#10B981` |
| `ITEM_SHIPPED` | In Transit / Info | `#E0F2FE` (Sky 100) | `#0284C7` (Sky 700) | `#0EA5E9` |
| `COMPLETED` | Released / Finished | `#DBEAFE` (Blue 100) | `#1D4ED8` (Blue 700) | `#3B82F6` |
| `DISPUTED` | Danger / Action Needed| `#FEE2E2` (Red 100) | `#DC2626` (Red 600) | `#EF4444` |
| `REFUNDED` | Muted Return | `#F1F5F9` (Slate 100) | `#475569` (Slate 600) | `#94A3B8` |

---

## 🔤 Typography & Font Hierarchy

TrustLink uses two primary Google Fonts loaded via HTML head:

1. **Headings & Titles:** `'Outfit', sans-serif` (Weights: 500, 600, 700, 800, 900)
2. **Body Copy, Inputs & Controls:** `'Inter', system-ui, -apple-system, sans-serif` (Weights: 400, 500, 600, 700)
3. **Code & API Documentation:** Monospace (`'JetBrains Mono'`, `'Fira Code'`, or browser monospace)

### Typographic Scale

```css
/* Hero Headings */
.hero-title {
    font-family: 'Outfit', sans-serif;
    font-size: clamp(2.5rem, 5vw + 1rem, 4.5rem);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.1;
    color: #0F172A;
}

/* Section Headings (H2) */
h2 {
    font-family: 'Outfit', sans-serif;
    font-size: clamp(1.75rem, 3vw, 2.75rem);
    font-weight: 700;
    letter-spacing: -0.02em;
    color: #0F172A;
}

/* Card & Component Titles (H3/H4) */
h3, h4 {
    font-family: 'Outfit', sans-serif;
    font-weight: 600;
    color: #0F172A;
}

/* Body Paragraphs */
p {
    font-family: 'Inter', sans-serif;
    font-size: 1rem;
    line-height: 1.7;
    color: #475569;
}
```

---

## 📐 Layout, Grid & Responsiveness

### Container Widths & Margins

- **Standard Container:** `max-width: 1200px; margin: 0 auto; padding: 0 24px;`
- **Legal & Reading Container:** `max-width: 1100px; margin: 0 auto; padding: 0 20px;`
- **Dashboard Main Area:** Fluid max-width `1440px`.

### Standard Breakpoints

Ensure layouts render cleanly across all target viewport sizes:
- `320px` (Small handsets)
- `375px` (Standard smartphones)
- `768px` (Tablets / Mobile drawer navigation cutoff)
- `1024px` (Desktops / Sticky sidebar activation)
- `1440px` (Wide desktop displays)

Rule: **Zero horizontal scrolling allowed on any viewport.**

---

## 🧩 UI Components & Control Styling

### 1. Primary & Secondary Buttons

```css
/* Primary Action Button */
.btn-primary {
    background-color: #0F172A;
    color: #FFFFFF;
    font-family: 'Inter', sans-serif;
    font-size: 0.95rem;
    font-weight: 600;
    padding: 12px 24px;
    border-radius: 10px;
    border: none;
    cursor: pointer;
    transition: all 0.2s ease-in-out;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    text-decoration: none;
}

.btn-primary:hover {
    background-color: #1E293B;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.15);
}

/* Accent Action Button (e.g. Dashboard CTA) */
.btn-accent {
    background-color: #2563EB;
    color: #FFFFFF;
}

.btn-accent:hover {
    background-color: #1D4ED8;
}

/* Outline Button */
.btn-outline {
    background: transparent;
    border: 1px solid #E2E8F0;
    color: #0F172A;
    font-weight: 500;
    padding: 12px 24px;
    border-radius: 10px;
}

.btn-outline:hover {
    border-color: #0F172A;
    background-color: #F8FAFC;
}
```

### 2. Cards & Containers

```css
.bento-card, .legal-content-card {
    background-color: #FFFFFF;
    border: 1px solid #E2E8F0;
    border-radius: 16px;
    padding: 32px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.03);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}

/* Hover state for interactive cards */
.bento-card:hover {
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.06);
}
```

### 3. Badges & Pills

```css
.badge {
    display: inline-block;
    font-family: 'Inter', sans-serif;
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 4px 12px;
    border-radius: 9999px;
    background-color: #EFF6FF;
    color: #2563EB;
}
```

### 4. Forms & Input Controls

```css
.form-group {
    margin-bottom: 20px;
    text-align: left;
}

.form-group label {
    display: block;
    font-size: 0.9rem;
    font-weight: 600;
    color: #0F172A;
    margin-bottom: 8px;
}

.form-group input,
.form-group select,
.form-group textarea {
    width: 100%;
    padding: 12px 16px;
    font-size: 0.95rem;
    border: 1px solid #E2E8F0;
    border-radius: 8px;
    background-color: #FFFFFF;
    color: #0F172A;
    transition: border-color 0.15s ease;
}

.form-group input:focus {
    outline: none;
    border-color: #2563EB;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}
```

---

## ⚡ Animation & Motion Language

Animations must remain subtle, non-intrusive, and fast.

1. **Duration:** 180ms to 350ms maximum.
2. **Timing Function:** `ease-out` or `cubic-bezier(0.16, 1, 0.3, 1)`.
3. **Entrance Animations:** Fade up with vertical distance capped at `8px`–`12px`.
4. **Reduced Motion:** Always include `@media (prefers-reduced-motion: reduce)` fallbacks to disable transforms and keyframe loops for sensitive users.

```css
@media (prefers-reduced-motion: reduce) {
    *, ::before, ::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
    }
}
```

---

## ♿ Accessibility Guidelines (WCAG 2.1 AA)

1. **Focus Rings:** Never remove focus outlines without adding a visible `:focus-visible` replacement (`outline: 2px solid #2563EB; outline-offset: 2px`).
2. **Text Contrast:** Ensure all body text meets a minimum contrast ratio of 4.5:1 against its background.
3. **Touch Targets:** Buttons and interactive controls on mobile must have a minimum tap target of `44px x 44px`.
4. **Semantic HTML:** Use semantic elements (`<header>`, `<nav>`, `<main>`, `<article>`, `<aside>`, `<footer>`) instead of generic `<div>` trees.

---

## 🛠️ Developer Rules for Contributions

- Do **not** import TailwindCSS, Bootstrap, or heavy external UI frameworks.
- Do **not** hardcode static pixel values for complex responsive text; use `clamp()`.
- Do **not** use `#` for links; link to actual routes (e.g. `terms.html`, `privacy.html`, `signup.html`).
- Ensure all Ghanaian cedi currency values use `GH₵` for display and `GHS` for backend payloads.
