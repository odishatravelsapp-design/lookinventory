// Drives the running app end-to-end and saves screenshots to ./shots.
// Start a server first (npm start) on :8080, then: node tools/shots.js
const { chromium, devices } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase('look-inventory'));
  await page.goto('http://localhost:8080/');

  // 1. Onboarding wizard
  await page.locator('#onboard').waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, '01-onboarding');
  if (await page.locator('#obSkip').isVisible().catch(() => false)) {
    await page.click('#obSkip');
    await page.locator('#onboard').waitFor({ state: 'hidden' }).catch(() => {});
  }

  // 2. Stock list
  await page.waitForTimeout(300);
  await shot(page, '02-stock');

  // 3. Add-item dialog
  await page.click('#addItemBtn');
  await page.fill('#f_name', 'Sugar 1kg');
  await page.fill('#f_price', '45');
  await page.fill('#f_qty', '12');
  await page.waitForTimeout(200);
  await shot(page, '03-add-item');
  await page.click('#cancelItemBtn');

  // 4. Billing with a couple of items
  await page.click('.tab[data-view="bill"]');
  await page.fill('#billSearch', 'Parle');
  await page.click('#billSuggest li');
  await page.fill('#billSearch', 'Amul');
  await page.click('#billSuggest li');
  await page.waitForTimeout(200);
  await shot(page, '04-billing');

  // 5. Receipt
  await page.click('#checkoutBtn');
  await page.locator('#receiptDialog').waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  await shot(page, '05-receipt');
  await page.click('#receiptCloseBtn');

  // 6. Reports
  await page.click('.tab[data-view="settings"]');
  await page.click('#openReportsBtn');
  await page.waitForTimeout(300);
  await shot(page, '06-reports');
  await page.click('#reportsCloseBtn');

  // 7. To-Order
  await page.click('.tab[data-view="order"]');
  await page.waitForTimeout(200);
  await shot(page, '07-to-order');

  // 8. More hub
  await page.click('.tab[data-view="settings"]');
  await page.waitForTimeout(200);
  await shot(page, '08-more');

  // 9. Dark mode
  await page.click('#darkToggle');
  await page.click('.tab[data-view="inventory"]');
  await page.waitForTimeout(200);
  await shot(page, '09-dark');

  await browser.close();
  console.log('Screenshots saved to ./shots');
})();
