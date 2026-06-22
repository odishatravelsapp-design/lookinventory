// One-shot licensing setup. Run once when you're ready to charge:
//   node tools/setup-license.js
// It generates the signing key + a strong admin key, saves the private key
// locally (gitignored), and prints EVERYTHING you need to copy-paste:
//   1) the public key for js/config.js
//   2) the env vars to add in Vercel (Project → Settings → Environment Variables)
const { webcrypto, randomBytes } = require('crypto');
const fs = require('fs');
const path = require('path');

(async () => {
  const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const priv = await webcrypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = await webcrypto.subtle.exportKey('jwk', kp.publicKey);

  const dir = path.join(__dirname, '..', 'server', 'keys');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'private.jwk.json'), JSON.stringify(priv, null, 2));

  const adminKey = randomBytes(24).toString('base64url');
  const line = '─'.repeat(64);

  console.log('\n' + line);
  console.log('✅ Saved private key → server/keys/private.jwk.json  (gitignored — never commit)');
  console.log(line);
  console.log('\n1) PASTE INTO  js/config.js  →  licensePublicKey:\n');
  console.log('   licensePublicKey: ' + JSON.stringify(pub) + ',');
  console.log('\n   Also set in js/config.js:');
  console.log("   licenseServerUrl: '/api/license',");
  console.log("   subscribeUrl: 'https://your-payment-link',   // Razorpay/UPI");
  console.log('   leaseHours: 168,   // 7 days offline — gentler than 48 for rural internet');
  console.log('   trialDays: 14,');
  console.log('\n' + line);
  console.log('2) ADD THESE ENV VARS in Vercel (Project → Settings → Environment Variables):\n');
  console.log('   LICENSE_PRIVATE_JWK = ' + JSON.stringify(priv));
  console.log('\n   ADMIN_KEY = ' + adminKey);
  console.log('\n   LEASE_HOURS = 168');
  console.log('\n   (Also add a Vercel KV store: Storage → KV → Create. It auto-adds');
  console.log('    KV_REST_API_URL + KV_REST_API_TOKEN — no manual step.)');
  console.log('\n' + line);
  console.log('3) Redeploy. Open admin/index.html, enter your URL + the ADMIN_KEY above,');
  console.log('   and add paying devices by their Device ID (shopkeeper: More → About).');
  console.log(line + '\n');
})();
