# Deploy on Cloudflare Pages (free, commercial-allowed)

Cloudflare Pages' free tier **allows commercial use** (unlike Vercel's free Hobby tier), so it's
the best $0 home once you start charging. The app's serverless endpoints are provided as
**Cloudflare Pages Functions** in `/functions` (Vercel's `/api` is ignored by Cloudflare, and
vice-versa — both can live in the repo).

## Step 1 — Push the repo to GitHub
(See the GitHub steps you already have. Cloudflare connects to your GitHub repo.)

## Step 2 — Create the Pages project
1. Go to **dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git**.
2. Pick your `lookinventory` repo.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. Click **Save and Deploy**. You get a URL like `https://lookinventory.pages.dev`.

The app is now live and free. `/functions/api/*` become `https://…/api/license` and `/api/admin`.

## Step 3 — (Only when you turn ON paid licensing)
Run `node tools/setup-license.js` and follow its output, then:

1. **Create a free Upstash Redis DB** (upstash.com) → copy its **REST URL** and **REST token**.
2. **Cloudflare → your Pages project → Settings → Environment variables**, add (Production):
   - `UPSTASH_REDIS_REST_URL` = your Upstash REST URL
   - `UPSTASH_REDIS_REST_TOKEN` = your Upstash REST token
   - `LICENSE_PRIVATE_JWK` = the private key JSON from the setup script
   - `ADMIN_KEY` = the admin secret from the setup script
   - `LEASE_HOURS` = `168`
3. In `js/config.js` set `licenseServerUrl: '/api/license'`, paste the public key into
   `licensePublicKey`, set `subscribeUrl`, `leaseHours: 168`, `trialDays`. Commit & let it redeploy.
4. Open `admin/index.html` locally → API base URL = your Pages URL, admin key = `ADMIN_KEY` →
   add paying devices by their **Device ID** (shopkeeper: More → About).

## Notes
- Same Upstash DB + same code works on **Vercel** too (it reads `KV_REST_API_URL`/`KV_REST_API_TOKEN`
  *or* `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`). Pick one host.
- Custom domain: Cloudflare Pages → Custom domains (free).
- The app stays fully usable offline regardless of host.
