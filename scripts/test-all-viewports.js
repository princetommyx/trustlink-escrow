const fs = require('fs');

const pages = [
  'index.html', 'individuals.html', 'online-vendors.html', 'ecommerce.html',
  'marketplaces.html', 'api-docs.html', 'contact.html', 'terms.html', 'privacy.html',
  'login.html', 'signup.html', 'admin-login.html', 'reset-password.html',
  'verify.html', 'checkout.html', 'confirm.html', 'dashboard.html',
  'admin-dashboard.html', 'users-dashboard.html'
];

console.log(`=== Auditing ${pages.length} Pages across Structural & Mobile Rules ===`);

let totalPassed = 0;
let totalChecked = 0;

pages.forEach(page => {
  if (!fs.existsSync(page)) {
    console.error(`❌ Page not found: ${page}`);
    return;
  }

  const content = fs.readFileSync(page, 'utf8');

  // Static checks
  const hasViewport = content.includes('viewport');
  const hasSingleMain = (content.match(/<main/g) || []).length <= 1;

  if (hasViewport && hasSingleMain) {
    totalPassed++;
  } else {
    console.error(`❌ ${page} failed static responsive checks.`);
  }
  totalChecked++;
});

console.log(`\nResults: ${totalPassed}/${totalChecked} pages passed core structural responsive checks.`);
