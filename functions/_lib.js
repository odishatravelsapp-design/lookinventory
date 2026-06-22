// Shared helpers for Cloudflare Pages Functions (Workers runtime, ES modules).
// Uses global Web Crypto + Upstash Redis REST (env vars). No Node APIs.
const enc = (s) => new TextEncoder().encode(s);
function b64url(bytes) {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-admin-key' };
export function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...extra } });
}

export async function sign(payload, privJwk) {
  const key = await crypto.subtle.importKey('jwk', privJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const p = b64url(enc(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc(p));
  return p + '.' + b64url(new Uint8Array(sig));
}

export async function issueToken(env, { deviceId, shop, plan }) {
  const now = Date.now();
  const leaseH = Number(env.LEASE_HOURS) || 48;
  const payload = {
    v: 1, device: deviceId, shop: shop || '', plan: plan.tier || 'pro',
    iat: now, lease: now + leaseH * 3600000, exp: plan.expiresAt || null, msg: plan.message || ''
  };
  return sign(payload, JSON.parse(env.LICENSE_PRIVATE_JWK));
}

async function kv(env, cmd) {
  const r = await fetch(env.UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.UPSTASH_REDIS_REST_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error('kv ' + r.status);
  return (await r.json()).result;
}
export async function getStore(env) { const v = await kv(env, ['GET', 'lookinv:licenses']); return v ? JSON.parse(v) : {}; }
export async function putStore(env, s) { await kv(env, ['SET', 'lookinv:licenses', JSON.stringify(s)]); }
