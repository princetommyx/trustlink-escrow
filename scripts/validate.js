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

// 1. Required Legal & Core HTML Files Exist
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
    'legal.css',
    'legal.js',
    'moolre-service.js',
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

// 2. Check HTML files for obsolete node_modules references
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
    'users-dashboard.html'
];

htmlFiles.forEach(file => {
    const fullPath = path.join(ROOT_DIR, file);
    if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        assert(!content.includes('node_modules/'), `${file} has no node_modules/ references`);
        assert(!content.includes('trustlink.co'), `${file} has no obsolete trustlink.co references`);
    }
});

// 3. Verify No Exposed Moolre Secret String Literals in JS source files
const sensitiveJsFiles = [
    'moolre-service.js',
    'functions/index.js',
    'test-moolre.js',
    'test-moolre.mjs',
    'checkout.js',
    'dashboard.js',
    'admin-dashboard.js'
];

const secretLiteralsToDisallow = [
    /MOOLRE_SECRET_KEY\s*=\s*["'][^"']+["']/,
    /MOOLRE_PUBLIC_KEY\s*=\s*["']ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+["']/,
    /MOOLRE_PRIVATE_KEY\s*=\s*["'][A-Za-z0-9_]{20,}["']/,
    /MOOLRE_VAS_KEY\s*=\s*["'][A-Za-z0-9_]{10,}["']/
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

// 4. Verify WooCommerce Plugin Source
const wcGatewayFile = path.join(ROOT_DIR, 'trustlink-woocommerce-plugin', 'class-wc-gateway-trustlink.php');
if (fs.existsSync(wcGatewayFile)) {
    const content = fs.readFileSync(wcGatewayFile, 'utf8');
    assert(!content.includes('trustlink.co'), 'WooCommerce plugin gateway has no obsolete trustlink.co endpoint');
    assert(content.includes('api_url'), 'WooCommerce plugin gateway features configurable api_url setting');
}

// 5. Verify api-docs.js fake timer removal
const apiDocsJsFile = path.join(ROOT_DIR, 'api-docs.js');
if (fs.existsSync(apiDocsJsFile)) {
    const content = fs.readFileSync(apiDocsJsFile, 'utf8');
    assert(!content.includes('Request successful! Check the response panel.'), 'api-docs.js contains no fake success toast message');
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
