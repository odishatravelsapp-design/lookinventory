// Signing + store helpers for the licensing server (Node). Used by api/license + api/admin.
const { webcrypto } = require('crypto');
const fs = require('fs');
const path = require('path');

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sign(payload, privJwk) {
  const key = await webcrypto.subtle.importKey('jwk', privJwk,
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' },
    key, new TextEncoder().encode(p));
  return p + '.' + b64url(new Uint8Array(sig));
}

// Issue a token for a device given its plan record. lease = offline validity window.
async function issueToken(privJwk, { deviceId, shop, plan }, leaseHours) {
  const now = Date.now();
  const payload = {
    v: 1, device: deviceId, shop: shop || '', plan: plan.tier || 'pro',
    iat: now,
    lease: now + (leaseHours || 48) * 3600000,
    exp: plan.expiresAt || null,            // subscription end (ms) or null = perpetual
    msg: plan.message || ''
  };
  return sign(payload, privJwk);
}

// --- Minimal file store (swap for Firestore / KV / Postgres in production) ---
const DATA = path.join(__dirname, '..', 'data', 'licenses.json');
function readStore() {
  try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) { return {}; }
}
function writeStore(s) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify(s, null, 2));
}
function loadPrivateKey() {
  // Prefer an env var (set LICENSE_PRIVATE_JWK on Vercel) so the key is never committed.
  if (process.env.LICENSE_PRIVATE_JWK) return JSON.parse(process.env.LICENSE_PRIVATE_JWK);
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'keys', 'private.jwk.json'), 'utf8'));
}

module.exports = { sign, issueToken, readStore, writeStore, loadPrivateKey };
