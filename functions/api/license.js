// Cloudflare Pages Function: POST /api/license { deviceId, shop } -> { token }
import { json, CORS, issueToken, getStore } from '../_lib.js';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405, CORS);

  const body = await request.json().catch(() => ({}));
  const { deviceId, shop } = body;
  if (!deviceId) return json({ error: 'deviceId required' }, 400, CORS);

  const rec = (await getStore(env))[deviceId];
  const now = Date.now();
  if (!rec || rec.revoked || (rec.expiresAt && now > rec.expiresAt)) {
    return json({ error: 'no active license' }, 402, CORS);
  }
  const token = await issueToken(env, { deviceId, shop, plan: rec });
  return json({ token }, 200, CORS);
}
