const fs = require('fs');
const path = require('path');

const pages = [
  'index.html', 'individuals.html', 'online-vendors.html', 'ecommerce.html',
  'marketplaces.html', 'api-docs.html', 'contact.html', 'terms.html', 'privacy.html',
  'login.html', 'signup.html', 'admin-login.html', 'reset-password.html',
  'verify.html', 'checkout.html', 'confirm.html', 'dashboard.html',
  'admin-dashboard.html', 'users-dashboard.html'
];

console.log('=== TrustLink 19-Page Responsive Audit ===');
let errorsFound = 0;

pages.forEach(p => {
  if (!fs.existsSync(p)) {
    console.error('❌ MISSING FILE:', p);
    errorsFound++;
    return;
  }
  const content = fs.readFileSync(p, 'utf8');
  
  // Check 1: Viewport meta tag
  const hasViewport = content.includes('name="viewport"') || content.includes("name='viewport'");
  if (!hasViewport) {
    console.error(`❌ Page ${p} is missing <meta name="viewport">!`);
    errorsFound++;
  }

  // Check 2: Inline fixed pixel widths (> 300px) that could overflow mobile 320px screens
  const inlineWidthMatches = content.match(/style="[^"]*width:\s*[3-9]\d{2}px[^"]*"/gi) || [];
  const inlineMinWidthMatches = content.match(/style="[^"]*min-width:\s*[3-9]\d{2}px[^"]*"/gi) || [];
  
  const hasUnboundedTable = inlineMinWidthMatches.some(m => !m.includes('overflow-x') && !content.includes('overflow-x: auto'));

  console.log(`Page: ${p.padEnd(22)} | Viewport: ${hasViewport ? 'PASS' : 'FAIL'} | Inline Widths: ${inlineWidthMatches.length + inlineMinWidthMatches.length}`);

  if (hasUnboundedTable) {
    console.warn(`  ⚠️ Warning: Page ${p} has min-width table without overflow wrapper.`);
  }
});

console.log(`\nAudit complete. Total issues found: ${errorsFound}`);
