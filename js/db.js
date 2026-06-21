// IndexedDB data layer. All data lives on the phone, so the app works fully offline.
const DB = (() => {
  const DB_NAME = 'look-inventory';
  const DB_VERSION = 5;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('items')) {
          const store = db.createObjectStore('items', { keyPath: 'id' });
          store.createIndex('barcode', 'barcode', { unique: false });
          store.createIndex('name', 'name', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('sales')) {
          const s = db.createObjectStore('sales', { keyPath: 'id' });
          s.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('khata')) {
          const k = db.createObjectStore('khata', { keyPath: 'id' });
          k.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('purchases')) {
          const p = db.createObjectStore('purchases', { keyPath: 'id' });
          p.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('expenses')) {
          const ex = db.createObjectStore('expenses', { keyPath: 'id' });
          ex.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('quotes')) {
          const q = db.createObjectStore('quotes', { keyPath: 'id' });
          q.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function tx(store, mode) {
    return open().then((db) => db.transaction(store, mode).objectStore(store));
  }

  function reqToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function uid() {
    return 'i_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ---- Items ----
  async function allItems() {
    const store = await tx('items', 'readonly');
    const items = await reqToPromise(store.getAll());
    return items.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function getItem(id) {
    const store = await tx('items', 'readonly');
    return reqToPromise(store.get(id));
  }

  async function findByBarcode(barcode) {
    if (!barcode) return null;
    const store = await tx('items', 'readonly');
    const idx = store.index('barcode');
    const res = await reqToPromise(idx.getAll(String(barcode)));
    return res && res.length ? res[0] : null;
  }

  async function saveItem(item) {
    const now = Date.now();
    if (!item.id) {
      item.id = uid();
      item.createdAt = now;
    }
    item.updatedAt = now;
    item.barcode = item.barcode ? String(item.barcode) : '';
    item.quantity = Number(item.quantity) || 0;
    item.price = Number(item.price) || 0;
    item.cost = Number(item.cost) || 0;
    item.reorder = Number(item.reorder) || 0;
    const store = await tx('items', 'readwrite');
    await reqToPromise(store.put(item));
    return item;
  }

  async function deleteItem(id) {
    const store = await tx('items', 'readwrite');
    return reqToPromise(store.delete(id));
  }

  async function bulkReplace(items) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('items', 'readwrite');
      const store = t.objectStore('items');
      store.clear();
      (items || []).forEach((it) => store.put(it));
      t.oncomplete = () => resolve(true);
      t.onerror = () => reject(t.error);
    });
  }

  // Merge by barcode (preferred) or id, keeping the most recently updated record.
  async function mergeItems(incoming) {
    const current = await allItems();
    const byKey = new Map();
    const keyOf = (it) => (it.barcode ? 'bc:' + it.barcode : 'id:' + it.id);
    current.forEach((it) => byKey.set(keyOf(it), it));
    (incoming || []).forEach((it) => {
      const k = keyOf(it);
      const existing = byKey.get(k);
      if (!existing || (it.updatedAt || 0) > (existing.updatedAt || 0)) {
        byKey.set(k, it);
      }
    });
    await bulkReplace(Array.from(byKey.values()));
  }

  // ---- Meta (settings) ----
  async function getMeta(key, fallback) {
    const store = await tx('meta', 'readonly');
    const row = await reqToPromise(store.get(key));
    return row ? row.value : fallback;
  }

  async function setMeta(key, value) {
    const store = await tx('meta', 'readwrite');
    return reqToPromise(store.put({ key, value }));
  }

  // ---- Sales (bills) ----
  async function saveSale(sale) {
    if (!sale.id) sale.id = 'b_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    if (!sale.createdAt) sale.createdAt = Date.now();
    const store = await tx('sales', 'readwrite');
    await reqToPromise(store.put(sale));
    return sale;
  }

  async function allSales() {
    const store = await tx('sales', 'readonly');
    const sales = await reqToPromise(store.getAll());
    return sales.sort((a, b) => b.createdAt - a.createdAt);
  }

  async function nextInvoiceNo() {
    const n = (await getMeta('invoiceCounter', 0)) + 1;
    await setMeta('invoiceCounter', n);
    return n;
  }

  async function mergeSales(incoming) {
    const store = await tx('sales', 'readwrite');
    for (const s of (incoming || [])) await reqToPromise(store.put(s));
  }

  // ---- Khata (credit ledger) ----
  async function saveKhata(entry) {
    if (!entry.id) entry.id = 'k_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    if (!entry.createdAt) entry.createdAt = Date.now();
    const store = await tx('khata', 'readwrite');
    await reqToPromise(store.put(entry));
    return entry;
  }

  async function allKhata() {
    const store = await tx('khata', 'readonly');
    const rows = await reqToPromise(store.getAll());
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }

  async function deleteKhata(id) {
    const store = await tx('khata', 'readwrite');
    return reqToPromise(store.delete(id));
  }

  async function mergeKhata(incoming) {
    const store = await tx('khata', 'readwrite');
    for (const k of (incoming || [])) await reqToPromise(store.put(k));
  }

  // ---- Purchases (stock-in from suppliers) ----
  async function savePurchase(p) {
    if (!p.id) p.id = 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    if (!p.createdAt) p.createdAt = Date.now();
    const store = await tx('purchases', 'readwrite');
    await reqToPromise(store.put(p));
    return p;
  }

  async function allPurchases() {
    const store = await tx('purchases', 'readonly');
    const rows = await reqToPromise(store.getAll());
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }

  async function mergePurchases(incoming) {
    const store = await tx('purchases', 'readwrite');
    for (const p of (incoming || [])) await reqToPromise(store.put(p));
  }

  // ---- Generic helpers for simple list stores (expenses, quotes) ----
  function makeStore(name, prefix) {
    return {
      async save(row) {
        if (!row.id) row.id = prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        if (!row.createdAt) row.createdAt = Date.now();
        const s = await tx(name, 'readwrite'); await reqToPromise(s.put(row)); return row;
      },
      async all() {
        const s = await tx(name, 'readonly');
        return (await reqToPromise(s.getAll())).sort((a, b) => b.createdAt - a.createdAt);
      },
      async remove(id) { const s = await tx(name, 'readwrite'); return reqToPromise(s.delete(id)); },
      async merge(rows) { const s = await tx(name, 'readwrite'); for (const r of (rows || [])) await reqToPromise(s.put(r)); }
    };
  }
  const expensesStore = makeStore('expenses', 'e_');
  const quotesStore = makeStore('quotes', 'q_');

  return {
    allItems, getItem, findByBarcode, saveItem, deleteItem,
    bulkReplace, mergeItems, getMeta, setMeta, uid,
    saveSale, allSales, nextInvoiceNo, mergeSales,
    saveKhata, allKhata, deleteKhata, mergeKhata,
    savePurchase, allPurchases, mergePurchases,
    saveExpense: expensesStore.save, allExpenses: expensesStore.all, mergeExpenses: expensesStore.merge,
    saveQuote: quotesStore.save, allQuotes: quotesStore.all, deleteQuote: quotesStore.remove, mergeQuotes: quotesStore.merge
  };
})();
