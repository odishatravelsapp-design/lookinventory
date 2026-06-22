// Cloudflare Pages Function: admin API (protected by ADMIN_KEY env var)
import { json, CORS, getStore, putStore } from '../_lib.js';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.ADMIN_KEY || request.headers.get('x-admin-key') !== env.ADMIN_KEY) {
    return json({ error: 'unauthorized' }, 401, CORS);
  }
  const store = await getStore(env);
  if (request.method === 'GET') return json({ devices: store }, 200, CORS);

  const body = await request.json().catch(() => ({}));
  const { action, deviceId } = body;
  if (!deviceId) return json({ error: 'deviceId required' }, 400, CORS);

  if (action === 'setPlan') {
    store[deviceId] = { tier: body.tier || 'pro', expiresAt: body.expiresAt || null, shop: body.shop || '', message: body.message || '', revoked: false };
  } else if (action === 'revoke') {
    store[deviceId] = Object.assign({ tier: 'pro' }, store[deviceId], { revoked: true });
  } else if (action === 'unrevoke') {
    if (store[deviceId]) store[deviceId].revoked = false;
  } else if (action === 'delete') {
    delete store[deviceId];
  } else {
    return json({ error: 'unknown action' }, 400, CORS);
  }
  await putStore(env, store);
  return json({ ok: true, devices: store }, 200, CORS);
}
