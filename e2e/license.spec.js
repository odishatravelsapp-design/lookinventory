const { test, expect } = require('@playwright/test');

// A throwaway public JWK (no token is verified in these states, so it just needs to be present).
const PUBKEY = { kty: 'EC', crv: 'P-256', x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU', y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0' };

async function boot(page, override) {
  await page.addInitScript((ov) => {
    indexedDB.deleteDatabase('look-inventory');
    window.__CONFIG_OVERRIDE = ov;
  }, override);
  await page.goto('/');
  await page.waitForTimeout(600);
}

test('licensing OFF by default — no paywall', async ({ page }) => {
  await boot(page, {});
  await expect(page.locator('#licenseScreen')).toBeHidden();
});

test('trial active shows a trial banner and the app works', async ({ page }) => {
  await boot(page, { licenseServerUrl: 'https://x.invalid/api/license', licensePublicKey: PUBKEY, trialDays: 14 });
  if (await page.locator('#obSkip').isVisible().catch(() => false)) await page.click('#obSkip');
  await expect(page.locator('#trialBanner')).toBeVisible();
  await expect(page.locator('#view-inventory')).toBeVisible();
});

test('expired trial shows the paywall (Subscribe)', async ({ page }) => {
  await boot(page, { licenseServerUrl: 'https://x.invalid/api/license', licensePublicKey: PUBKEY, trialDays: 0, subscribeUrl: 'https://pay.example/x' });
  await expect(page.locator('#licenseScreen')).toBeVisible();
  await expect(page.locator('#subscribeBtn')).toBeVisible();
});
