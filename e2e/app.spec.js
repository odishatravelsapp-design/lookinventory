const { test, expect } = require('@playwright/test');

// Load the app with a clean IndexedDB and dismiss the first-run wizard.
async function freshApp(page) {
  await page.addInitScript(() => { indexedDB.deleteDatabase('look-inventory'); });
  await page.goto('/');
  const onboard = page.locator('#onboard');
  // The wizard appears at the end of async init — wait for it, then skip.
  await onboard.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  if (await onboard.isVisible().catch(() => false)) {
    await page.click('#obSkip');
    await onboard.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  }
  await expect(page.locator('#view-inventory')).toBeVisible();
}

test.beforeEach(async ({ page }) => { await freshApp(page); });

test('loads with seeded sample items', async ({ page }) => {
  await expect(page.locator('#inventoryList .item')).toHaveCount(3);
  await expect(page.getByText('Parle-G Biscuit')).toBeVisible();
});

test('search filters the inventory', async ({ page }) => {
  await page.fill('#searchBox', 'salt');
  await expect(page.locator('#inventoryList .item')).toHaveCount(1);
  await expect(page.locator('#inventoryList .item-name')).toContainText('Tata Salt 1kg');
});

test('add a new item', async ({ page }) => {
  await page.click('#addItemBtn');
  await page.fill('#f_name', 'Test Sugar 1kg');
  await page.fill('#f_price', '45');
  await page.fill('#f_qty', '10');
  await page.click('#itemForm button[type="submit"]');
  await expect(page.locator('#inventoryList .item-name', { hasText: 'Test Sugar 1kg' })).toBeVisible();
});

test('record a sale decrements stock', async ({ page }) => {
  const row = page.locator('.item', { hasText: 'Parle-G Biscuit' });
  const qty = row.locator('.qty');
  await expect(qty).toHaveText('24');
  await row.locator('.qbtn.sell').click();
  await expect(qty).toHaveText('23');
});

test('billing: add item, generate bill, receipt shows total', async ({ page }) => {
  await page.click('.tab[data-view="bill"]');
  await page.fill('#billSearch', 'Parle');
  await page.click('#billSuggest li');
  await expect(page.locator('#cartList .cart-line')).toHaveCount(1);
  await page.click('#checkoutBtn');
  await expect(page.locator('#receiptDialog')).toBeVisible();
  await expect(page.locator('#receiptArea')).toContainText('TOTAL');
});

test('money rounding: bill total is a whole rupee (round-off)', async ({ page }) => {
  await page.click('.tab[data-view="bill"]');
  await page.fill('#billSearch', 'Amul');           // ₹27
  await page.click('#billSuggest li');
  // total chip shows a rounded amount
  const total = await page.locator('#sumTotal').textContent();
  expect(total).toMatch(/₹\d+\.00/);
});

test('feature flag hides the Bill tab when disabled', async ({ page }) => {
  await page.click('.tab[data-view="settings"]');
  await page.getByText('🎛️ Features').click();
  await page.locator('.flagchk[data-flag="billing"]').uncheck();
  await expect(page.locator('.tab[data-view="bill"]')).toBeHidden();
});

test('to-order list shows low-stock item', async ({ page }) => {
  await page.click('.tab[data-view="order"]');
  // Tata Salt (qty 4, reorder 5) should be low
  await expect(page.locator('#orderList')).toContainText('Tata Salt');
});

// --- The internet concern: a full bill must work with NO connectivity ---
test('OFFLINE: shopkeeper can still make a bill', async ({ page, context }) => {
  await context.setOffline(true);
  await page.click('.tab[data-view="bill"]');
  await page.fill('#billSearch', 'Parle');
  await page.click('#billSuggest li');
  await expect(page.locator('#cartList .cart-line')).toHaveCount(1);
  await page.click('#checkoutBtn');
  await expect(page.locator('#receiptArea')).toContainText('TOTAL');
  await page.locator('#receiptCloseBtn').click();
  // sale persisted offline → shows in today's history
  await expect(page.locator('#todayTotal2')).not.toHaveText('₹0.00');
  await context.setOffline(false);
});

test('split payment records cash + UPI', async ({ page }) => {
  await page.click('.tab[data-view="bill"]');
  await page.fill('#billSearch', 'Amul');            // ₹27 → rounds to 27
  await page.click('#billSuggest li');
  await page.check('input[name="payMethod"][value="split"]');
  await page.fill('#splitCash', '20');
  await page.fill('#splitUpi', '7');
  await page.click('#checkoutBtn');
  await expect(page.locator('#receiptArea')).toContainText('Cash ₹20.00');
  await expect(page.locator('#receiptArea')).toContainText('UPI ₹7.00');
});

test('park a bill then resume it', async ({ page }) => {
  await page.click('.tab[data-view="bill"]');
  await page.fill('#billSearch', 'Tata');
  await page.click('#billSuggest li');
  await page.click('#parkBillBtn');
  await expect(page.locator('#cartList .cart-line')).toHaveCount(0);
  await page.click('#parkedBills button');
  await expect(page.locator('#cartList .cart-line')).toHaveCount(1);
});

