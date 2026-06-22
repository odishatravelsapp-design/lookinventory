// Generates maskable PNG app icons by rendering an SVG with headless Chromium.
// Run: node tools/make-icons.js   (requires @playwright/test, already a devDependency)
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Full-bleed maskable icon: green background + white cart, content within safe zone.
const svg = (s) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#22c55e"/><stop offset="1" stop-color="#15803d"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <g fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round" stroke-linejoin="round">
    <path d="M150 168h44l40 150h150l34-104H214"/>
  </g>
  <circle cx="246" cy="356" r="26" fill="#fff"/>
  <circle cx="372" cy="356" r="26" fill="#fff"/>
  <rect x="300" y="120" width="70" height="70" rx="12" fill="#fff" opacity="0.95"/>
  <path d="M335 138v34M318 155h34" stroke="#15803d" stroke-width="12" stroke-linecap="round"/>
</svg>`;

(async () => {
  const browser = await chromium.launch();
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><head><style>*{margin:0;padding:0}html,body{width:${size}px;height:${size}px;overflow:hidden}</style></head><body>${svg(size)}</body></html>`);
    await page.locator('svg').screenshot({ path: path.join(__dirname, '..', 'icons', `icon-${size}.png`) });
    console.log('wrote icons/icon-' + size + '.png');
  }
  await browser.close();
})();
