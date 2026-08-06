/**
 * Static validation test suite for TrustLink Escrow repository.
 * Run via `npm test`. Exits with code 0 on success, code 1 on failure.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

console.log("=== Running TrustLink Escrow Static Security & Reliability Validation ===");

let failures = 0;
function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ PASS: ${message}`);
    } else {
        console.error(`  ❌ FAIL: ${message}`);
        failures++;
    }
}

// 1. Required Legal & Core HTML/CSS/JS Files Exist
const requiredFiles = [
    'terms.html',
    'privacy.html',
    'index.html',
    'signup.html',
    'login.html',
    'verify.html',
    'api-docs.html',
    'dashboard.html',
    'admin-dashboard.html',
    'individuals.html',
    'online-vendors.html',
    'ecommerce.html',
    'marketplaces.html',
    'solutions.css',
    'solution-page.js',
    'legal.css',
    'legal.js',
    'api-docs.css',
    'api-docs.js',
    'docs/DESIGN_GUIDELINES.md',
    'moolre-service.js',
    'session-manager.js',
    'vendor/gsap.min.js',
    'img/mail-icon.svg',
    'LICENSE',
    'docs/SECURITY_SETUP.md',
    'vercel.json'
];

requiredFiles.forEach(relPath => {
    const fullPath = path.join(ROOT_DIR, relPath);
    assert(fs.existsSync(fullPath), `Required asset exists: ${relPath}`);
});

// 2. Check HTML files for obsolete node_modules & domain references
const htmlFiles = [
    'index.html',
    'signup.html',
    'login.html',
    'terms.html',
    'privacy.html',
    'verify.html',
    'api-docs.html',
    'dashboard.html',
    'admin-dashboard.html',
    'users-dashboard.html',
    'individuals.html',
    'online-vendors.html',
    'ecommerce.html',
    'marketplaces.html'
];

htmlFiles.forEach(file => {
    const fullPath = path.join(ROOT_DIR, file);
    if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        assert(!content.includes('node_modules/'), `${file} has no node_modules/ references`);
        assert(!content.includes('trustlink.co'), `${file} has no obsolete trustlink.co references`);
    }
});

// 3. Solution Page Specific Validations
const solutionPages = [
    { file: 'individuals.html', route: '/individuals' },
    { file: 'online-vendors.html', route: '/online-vendors' },
    { file: 'ecommerce.html', route: '/ecommerce' },
    { file: 'marketplaces.html', route: '/marketplaces' }
];

solutionPages.forEach(({ file, route }) => {
    const fullPath = path.join(ROOT_DIR, file);
    if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        assert(content.includes('solutions.css'), `${file} includes solutions.css`);
        assert(content.includes('solution-page.js'), `${file} includes solution-page.js`);
        assert((content.match(/<main/g) || []).length === 1, `${file} includes exactly one <main> landmark`);
        assert(content.includes(`rel="canonical" href="https://www.trustlinkgh.online${route}"`), `${file} includes correct canonical URL`);
        assert(content.includes('individuals.html'), `${file} links to individuals.html`);
        assert(content.includes('online-vendors.html'), `${file} links to online-vendors.html`);
        assert(content.includes('ecommerce.html'), `${file} links to ecommerce.html`);
        assert(content.includes('marketplaces.html'), `${file} links to marketplaces.html`);
        assert(content.includes('terms.html'), `${file} links to terms.html`);
        assert(content.includes('privacy.html'), `${file} links to privacy.html`);
        assert(!content.includes('localhost'), `${file} contains no development localhost URLs`);
    }
});

// 4. Verify No Exposed Moolre Secret String Literals in JS source files
const sensitiveJsFiles = [
    'moolre-service.js',
    'functions/index.js',
    'test-moolre.js',
    'test-moolre.mjs',
    'checkout.js',
    'dashboard.js',
    'admin-dashboard.js',
    'session-manager.js',
    'solution-page.js'
];

const secretLiteralsToDisallow = [
    /MOOLRE_SECRET_KEY\s*=\s*["'][^"']+["']/,
    /MOOLRE_PUBLIC_KEY\s*=\s*["']ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+["']/,
    /MOOLRE_PRIVATE_KEY\s*=\s*["'][A-Za-z0-9_]{20,}["']/,
    /MOOLRE_VAS_KEY\s*=\s*["'][A-Za-z0-9_]{10,}["']/,
    /SASUSYNC_API_KEY\s*=\s*["'][A-Za-z0-9_]{10,}["']/
];

sensitiveJsFiles.forEach(file => {
    const fullPath = path.join(ROOT_DIR, file);
    if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        secretLiteralsToDisallow.forEach((regex, idx) => {
            assert(!regex.test(content), `${file} contains no hardcoded credential literal matching rule #${idx + 1}`);
        });
    }
});

// 5. Verify WooCommerce Plugin Source
const wcGatewayFile = path.join(ROOT_DIR, 'trustlink-woocommerce-plugin', 'class-wc-gateway-trustlink.php');
if (fs.existsSync(wcGatewayFile)) {
    const content = fs.readFileSync(wcGatewayFile, 'utf8');
    assert(!content.includes('trustlink.co'), 'WooCommerce plugin gateway has no obsolete trustlink.co endpoint');
    assert(content.includes('api_url'), 'WooCommerce plugin gateway features configurable api_url setting');
}

// 6. Verify api-docs.js & api-docs.html security & integrity
const apiDocsJsFile = path.join(ROOT_DIR, 'api-docs.js');
if (fs.existsSync(apiDocsJsFile)) {
    const content = fs.readFileSync(apiDocsJsFile, 'utf8');
    assert(!content.includes('Request successful! Check the response panel.'), 'api-docs.js contains no fake success toast message');
    assert(!content.includes('fetch(') || !content.includes('/api/v1/escrows'), 'api-docs.js makes no unsafe sandbox fetch calls');
    assert(!content.includes('tl_live_preview_key'), 'api-docs.js contains no tl_live_preview_key fetch parameter');
    assert(!content.includes('data.apiKey'), 'api-docs.js does not inject user API keys into DOM elements');
}

const apiDocsHtmlFile = path.join(ROOT_DIR, 'api-docs.html');
if (fs.existsSync(apiDocsHtmlFile)) {
    const htmlContent = fs.readFileSync(apiDocsHtmlFile, 'utf8');
    assert(htmlContent.includes('rel="canonical" href="https://www.trustlinkgh.online/api-docs"'), 'api-docs.html includes correct canonical URL');
    assert(!htmlContent.includes('Ask TrustLink AI'), 'api-docs.html contains no unverified fake AI button');
    assert(!htmlContent.includes('localhost'), 'api-docs.html contains no development localhost URLs');
    assert(htmlContent.includes('YOUR_SECRET_API_KEY'), 'api-docs.html uses YOUR_SECRET_API_KEY as key placeholder');
    assert(htmlContent.includes('terms.html'), 'api-docs.html links to terms.html');
    assert(htmlContent.includes('privacy.html'), 'api-docs.html links to privacy.html');
    assert(htmlContent.includes('class="nav-links"'), 'api-docs.html includes public nav-links class');
    assert(htmlContent.includes('class="footer-links"'), 'api-docs.html includes public footer-links class');
}

// 7. Verify Sitemap XML
const sitemapFile = path.join(ROOT_DIR, 'sitemap.xml');
if (fs.existsSync(sitemapFile)) {
    const sitemapContent = fs.readFileSync(sitemapFile, 'utf8');
    assert(sitemapContent.includes('/api-docs'), 'sitemap.xml contains /api-docs entry');
}

// Final Summary
console.log("\n=======================================================");
if (failures === 0) {
    console.log("🎉 ALL STATIC VALIDATION CHECKS PASSED SUCCESSFULLY!");
    process.exit(0);
} else {
    console.error(`💥 VALIDATION FAILED WITH ${failures} FAILURE(S).`);
    process.exit(1);
}