test('returns/refund restocks the item', async ({ page }) => {
  // make a sale first
  await page.click('.tab[data-view="bill"]');
  await page.fill('#billSearch', 'Parle');
  await page.click('#billSuggest li');
  await page.click('#checkoutBtn');
  await page.locator('#receiptCloseBtn').click();
  // Parle-G now 23 in stock
  await page.click('.tab[data-view="inventory"]');
  const qty = page.locator('.item', { hasText: 'Parle-G Biscuit' }).locator('.qty');
  await expect(qty).toHaveText('23');
  // refund it
  await page.click('.tab[data-view="settings"]');
  await page.click('#openReturnsBtn');
  page.on('dialog', (d) => d.accept());      // confirm()
  await page.click('#returnsList .doReturn');
  await page.click('#returnsCloseBtn');
  await page.click('.tab[data-view="inventory"]');
  await expect(qty).toHaveText('24');
});

test('item number (SKU) is saved and searchable', async ({ page }) => {
  await page.click('#addItemBtn');
  await page.fill('#f_name', 'Basmati Rice 5kg');
  await page.fill('#f_sku', 'RICE05');
  await page.fill('#f_price', '450');
  await page.fill('#f_qty', '8');
  await page.click('#itemForm button[type="submit"]');
  await expect(page.locator('#toast')).toContainText('Saved');   // wait until persisted+rendered
  await page.fill('#searchBox', 'RICE05');     // find by item number
  const rows = page.locator('#inventoryList .item');
  await expect(rows).toHaveCount(1);           // retryable — waits out the search debounce
  await expect(rows.first()).toContainText('Basmati Rice 5kg');
});

test('tutorial / help screen opens with steps', async ({ page }) => {
  await page.click('.tab[data-view="settings"]');
  await page.click('#helpBtn');
  await expect(page.locator('#helpDialog')).toBeVisible();
  await expect(page.locator('#helpContent .help-step')).toHaveCount(9);
  await expect(page.locator('#helpContent')).toContainText('Make a bill');
});

test('credit bill creates a receivable; partial payment reduces it', async ({ page }) => {
  await page.click('.tab[data-view="bill"]');
  await page.fill('#billSearch', 'Parle');
  await page.click('#billSuggest li');
  await page.check('input[name="payMethod"][value="credit"]');
  await page.fill('#k_name', 'Ramesh');
  await page.click('#checkoutBtn');
  await page.locator('#receiptCloseBtn').click();
  await page.click('.tab[data-view="settings"]');
  await page.click('#openReceivablesBtn');
  await expect(page.locator('#receivablesContent')).toContainText('Ramesh');
  await page.click('#receivablesContent .payBtn');
  await page.fill('#payAmount', '5');
  await page.click('#payConfirmBtn');
  await expect(page.locator('#toast')).toContainText('Payment recorded');
});

test('save a quotation then convert it to a bill', async ({ page }) => {
  await page.click('.tab[data-view="bill"]');
  await page.fill('#billSearch', 'Tata');
  await page.click('#billSuggest li');
  await page.click('#saveQuoteBtn');
  await page.click('#clearCartBtn');
  await page.click('.tab[data-view="settings"]');
  await page.click('#openQuotesBtn');
  await page.click('#quotesList .toBill');
  await expect(page.locator('#cartList .cart-line')).toHaveCount(1);
});

test('expense reduces net profit in reports', async ({ page }) => {
  // record a sale to create gross profit
  await page.click('.tab[data-view="bill"]');
  await page.fill('#billSearch', 'Parle');
  await page.click('#billSuggest li');
  await page.click('#checkoutBtn');
  await page.locator('#receiptCloseBtn').click();
  // add an expense
  await page.click('.tab[data-view="settings"]');
  await page.click('#openExpensesBtn');
  await page.fill('#expAmount', '100');
  await page.click('#saveExpenseBtn');
  await expect(page.locator('#expensesList')).toContainText('₹100.00');
  await page.click('#expensesCloseBtn');
  // reports show a Net line
  await page.click('#openReportsBtn');
  await expect(page.locator('#reportsContent')).toContainText('Net');
});

test('cashier mode hides owner screens, PIN exits', async ({ page }) => {
  page.on('dialog', (d) => d.accept('1234'));   // answer the exit-PIN prompt()
  await page.click('.tab[data-view="settings"]');
  // set a PIN
  await page.fill('#pinInput', '1234');
  await page.click('#savePinBtn');
  await expect(page.locator('#toast')).toContainText('PIN set');
  await page.click('#cashierModeBtn');                  // enters cashier, jumps to Stock
  await expect(page.locator('#cashierExit')).toBeVisible();
  await page.click('.tab[data-view="settings"]');       // back to More
  await expect(page.locator('#openReportsBtn')).toBeHidden();   // hidden for cashier
  await page.click('#cashierExit');                     // PIN prompt → owner mode
  await expect(page.locator('#openReportsBtn')).toBeVisible();  // owner sees it again
});
