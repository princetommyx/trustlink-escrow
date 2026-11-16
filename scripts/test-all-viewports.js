const fs = require('fs');

const pages = [
  'pages/index.html', 'pages/individuals.html', 'pages/online-vendors.html', 'pages/ecommerce.html',
  'pages/marketplaces.html', 'pages/api-docs.html', 'pages/contact.html', 'pages/terms.html', 'pages/privacy.html',
  'pages/login.html', 'pages/signup.html', 'pages/admin-login.html', 'pages/reset-password.html',
  'pages/verify.html', 'pages/checkout.html', 'pages/confirm.html', 'pages/dashboard.html',
  'pages/admin-dashboard.html', 'pages/users-dashboard.html'
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
