// Optional real-time multi-device sync via Firebase Firestore (free Spark tier).
// Design: the whole app payload is stored as ONE document at shops/<shopCode>.
// Firestore handles the offline queue + auto-sync; we just push on local change
// and merge on remote change. The core app works fully offline without this.
//
// Loaded from the gstatic CDN (needs internet the first time). If not configured,
// nothing happens and the app behaves exactly as before.
const Cloud = (() => {
  let db = null, docRef = null, unsub = null, ready = false;
  let onRemote = null;     // callback(payload) when remote data arrives
  let applyingRemote = false;
  let lastPushedAt = 0;    // ignore our own writes echoing back

  async function connect(configJson, shopCode, remoteHandler) {
    const cfg = typeof configJson === 'string' ? JSON.parse(configJson) : configJson;
    if (!cfg || !cfg.projectId) throw new Error('Invalid Firebase config.');
    if (!shopCode) throw new Error('Enter a shop code.');
    onRemote = remoteHandler;

    const appMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    const fs = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const app = appMod.initializeApp(cfg);
    // Offline cache so it keeps working without internet within a session.
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentSingleTabManager() })
    });
    docRef = fs.doc(db, 'shops', shopCode);
    _setDoc = (data) => fs.setDoc(docRef, data, { merge: true });
    _onSnapshot = fs.onSnapshot;

    // Live listener: when another device writes, merge it locally.
    unsub = fs.onSnapshot(docRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (!data || !data.payload || !onRemote) return;
      if (data.updatedAt && data.updatedAt === lastPushedAt) return;   // our own write echoing back
      applyingRemote = true;
      Promise.resolve(onRemote(JSON.parse(data.payload))).finally(() => { applyingRemote = false; });
    });
    ready = true;
    return true;
  }

  let _setDoc = null, _onSnapshot = null;

  async function push(payload) {
    if (!ready || !_setDoc || applyingRemote) return;   // don't echo remote-applied changes
    let json = JSON.stringify(payload);
    // Firestore caps a document at ~1 MiB. If the payload grows past a safe margin
    // (long sales history), sync only recent sales so live sync keeps working.
    // (Full history still lives locally + in Google Drive backups.)
    if (json.length > 800000 && payload.sales) {
      const trimmed = { ...payload, sales: payload.sales.slice(0, 500), _trimmed: true };
      json = JSON.stringify(trimmed);
    }
    lastPushedAt = Date.now();
    await _setDoc({ payload: json, updatedAt: lastPushedAt });
  }

  function isReady() { return ready; }
  function disconnect() { if (unsub) unsub(); ready = false; }

  return { connect, push, isReady, disconnect };
})();
