// License store with a pluggable backend (no SDK, just REST):
//   • Vercel KV   — set KV_REST_API_URL + KV_REST_API_TOKEN  (auto-injected by Vercel KV)
//   • Upstash     — set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
//   • else        — local JSON file (dev only; NOT durable on serverless)
// The whole device→plan map is stored under one key (small, admin-written infrequently).
const fs = require('fs');
const path = require('path');

const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const KEY = 'lookinv:licenses';
const FILE = path.join(__dirname, '..', 'data', 'licenses.json');

function usingKV() { return !!(URL && TOKEN); }

async function kv(cmd) {
  const r = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error('kv ' + r.status);
  return (await r.json()).result;
}

async function getStore() {
  if (usingKV()) {
    const v = await kv(['GET', KEY]);
    return v ? JSON.parse(v) : {};
  }
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return {}; }
}

async function putStore(store) {
  if (usingKV()) { await kv(['SET', KEY, JSON.stringify(store)]); return; }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2));
}

module.exports = { getStore, putStore, usingKV };
