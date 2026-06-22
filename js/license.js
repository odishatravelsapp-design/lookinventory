// Client licensing: trial → paid. Verifies a server-signed token (ECDSA P-256) with
// an embedded public key, honours a 48h OFFLINE lease, and renews online.
// Inert unless CONFIG.licenseServerUrl + CONFIG.licensePublicKey are set (app ships free).
const License = (() => {
  const enc = (s) => new TextEncoder().encode(s);
  function b64urlToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    const bin = atob(s); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  function configured() {
    return !!(typeof CONFIG !== 'undefined' && CONFIG.licenseServerUrl && CONFIG.licensePublicKey);
  }

  // Verify a token "payloadB64.sigB64"; returns payload object or null if invalid/forged.
  async function verify(token) {
    try {
      const [p, s] = String(token).split('.');
      if (!p || !s) return null;
      const key = await crypto.subtle.importKey('jwk', CONFIG.licensePublicKey,
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64urlToBytes(s), enc(p));
      if (!ok) return null;
      return JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
    } catch (e) { return null; }
  }

  // Ask the server for a fresh token for this device.
  async function renew(deviceId, shop) {
    const res = await fetch(CONFIG.licenseServerUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, shop })
    });
    if (!res.ok) throw new Error('license http ' + res.status);
    const data = await res.json();
    if (!data || !data.token) throw new Error('no token');
    return data.token;
  }

  // Decide the current state given stored token + trial start. Pure (no DOM).
  // returns { state, daysLeft?, payload?, msg? }
  //   states: 'off' | 'active' | 'trial' | 'expired' | 'lease_expired'
  async function evaluate({ token, trialStart, now, online }) {
    if (!configured()) return { state: 'off' };
    const trialMs = (CONFIG.trialDays || 0) * 86400000;
    const leaseMs = (CONFIG.leaseHours || 48) * 3600000;

    if (token) {
      const p = await verify(token);
      if (p) {
        const subActive = !p.exp || now < p.exp;       // subscription not ended
        const leaseOk = p.iat && (now < (p.iat + leaseMs)) && (!p.lease || now < p.lease);
        if (subActive && leaseOk) return { state: 'active', payload: p };
        if (subActive && !leaseOk) return { state: 'lease_expired', payload: p }; // must reconnect
        return { state: 'expired', payload: p, msg: p.msg };                      // subscription over
      }
      // invalid/forged token → ignore, fall through to trial
    }
    // No valid token → trial window
    if (trialStart && (now - trialStart) < trialMs) {
      return { state: 'trial', daysLeft: Math.ceil((trialMs - (now - trialStart)) / 86400000) };
    }
    return { state: 'expired' };
  }

  return { configured, verify, renew, evaluate };
})();
