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

// 1. Required Legal, Security & Core Files Exist
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
    'docs/SECURITY_SETUP.md',
    'docs/BACKUP_AND_DISASTER_RECOVERY.md',
    '.env.example',
    'api/_utils/validator.js',
    'api/_utils/rate-limiter.js',
    'api/_utils/logger.js',
    'scripts/backup-firestore.js',
    'moolre-service.js',
    'session-manager.js',
    'vendor/gsap.min.js',
    'img/mail-icon.svg',
    'LICENSE',
    'vercel.json',
    'firestore.rules'
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

// 4. Verify No Exposed Secret String Literals in Source Code
const sensitiveJsFiles = [
    'moolre-service.js',
    'functions/index.js',
    'test-moolre.js',
    'test-moolre.mjs',
    'checkout.js',
    'dashboard.js',
    'admin-dashboard.js',
    'session-manager.js',
    'solution-page.js',
    'api/send-whatsapp.js',
    'api/webhook/whatsapp.js',
    'api/v1/sms/send.js'
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

// 5. Verify Firestore Database Security Rules
const firestoreRulesPath = path.join(ROOT_DIR, 'firestore.rules');
if (fs.existsSync(firestoreRulesPath)) {
    const rulesContent = fs.readFileSync(firestoreRulesPath, 'utf8');
    assert(!rulesContent.includes('allow read, write: if true;'), 'firestore.rules has NO open wildcard read/write rules');
    assert(rulesContent.includes('function isAuthenticated()'), 'firestore.rules contains isAuthenticated() helper');
    assert(rulesContent.includes('function isOwner('), 'firestore.rules contains isOwner() helper');
    assert(rulesContent.includes('match /audit_logs/{logId}'), 'firestore.rules protects immutable audit_logs collection');
}

// 6. Verify Vercel Enterprise Security Headers
const vercelConfigPath = path.join(ROOT_DIR, 'vercel.json');
if (fs.existsSync(vercelConfigPath)) {
    const vercelConfig = JSON.parse(fs.readFileSync(vercelConfigPath, 'utf8'));
    const headersList = vercelConfig.headers || [];
    const rootHeaders = headersList.find(h => h.source === '/(.*)')?.headers || [];
    const headerKeys = rootHeaders.map(h => h.key);
    
    assert(headerKeys.includes('Strict-Transport-Security'), 'vercel.json enforces Strict-Transport-Security (HSTS)');
    assert(headerKeys.includes('X-Content-Type-Options'), 'vercel.json enforces X-Content-Type-Options: nosniff');
    assert(headerKeys.includes('X-Frame-Options'), 'vercel.json enforces X-Frame-Options');
    assert(headerKeys.includes('Content-Security-Policy'), 'vercel.json enforces Content-Security-Policy');
}

// 7. Verify Serverless API Rate Limiting & Input Validation Integration
const smsSendPath = path.join(ROOT_DIR, 'api', 'v1', 'sms', 'send.js');
if (fs.existsSync(smsSendPath)) {
    const content = fs.readFileSync(smsSendPath, 'utf8');
    assert(content.includes('enforceRateLimit'), 'api/v1/sms/send.js integrates enforceRateLimit');
    assert(content.includes('validateGhanaPhone'), 'api/v1/sms/send.js integrates validateGhanaPhone');
    assert(content.includes('createRequestLogger'), 'api/v1/sms/send.js integrates structured logger');
}

const whatsappSendPath = path.join(ROOT_DIR, 'api', 'send-whatsapp.js');
if (fs.existsSync(whatsappSendPath)) {
    const content = fs.readFileSync(whatsappSendPath, 'utf8');
    assert(content.includes('enforceRateLimit'), 'api/send-whatsapp.js integrates enforceRateLimit');
    assert(content.includes('validateGhanaPhone'), 'api/send-whatsapp.js integrates validateGhanaPhone');
    assert(content.includes('validateAmount'), 'api/send-whatsapp.js integrates validateAmount');
}

// 8. Verify WooCommerce Plugin Source
const wcGatewayFile = path.join(ROOT_DIR, 'trustlink-woocommerce-plugin', 'class-wc-gateway-trustlink.php');
if (fs.existsSync(wcGatewayFile)) {
    const content = fs.readFileSync(wcGatewayFile, 'utf8');
    assert(!content.includes('trustlink.co'), 'WooCommerce plugin gateway has no obsolete trustlink.co endpoint');
    assert(content.includes('api_url'), 'WooCommerce plugin gateway features configurable api_url setting');
}

// 9. Final Summary
console.log("\n=======================================================");
if (failures === 0) {
    console.log("🎉 ALL STATIC VALIDATION & SECURITY CHECKS PASSED SUCCESSFULLY!");
    process.exit(0);
} else {
    console.error(`💥 VALIDATION FAILED WITH ${failures} FAILURE(S).`);
    process.exit(1);
}
