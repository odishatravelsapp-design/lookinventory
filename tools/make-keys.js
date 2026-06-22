// Generate an ECDSA P-256 key pair for license signing.
//   node tools/make-keys.js
// - Writes the PRIVATE key to server/keys/private.jwk.json (keep secret, server-only).
// - Prints the PUBLIC key JWK to paste into js/config.js -> licensePublicKey.
const { webcrypto } = require('crypto');
const fs = require('fs');
const path = require('path');

(async () => {
  const kp = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const priv = await webcrypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = await webcrypto.subtle.exportKey('jwk', kp.publicKey);

  const dir = path.join(__dirname, '..', 'server', 'keys');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'private.jwk.json'), JSON.stringify(priv, null, 2));
  console.log('Private key  -> server/keys/private.jwk.json  (KEEP SECRET)\n');
  console.log('Public key — paste into js/config.js  licensePublicKey:\n');
  console.log(JSON.stringify(pub));
})();
