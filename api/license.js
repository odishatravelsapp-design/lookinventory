// POST /api/license  { deviceId, shop }  ->  { token }
// Issues a signed token (48h offline lease) for a device that has an active plan.
const { issueToken, loadPrivateKey } = require('../server/lib/license');
const { getStore } = require('../server/lib/store');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { deviceId, shop } = body;
  if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

  const rec = (await getStore())[deviceId];
  const now = Date.now();
  if (!rec || rec.revoked || (rec.expiresAt && now > rec.expiresAt)) {
    return res.status(402).json({ error: 'no active license' });   // client stays in trial/paywall
  }
  const leaseHours = Number(process.env.LEASE_HOURS) || 48;
  const token = await issueToken(loadPrivateKey(), { deviceId, shop, plan: rec }, leaseHours);
  res.json({ token });
};
