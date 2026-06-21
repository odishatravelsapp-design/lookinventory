// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// E2E config. Starts a static server, runs tests in a mobile Chrome profile
// (the app's real target). Run: npm run test:install  then  npm test
module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'on-first-retry',
    // grant camera/mic so scanner/voice code paths don't block (they fall back gracefully)
    permissions: [],
  },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npx http-server -p 8080 -c-1 .',
    url: 'http://localhost:8080',
    reuseExistingServer: true,
    timeout: 20000,
  },
});
