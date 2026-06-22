# Deploy & Go-Live Checklist

## A. For the shopkeeper (end user) — basically 1 step

1. **Open the link** you send them (e.g. `https://your-app.vercel.app`) in Chrome.
   - The app works **immediately** — offline-first, no app-store download.
2. *(Optional)* Tap **"Add to Home screen"** → gets an app icon, opens like a normal app.
3. The **first-run wizard** asks: language → shop name → (optional) UPI → (optional) **Sign in with Google** for backup.
   - **Sign-in is optional.** It's only for cloud backup / moving to a new phone. They can skip it and start billing right away.

➡️ **Minimum for a shopkeeper = open link + start using.** Google sign-in is one extra optional tap, only if they want cloud backup.

---

## B. For you (admin) — go live FREE (3 steps, ~10 min)

1. **Deploy to Vercel.** Import this repo at vercel.com → Framework preset **Other** → Deploy.
   - `vercel.json` already runs `npm run build` and serves the hardened `dist/`. You get an HTTPS URL.
2. *(Recommended)* Enable one-tap Google backup:
   - Create a Google OAuth Client ID (README → "Developer: Google sign-in setup").
   - Paste it into `js/config.js → googleClientId`, and add your Vercel URL to Google's **Authorized JavaScript origins**. Redeploy.
3. **Share the URL** with shopkeepers. Done.

> Leave **licensing OFF** for now (it is by default). Get shops using it first — charging too early kills free growth.

---

## C. Later — turn ON paid licensing (when you have active shops)

1. **Generate signing keys:** `node tools/make-keys.js`
   - Saves the private key to `server/keys/private.jwk.json` (never commit — it's gitignored).
   - Prints the **public** JWK → paste into `js/config.js → licensePublicKey`.
2. **Set config** in `js/config.js`:
   - `licenseServerUrl: '/api/license'`
   - `subscribeUrl:` your Razorpay/UPI payment link
   - `leaseHours: 168`  ← **recommend 7 days, not 48**, so spotty rural internet doesn't lock shops out
   - `trialDays: 14` (or your choice)
3. **Add a free KV database** (production store is already wired — just connect one):
   - **Easiest:** Vercel dashboard → Storage → create **KV** (Upstash) → it auto-injects `KV_REST_API_URL` + `KV_REST_API_TOKEN`. Nothing else to do.
   - **Or** create a free **Upstash Redis** DB and set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`.
   - With neither set, it falls back to a local file (dev only — not durable on serverless).
4. **Set the other Vercel env vars** (Project → Settings → Environment Variables):
   - `LICENSE_PRIVATE_JWK` = contents of `server/keys/private.jwk.json`
   - `ADMIN_KEY` = a long secret (for the admin dashboard)
   - `LEASE_HOURS` = 168
5. **Redeploy.** Open `admin/index.html` locally → set API base URL + admin key → add a paying shopkeeper's **Device ID** (they read it from More → About) with a plan + expiry. They unlock on next online check.

---

## D. Publish to Play Store (optional, for reach & trust)

1. Go to **pwabuilder.com**, paste your deployed URL, generate a signed **Android package (AAB)**.
2. Pay the one-time **$25** Google Play developer fee, upload the AAB.
3. This is for **distribution/credibility**, not code protection — the APK still contains the same web code. Protection comes from the obfuscated build + server-bound paid features, which you already have.

---

## Honest reminders
- **48h lease** is aggressive for rural internet — use **168h (7 days)** in production.
- **No client app is uncrackable.** Obfuscation deters copying; real enforcement = the license server + features that only work with your server (sync/backup/multi-device).
- The app stays **fully usable offline** through all of the above.
