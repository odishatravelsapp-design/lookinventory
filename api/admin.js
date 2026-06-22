// Admin API for licensing. Protected by the ADMIN_KEY env var (sent as x-admin-key).
//   GET                      -> { devices }
//   POST { action, deviceId, tier, expiresAt, shop, message }
//        action: setPlan | revoke | unrevoke | delete
const { readStore, writeStore } = require('../server/lib/license');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!process.env.ADMIN_KEY || req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const store = readStore();
  if (req.method === 'GET') return res.json({ devices: store });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { action, deviceId } = body;
  if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

  if (action === 'setPlan') {
    store[deviceId] = {
      tier: body.tier || 'pro', expiresAt: body.expiresAt || null,
      shop: body.shop || '', message: body.message || '', revoked: false
    };
  } else if (action === 'revoke') {
    store[deviceId] = Object.assign({ tier: 'pro' }, store[deviceId], { revoked: true });
  } else if (action === 'unrevoke') {
    if (store[deviceId]) store[deviceId].revoked = false;
  } else if (action === 'delete') {
    delete store[deviceId];
  } else {
    return res.status(400).json({ error: 'unknown action' });
  }
  writeStore(store);
  res.json({ ok: true, devices: store });
};
