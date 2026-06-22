// Main app: wiring, rendering, and all user actions.
(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const money = (n) => '₹' + (Number(n) || 0).toFixed(2);
  const t = (k) => I18N.t(k);

  let items = [];
  let pendingScanTarget = null; // 'form' when scanning into the item editor

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  // ---------- Navigation ----------
  let currentView = 'inventory';
  function showView(name) {
    currentView = name;
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
    if (name !== 'scan') Scanner.stop($('#scanVideo'));
    if (name === 'bill') renderBill();
    window.scrollTo(0, 0);
  }
  $$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
  $('#scanFab').addEventListener('click', () => showView('scan'));

  // ---------- Rendering ----------
  function isLow(it) { return it.reorder > 0 && it.quantity <= it.reorder; }

  const DAY = 86400000;
  function expiryState(it) {
    if (!it.expiry) return null;
    const days = Math.floor((new Date(it.expiry).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / DAY);
    if (days < 0) return { kind: 'expired', days };
    if (days <= 30) return { kind: 'soon', days };
    return null;
  }

  function itemRow(it) {
    const low = isLow(it);
    const exp = expiryState(it);
    const thumb = it.photo ? `<img class="thumb" src="${it.photo}" alt="" />` : '';
    return `
      <li class="item ${low ? 'low' : ''}" data-id="${it.id}">
        ${thumb}
        <div class="item-main">
          <div class="item-name">${escapeHtml(it.name)}${it.sku ? ` <span class="bc">${escapeHtml(it.sku)}</span>` : (it.barcode ? ` <span class="bc">#${escapeHtml(it.barcode)}</span>` : '')}</div>
          <div class="item-sub">${money(it.price)} · ${it.quantity} ${escapeHtml(it.unit || 'pcs')}${it.category ? ' · ' + escapeHtml(it.category) : ''}${exp ? ` · <span class="exp ${exp.kind}">${exp.kind === 'expired' ? '⛔ expired' : '⏳ ' + exp.days + 'd'}</span>` : ''}</div>
        </div>
        <div class="item-actions">
          ${low ? '<span class="pill warn">Low</span>' : ''}
          <button class="qbtn sell" data-id="${it.id}" title="Record a sale" aria-label="Sell one ${escapeHtml(it.name)}">−</button>
          <span class="qty" aria-label="In stock">${it.quantity}</span>
          <button class="qbtn add" data-id="${it.id}" title="Add stock" aria-label="Add one ${escapeHtml(it.name)}">+</button>
        </div>
      </li>`;
  }

  const PAGE = 50;            // render in chunks so huge lists stay fast
  let shownCount = PAGE;
  let filteredCache = [];

  function filterItems() {
    const q = $('#searchBox').value.trim().toLowerCase();
    if (!q) return items;
    // Match across name, barcode, and category; supports multi-word ("amul milk").
    const terms = q.split(/\s+/);
    return items.filter((it) => {
      const hay = (it.name + ' ' + (it.barcode || '') + ' ' + (it.sku || '') + ' ' + (it.category || '')).toLowerCase();
      return terms.every((tm) => hay.includes(tm));
    });
  }

  function renderInventory(resetPage) {
    if (resetPage !== false) shownCount = PAGE;
    filteredCache = filterItems();
    const slice = filteredCache.slice(0, shownCount);

    $('#inventoryList').innerHTML = slice.map(itemRow).join('');
    $('#loadMoreBtn').classList.toggle('hidden', filteredCache.length <= shownCount);
    $('#inventoryEmpty').classList.toggle('hidden', items.length > 0);

    const lowItems = items.filter(isLow);
    const banner = $('#lowStockBanner');
    if (lowItems.length) {
      banner.classList.remove('hidden');
      banner.innerHTML = `⚠️ ${lowItems.length} item(s) low on stock — check the <b data-goto="order">${t('tab_order')}</b> list.`;
    } else {
      banner.classList.add('hidden');
    }

    const expItems = items.filter((it) => expiryState(it));
    const eb = $('#expiryBanner');
    if (expItems.length) {
      const expired = expItems.filter((it) => expiryState(it).kind === 'expired').length;
      eb.classList.remove('hidden');
      eb.innerHTML = `⏳ ${expItems.length} item(s) expiring soon${expired ? `, ${expired} already expired` : ''}.`;
    } else {
      eb.classList.add('hidden');
    }
  }

  function renderOrder() {
    // Auto: every low-stock item, plus anything manually flagged.
    const toOrder = items
      .filter((it) => isLow(it) || it.toOrder)
      .sort((a, b) => Number(a.fulfilled) - Number(b.fulfilled));

    $('#orderList').innerHTML = toOrder.map((it) => {
      const suggested = suggestOrderQty(it);
      const vel = velocityMap[it.name] || 0;
      return `
        <li class="item ${it.fulfilled ? 'done' : ''}" data-id="${it.id}">
          <label class="check">
            <input type="checkbox" class="fulfill" data-id="${it.id}" ${it.fulfilled ? 'checked' : ''} />
          </label>
          <div class="item-main">
            <div class="item-name">${escapeHtml(it.name)}</div>
            <div class="item-sub">In stock: ${it.quantity} ${escapeHtml(it.unit || 'pcs')} · suggest ≈ ${suggested}${vel > 0 ? ` · sells ${(vel * 7).toFixed(1)}/wk` : ''}</div>
          </div>
          <div class="order-qty">
            <button class="qbtn ominus" data-id="${it.id}">−</button>
            <input class="oqty" data-id="${it.id}" type="number" min="0" value="${it.orderQty || suggested}" />
            <button class="qbtn oplus" data-id="${it.id}">+</button>
          </div>
        </li>`;
    }).join('');
    $('#orderEmpty').classList.toggle('hidden', toOrder.length > 0);
  }

  function renderAll() {
    renderInventory();
    renderOrder();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Sales velocity (units/day, 30d) and last-sold date per item name — for smart reorder & dead-stock.
  let velocityMap = {};
  let lastSoldMap = {};
  async function computeSalesStats() {
    const sales = await DB.allSales();
    const since = Date.now() - 30 * DAY;
    const qty = {}; velocityMap = {}; lastSoldMap = {};
    sales.forEach((s) => s.lines.forEach((l) => {
      if (s.createdAt >= since) qty[l.name] = (qty[l.name] || 0) + l.qty;
      if (!lastSoldMap[l.name] || s.createdAt > lastSoldMap[l.name]) lastSoldMap[l.name] = s.createdAt;
    }));
    Object.keys(qty).forEach((name) => { velocityMap[name] = qty[name] / 30; });
  }

  // Smart suggested order qty: cover ~14 days of sales, minus current stock.
  function suggestOrderQty(it) {
    const vel = velocityMap[it.name] || 0;
    if (vel > 0) return Math.max(Math.ceil(vel * 14 - it.quantity), 1);
    return Math.max((it.reorder || 0) * 2 - it.quantity, 1);
  }

  async function reload() {
    items = await DB.allItems();
    await computeSalesStats();
    renderAll();
  }

  // ---------- Inventory interactions ----------
  let searchTimer = null;
  $('#searchBox').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => renderInventory(true), 120);  // debounce for snappy typing
  });
  $('#loadMoreBtn').addEventListener('click', () => {
    shownCount += PAGE;
    renderInventory(false);
  });

  $('#lowStockBanner').addEventListener('click', (e) => {
    if (e.target.dataset.goto === 'order') showView('order');
  });

  $('#inventoryList').addEventListener('click', async (e) => {
    const id = e.target.dataset.id;
    if (!id) {
      const row = e.target.closest('.item');
      if (row) openDetail(row.dataset.id);
      return;
    }
    const it = items.find((x) => x.id === id);
    if (!it) return;
    if (e.target.classList.contains('sell')) {
      if (it.quantity <= 0) return toast('Out of stock');
      it.quantity -= 1;
      await DB.saveItem(it);
      await reload();
      toast('Sold 1 ' + it.name + (isLow(it) ? ' · now LOW' : ''));
    } else if (e.target.classList.contains('add')) {
      it.quantity += 1;
      await DB.saveItem(it);
      await reload();
    }
  });

  // ---------- To Order interactions ----------
  $('#orderList').addEventListener('click', async (e) => {
    const id = e.target.dataset.id;
    if (!id) return;
    const it = items.find((x) => x.id === id);
    if (!it) return;
    const qtyInput = $(`.oqty[data-id="${id}"]`);

    if (e.target.classList.contains('oplus')) {
      qtyInput.value = (Number(qtyInput.value) || 0) + 1;
      it.orderQty = Number(qtyInput.value); await DB.saveItem(it);
    } else if (e.target.classList.contains('ominus')) {
      qtyInput.value = Math.max((Number(qtyInput.value) || 0) - 1, 0);
      it.orderQty = Number(qtyInput.value); await DB.saveItem(it);
    } else if (e.target.classList.contains('fulfill')) {
      const checked = e.target.checked;
      if (checked) {
        // Fulfilled: add the ordered quantity into stock.
        const orderQty = Number(qtyInput.value) || 0;
        it.quantity += orderQty;
        it.fulfilled = true;
        it.toOrder = false;
        await DB.saveItem(it);
        await reload();
        toast('Received ' + orderQty + ' ' + (it.unit || 'pcs') + ' of ' + it.name);
      } else {
        it.fulfilled = false;
        await DB.saveItem(it);
        await reload();
      }
    }
  });

  $('#orderList').addEventListener('change', async (e) => {
    if (e.target.classList.contains('oqty')) {
      const it = items.find((x) => x.id === e.target.dataset.id);
      if (it) { it.orderQty = Number(e.target.value) || 0; await DB.saveItem(it); }
    }
  });

  $('#clearFulfilledBtn').addEventListener('click', async () => {
    const done = items.filter((it) => it.fulfilled);
    for (const it of done) { it.fulfilled = false; it.toOrder = false; await DB.saveItem(it); }
    await reload();
    toast('Cleared completed orders');
  });

  // ---------- Item details / quick sell ----------
  function openDetail(id) {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    const profit = (it.price - it.cost);
    const exp = expiryState(it);
    $('#detailContent').innerHTML = `
      <h3>${escapeHtml(it.name)}</h3>
      ${it.photo ? `<img class="detail-photo" src="${it.photo}" alt="" />` : ''}
      ${it.sku ? `<p class="muted">Item no: ${escapeHtml(it.sku)}</p>` : ''}
      ${it.barcode ? `<p class="muted">Barcode: ${escapeHtml(it.barcode)}</p>` : ''}
      ${it.description ? `<p>${escapeHtml(it.description)}</p>` : ''}
      <div class="detail-grid">
        <div><span>${t('sell_price')}</span><b>${money(it.price)}</b></div>
        <div><span>${t('cost_price')}</span><b>${money(it.cost)}</b></div>
        <div><span>Margin / unit</span><b>${money(profit)}</b></div>
        <div><span>In stock</span><b>${it.quantity} ${escapeHtml(it.unit || 'pcs')}</b></div>
        <div><span>${t('reorder_at')}</span><b>${it.reorder}</b></div>
        <div><span>${t('category')}</span><b>${escapeHtml(it.category || '—')}</b></div>
        ${it.expiry ? `<div><span>${t('expiry')}</span><b class="${exp ? 'exp ' + exp.kind : ''}">${escapeHtml(it.expiry)}</b></div>` : ''}
      </div>
      <div class="dialog-actions">
        <button class="btn ghost" data-act="close">${t('close')}</button>
        <span class="spacer"></span>
        <button class="btn" data-act="edit">Edit</button>
        <button class="btn primary" data-act="sell">Sell −1</button>
      </div>`;
    const dlg = $('#detailDialog');
    dlg.onclick = async (e) => {
      const act = e.target.dataset.act;
      if (act === 'close') dlg.close();
      else if (act === 'edit') { dlg.close(); openEditor(it); }
      else if (act === 'sell') {
        if (it.quantity <= 0) return toast('Out of stock');
        it.quantity -= 1; await DB.saveItem(it); await reload();
        toast('Sold 1 ' + it.name); dlg.close();
      }
    };
    dlg.showModal();
  }

  // ---------- Item editor ----------
  let formPhoto = '';  // dataURL for the item being edited

  function openEditor(it) {
    const isEdit = !!it;
    $('#itemDialogTitle').textContent = isEdit ? 'Edit item' : 'Add item';
    $('#f_id').value = it ? it.id : '';
    $('#f_name').value = it ? it.name : '';
    $('#f_sku').value = it ? (it.sku || '') : '';
    $('#f_barcode').value = it ? it.barcode : '';
    $('#f_desc').value = it ? it.description || '' : '';
    $('#f_price').value = it ? it.price : '';
    $('#f_cost').value = it ? it.cost : '';
    $('#f_qty').value = it ? it.quantity : 0;
    $('#f_unit').value = it ? (it.unit || 'pcs') : 'pcs';
    $('#f_category').value = it ? it.category || '' : '';
    $('#f_reorder').value = it ? it.reorder : 5;
    $('#f_expiry').value = it ? it.expiry || '' : '';
    $('#f_pack').value = it ? (it.pack || 1) : 1;
    $('#f_hsn').value = it ? (it.hsn || '') : '';
    $('#f_gst').value = it ? (it.gst != null ? it.gst : '') : '';
    $('#f_wprice').value = it ? (it.wprice || '') : '';
    $('#f_wmin').value = it ? (it.wmin || '') : '';
    $('#f_fav').checked = it ? !!it.fav : false;
    formPhoto = it ? it.photo || '' : '';
    const prev = $('#f_photoPreview');
    prev.src = formPhoto; prev.classList.toggle('hidden', !formPhoto);
    $('#f_photoInput').value = '';
    $('#deleteItemBtn').classList.toggle('hidden', !isEdit);
    $('#itemDialog').showModal();
  }

  $('#addItemBtn').addEventListener('click', () => openEditor(null));

  // Compress a picked photo to a small square dataURL (keeps backups light).
  function compressImage(file, max = 400) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(max / img.width, max / img.height, 1);
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.7));
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(file);
    });
  }

  $('#f_photoInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    formPhoto = await compressImage(file);
    const prev = $('#f_photoPreview');
    prev.src = formPhoto; prev.classList.remove('hidden');
  });

  // Voice input for the item name (needs internet on most browsers).
  $('#f_voiceBtn').addEventListener('click', () => listenInto($('#f_name')));

  function listenInto(targetInput) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return toast('Voice not supported on this browser');
    const rec = new SR();
    rec.lang = ({ hi: 'hi-IN', or: 'or-IN', bn: 'bn-IN', ta: 'ta-IN', te: 'te-IN', mr: 'mr-IN' }[I18N.lang]) || 'en-IN';
    rec.interimResults = false; rec.maxAlternatives = 1;
    toast('🎤 Listening…');
    rec.onresult = (ev) => { targetInput.value = ev.results[0][0].transcript; targetInput.dispatchEvent(new Event('input')); };
    rec.onerror = () => toast('Could not hear — check mic/internet');
    rec.start();
  }

  $('#itemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#f_name').value.trim();
    if (!name) return;
    const item = {
      id: $('#f_id').value || undefined,
      name,
      sku: $('#f_sku').value.trim(),
      barcode: $('#f_barcode').value.trim(),
      description: $('#f_desc').value.trim(),
      price: $('#f_price').value,
      cost: $('#f_cost').value,
      quantity: $('#f_qty').value,
      unit: $('#f_unit').value,
      category: $('#f_category').value.trim(),
      reorder: $('#f_reorder').value,
      expiry: $('#f_expiry').value || '',
      pack: Math.max(parseInt($('#f_pack').value, 10) || 1, 1),
      hsn: $('#f_hsn').value.trim(),
      gst: $('#f_gst').value === '' ? null : (Number($('#f_gst').value) || 0),
      wprice: Number($('#f_wprice').value) || 0,
      wmin: Number($('#f_wmin').value) || 0,
      fav: $('#f_fav').checked,
      photo: formPhoto || ''
    };
    if (item.id) {
      const existing = items.find((x) => x.id === item.id);
      Object.assign(existing, item);
      await DB.saveItem(existing);
    } else {
      await DB.saveItem(item);
    }
    $('#itemDialog').close();
    await reload();
    scheduleBackup();
    toast('Saved ' + name);
  });

  $('#cancelItemBtn').addEventListener('click', () => $('#itemDialog').close());

  $('#deleteItemBtn').addEventListener('click', async () => {
    const id = $('#f_id').value;
    if (!id) return;
    if (!confirm('Delete this item?')) return;
    await DB.deleteItem(id);
    $('#itemDialog').close();
    await reload();
    toast('Deleted');
  });

  // Scan into the editor's barcode field
  $('#f_scanBtn').addEventListener('click', () => {
    pendingScanTarget = 'form';
    showView('scan');
    startScan();
  });

  // Auto-generate an item number (SKU) — sequential, human-readable.
  $('#f_skuGenBtn').addEventListener('click', async () => {
    const n = (await DB.getMeta('skuCounter', 0)) + 1;
    await DB.setMeta('skuCounter', n);
    $('#f_sku').value = 'SKU-' + String(n).padStart(4, '0');
  });

  // Generate a scannable barcode value for loose/unpackaged items (printable label later).
  $('#f_genBtn').addEventListener('click', async () => {
    const n = (await DB.getMeta('bcCounter', 0)) + 1;
    await DB.setMeta('bcCounter', n);
    $('#f_barcode').value = 'LI' + String(200000 + n);   // unique, scannable Code128 value
    toast('Barcode generated — print a label from More → Labels');
  });

  // ---------- Scanner ----------
  function startScan() {
    $('#startScanBtn').classList.add('hidden');
    $('#stopScanBtn').classList.remove('hidden');
    $('#scanHint').textContent = 'Scanning… hold steady.';
    Scanner.start($('#scanVideo'), onScanResult, (msg) => {
      $('#scanHint').textContent = msg;
      $('#startScanBtn').classList.remove('hidden');
      $('#stopScanBtn').classList.add('hidden');
    });
  }
  function stopScan() {
    Scanner.stop($('#scanVideo'));
    $('#startScanBtn').classList.remove('hidden');
    $('#stopScanBtn').classList.add('hidden');
    $('#scanHint').textContent = 'Point the camera at a barcode.';
  }

  async function onScanResult(code) {
    stopScan();
    if (pendingScanTarget === 'form') {
      pendingScanTarget = null;
      $('#f_barcode').value = code;
      $('#itemDialog').showModal();
      return;
    }
    if (pendingScanTarget === 'bill') {
      pendingScanTarget = null;
      const it = await DB.findByBarcode(code);
      showView('bill');
      if (it) { addToCart(it); toast('Added ' + it.name); }
      else toast('No item with barcode ' + code);
      return;
    }
    const found = await DB.findByBarcode(code);
    if (found) {
      showView('inventory');
      openDetail(found.id);
    } else {
      // Unknown barcode -> offer to add a new item pre-filled.
      if (confirm('No item with barcode ' + code + '. Add it now?')) {
        showView('inventory');
        openEditor(null);
        $('#f_barcode').value = code;
      }
    }
  }

  $('#startScanBtn').addEventListener('click', startScan);
  $('#stopScanBtn').addEventListener('click', stopScan);
  $('#manualBarcodeBtn').addEventListener('click', () => {
    const code = prompt('Enter barcode number:');
    if (code) onScanResult(code.trim());
  });

  // ---------- Billing ----------
  let cart = [];          // { id, name, price, qty, unit }
  let taxRate = 0;        // %
  let lastReceiptHtml = '';
  let lastReceiptText = '';

  function billType() {
    const r = document.querySelector('input[name="billType"]:checked');
    return r ? r.value : 'consumer';
  }

  document.querySelectorAll('input[name="billType"]').forEach((r) =>
    r.addEventListener('change', () => {
      $('#partyFields').classList.toggle('hidden', billType() !== 'b2b');
    }));

  // Money is computed in integer paise to avoid floating-point rounding errors,
  // then converted back to rupees only for the result.
  const toPaise = (rupees) => Math.round((Number(rupees) || 0) * 100);
  const toRupees = (paise) => paise / 100;

  function cartTotals() {
    const subP = cart.reduce((s, l) => s + Math.round(toPaise(l.price) * (Number(l.qty) || 0)), 0);
    const discP = Math.min(toPaise($('#billDiscount').value), subP);
    const taxableP = subP - discP;
    const taxP = Math.round(taxableP * (taxRate / 100));
    const grossP = taxableP + taxP;
    // Round-off to the nearest rupee (standard on Indian invoices).
    const totalP = Math.round(grossP / 100) * 100;
    const roundOffP = totalP - grossP;
    return {
      subtotal: toRupees(subP), discount: toRupees(discP), tax: toRupees(taxP),
      roundOff: toRupees(roundOffP), total: toRupees(totalP)
    };
  }

  function renderCart() {
    $('#cartList').innerHTML = cart.map((l) => `
      <li class="item cart-line" data-id="${l.id}">
        <div class="item-main">
          <div class="item-name">${escapeHtml(l.name)}</div>
          <div class="cart-price">₹<input class="cprice" data-id="${l.id}" type="number" min="0" step="0.01" value="${l.price}" /> × ${l.qty} = <b>${money(l.price * l.qty)}</b></div>
        </div>
        <div class="item-actions">
          <button class="qbtn cminus" data-id="${l.id}" aria-label="Decrease quantity">−</button>
          <input class="cqty" data-id="${l.id}" type="number" min="0" step="${/kg|g|L|ml/.test(l.unit) ? '0.001' : '1'}" value="${l.qty}" aria-label="Quantity of ${escapeHtml(l.name)}" />
          <button class="qbtn cplus" data-id="${l.id}" aria-label="Increase quantity">+</button>
          <button class="qbtn cdel" data-id="${l.id}" title="Remove" aria-label="Remove ${escapeHtml(l.name)}">✕</button>
        </div>
      </li>`).join('');

    const empty = cart.length === 0;
    $('#cartEmpty').classList.toggle('hidden', !empty);
    $('#billSummary').classList.toggle('hidden', empty);

    const t = cartTotals();
    $('#sumSubtotal').textContent = money(t.subtotal);
    $('#sumTax').textContent = money(t.tax);
    $('#sumTotal').textContent = money(t.total);
    $('#taxLabel').textContent = '(' + taxRate + '%)';
  }

  function renderFavStrip() {
    const favs = items.filter((it) => it.fav);
    $('#favStrip').innerHTML = favs.map((it) =>
      `<button class="fav-btn" data-id="${it.id}">${escapeHtml(it.name)}<small>${money(it.price)}</small></button>`).join('');
  }
  $('#favStrip').addEventListener('click', (e) => {
    const btn = e.target.closest('.fav-btn'); if (!btn) return;
    const it = items.find((x) => x.id === btn.dataset.id);
    if (it) { addToCart(it); renderCart(); }
  });

  async function renderBill() {
    renderCart();
    renderFavStrip();
    const sales = await DB.allSales();
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const today = sales.filter((s) => s.createdAt >= startOfToday.getTime());
    const todayTotal = today.reduce((s, b) => s + b.total, 0);
    const todayProfit = today.reduce((s, b) =>
      s + b.lines.reduce((p, l) => p + ((l.price - (l.cost || 0)) * l.qty), 0) - (b.discount || 0), 0);
    $('#todayTotal').textContent = money(todayTotal);
    $('#todayTotal2').textContent = money(todayTotal);
    $('#todayProfit').textContent = money(todayProfit);
    $('#salesList').innerHTML = sales.slice(0, 30).map((s) => `
      <li>
        <span>#${s.invoiceNo} · ${new Date(s.createdAt).toLocaleString()} ${s.type === 'b2b' ? '· ' + escapeHtml(s.party?.name || 'B2B') : ''}</span>
        <b>${money(s.total)}</b>
        <button class="btn ghost small reprint" data-id="${s.id}">View</button>
      </li>`).join('') || '<li class="muted">No sales yet.</li>';
  }

  // Wholesale/tier price: when qty reaches the item's wholesale-min, use the wholesale rate.
  function applyTierPrice(line) {
    if (line.userPriced) return;   // respect a manually typed price
    line.price = (line.wprice && line.wmin && line.qty >= line.wmin) ? line.wprice : line.basePrice;
  }

  function addToCart(item) {
    const line = cart.find((l) => l.id === item.id);
    if (line) {
      line.qty += 1;
      applyTierPrice(line);
    } else {
      const base = (billType() === 'b2b' && item.wprice) ? item.wprice : item.price;
      cart.push({ id: item.id, name: item.name, price: base, basePrice: item.price,
        wprice: item.wprice || 0, wmin: item.wmin || 0,
        cost: item.cost || 0, qty: 1, unit: item.unit || 'pcs', maxStock: item.quantity });
    }
    renderCart();
  }

  // Search-to-add suggestions
  $('#billSearch').addEventListener('input', () => {
    const q = $('#billSearch').value.trim().toLowerCase();
    const box = $('#billSuggest');
    if (!q) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    const matches = items.filter((it) =>
      it.name.toLowerCase().includes(q) || (it.barcode && it.barcode.includes(q))).slice(0, 8);
    box.innerHTML = matches.map((it) =>
      `<li data-id="${it.id}">${escapeHtml(it.name)} <span class="muted">${money(it.price)} · ${it.quantity} left</span></li>`).join('');
    box.classList.toggle('hidden', matches.length === 0);
  });

  $('#billSuggest').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const it = items.find((x) => x.id === li.dataset.id);
    if (it) addToCart(it);
    $('#billSearch').value = '';
    $('#billSuggest').classList.add('hidden');
  });

  $('#billScanBtn').addEventListener('click', () => {
    pendingScanTarget = 'bill';
    showView('scan');
    startScan();
  });

  // ---------- Voice billing (Hindi / Odia / English / regional) ----------
  // Number words across scripts → value. Digits handled separately.
  const NUMWORDS = {
    // English
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, half: 0.5, quarter: 0.25, dozen: 12,
    // Hindi (Devanagari)
    'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'छे': 6, 'सात': 7,
    'आठ': 8, 'नौ': 9, 'दस': 10, 'आधा': 0.5, 'पाव': 0.25, 'डेढ़': 1.5, 'ढाई': 2.5, 'दर्जन': 12,
    // Odia
    'ଏକ': 1, 'ଦୁଇ': 2, 'ତିନି': 3, 'ଚାରି': 4, 'ପାଞ୍ଚ': 5, 'ଛଅ': 6, 'ସାତ': 7, 'ଆଠ': 8, 'ନଅ': 9, 'ଦଶ': 10
  };
  // Unit / filler words to ignore when matching the item name.
  const FILLER = new Set([
    'kg', 'kilo', 'kilogram', 'gram', 'gm', 'g', 'packet', 'pkt', 'piece', 'pcs', 'litre', 'liter', 'l', 'ml',
    'का', 'की', 'के', 'और', 'किलो', 'ग्राम', 'पैकेट', 'पीस', 'लीटर',
    'ଓ', 'ଆଉ', 'କିଲୋ', 'ଗ୍ରାମ', 'ପ୍ୟାକେଟ୍', 'ଲିଟର'
  ]);

  function parseQtyToken(tok) {
    if (/^[\d.]+$/.test(tok)) return parseFloat(tok);
    // Devanagari/Odia digits
    const map = { '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
      '୦': '0', '୧': '1', '୨': '2', '୩': '3', '୪': '4', '୫': '5', '୬': '6', '୭': '7', '୮': '8', '୯': '9' };
    const conv = tok.split('').map((c) => map[c] || c).join('');
    if (/^[\d.]+$/.test(conv)) return parseFloat(conv);
    if (NUMWORDS[tok] != null) return NUMWORDS[tok];
    return null;
  }

  // Best-match an item by overlapping words; returns the item or null.
  function matchItem(words) {
    const q = words.filter((w) => w && !FILLER.has(w.toLowerCase()));
    if (!q.length) return null;
    let best = null, bestScore = 0;
    for (const it of items) {
      const name = it.name.toLowerCase();
      let score = 0;
      q.forEach((w) => { if (name.includes(w.toLowerCase())) score += w.length; });
      if (score > bestScore) { bestScore = score; best = it; }
    }
    return bestScore > 0 ? best : null;
  }

  function parseVoiceToCart(transcript) {
    // Split into items on commas / "and" / "aur" / Odia "o"/"au".
    const chunks = transcript.split(/[,;\n]|\band\b|\baur\b|\bଆଉ\b|\bଓ\b|\bऔर\b/i).map((s) => s.trim()).filter(Boolean);
    const added = [], missed = [];
    chunks.forEach((chunk) => {
      const tokens = chunk.split(/\s+/);
      let qty = 1, rest = tokens;
      const firstQ = parseQtyToken(tokens[0]);
      if (firstQ != null) { qty = firstQ; rest = tokens.slice(1); }
      const it = matchItem(rest);
      if (it) {
        const line = cart.find((l) => l.id === it.id);
        if (line) line.qty = +(line.qty + qty).toFixed(3);
        else cart.push({ id: it.id, name: it.name, price: it.price, cost: it.cost || 0, qty, unit: it.unit || 'pcs', maxStock: it.quantity });
        added.push(qty + '× ' + it.name);
      } else {
        missed.push(chunk);
      }
    });
    return { added, missed };
  }

  $('#billVoiceBtn').addEventListener('click', () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return toast('Voice not supported on this browser');
    const rec = new SR();
    rec.lang = ({ hi: 'hi-IN', or: 'or-IN', bn: 'bn-IN', ta: 'ta-IN', te: 'te-IN', mr: 'mr-IN' }[I18N.lang]) || 'en-IN';
    rec.interimResults = false; rec.maxAlternatives = 1;
    const hint = $('#voiceHint');
    hint.classList.remove('hidden'); hint.textContent = '🎤 Listening… say e.g. "2 Parle-G, 1 Tata Salt"';
    rec.onresult = (ev) => {
      const transcript = ev.results[0][0].transcript;
      const { added, missed } = parseVoiceToCart(transcript);
      renderCart();
      hint.textContent = '🗣️ "' + transcript + '"';
      if (added.length) toast('Added: ' + added.join(', '));
      if (missed.length) toast('Not found: ' + missed.join(', '));
      if (!added.length && !missed.length) toast('Nothing recognised');
    };
    rec.onerror = (e) => { hint.textContent = ''; toast(e.error === 'no-speech' ? 'Did not hear anything' : 'Voice needs internet/mic'); };
    rec.start();
  });

  function updateCartTotals() {
    const tt = cartTotals();
    $('#sumSubtotal').textContent = money(tt.subtotal);
    $('#sumTax').textContent = money(tt.tax);
    $('#sumTotal').textContent = money(tt.total);
  }

  $('#cartList').addEventListener('click', (e) => {
    const id = e.target.dataset.id;
    if (!id) return;
    const line = cart.find((l) => l.id === id);
    if (!line) return;
    if (e.target.classList.contains('cplus')) { line.qty = +(line.qty + 1).toFixed(3); applyTierPrice(line); }
    else if (e.target.classList.contains('cminus')) { line.qty = Math.max(+(line.qty - 1).toFixed(3), 0); applyTierPrice(line); }
    else if (e.target.classList.contains('cdel')) cart = cart.filter((l) => l.id !== id);
    renderCart();
  });

  // Live total update on typing; full re-render on blur (keeps focus while typing decimals).
  $('#cartList').addEventListener('input', (e) => {
    const line = cart.find((l) => l.id === e.target.dataset.id);
    if (!line) return;
    if (e.target.classList.contains('cprice')) { line.price = Number(e.target.value) || 0; line.userPriced = true; }
    else if (e.target.classList.contains('cqty')) { line.qty = Number(e.target.value) || 0; applyTierPrice(line); }
    else return;
    updateCartTotals();
  });
  $('#cartList').addEventListener('change', (e) => {
    if (e.target.classList.contains('cqty') || e.target.classList.contains('cprice')) renderCart();
  });

  $('#billDiscount').addEventListener('input', updateCartTotals);
  $('#clearCartBtn').addEventListener('click', () => { cart = []; $('#billDiscount').value = 0; renderCart(); });

  $('#salesList').addEventListener('click', async (e) => {
    if (e.target.classList.contains('reprint')) {
      const sales = await DB.allSales();
      const sale = sales.find((s) => s.id === e.target.dataset.id);
      if (sale) showReceipt(sale);
    }
  });

  // Payment method: "Udhaar" (credit) reveals Khata customer fields.
  function payMethod() {
    const r = document.querySelector('input[name="payMethod"]:checked');
    return r ? r.value : 'cash';
  }
  document.querySelectorAll('input[name="payMethod"]').forEach((r) =>
    r.addEventListener('change', () => {
      const m = payMethod();
      $('#khataFields').classList.toggle('hidden', m !== 'credit');
      $('#splitFields').classList.toggle('hidden', m !== 'split');
      if (m === 'split') { $('#splitCash').value = cartTotals().total.toFixed(2); $('#splitUpi').value = 0; }
    }));

  // Financial-year invoice number, e.g. INV/2025-26/0001 (India FY starts April).
  async function fyInvoiceNo() {
    const n = new Date();
    const fyStart = n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1;
    const fy = fyStart + '-' + String((fyStart + 1) % 100).padStart(2, '0');
    const key = 'inv_' + fy;
    const seq = (await DB.getMeta(key, 0)) + 1;
    await DB.setMeta(key, seq);
    await DB.nextInvoiceNo();   // keep the legacy global counter moving too
    return { display: 'INV/' + fy + '/' + String(seq).padStart(4, '0'), seq, fy };
  }

  $('#checkoutBtn').addEventListener('click', async () => {
    if (!cart.length) return;
    // Low-margin / below-cost guard.
    const belowCost = cart.filter((l) => l.cost && l.price < l.cost);
    if (belowCost.length && !confirm('Warning: selling below cost — ' + belowCost.map((l) => l.name).join(', ') + '. Continue?')) return;
    const tot = cartTotals();
    const method = payMethod();          // cash | upi | credit | split
    const unpaid = method === 'credit';
    const inv = await fyInvoiceNo();
    const party = billType() === 'b2b'
      ? { name: $('#p_name').value.trim(), phone: $('#p_phone').value.trim(), gst: $('#p_gst').value.trim() }
      : (unpaid ? { name: $('#k_name').value.trim(), phone: $('#k_phone').value.trim(), gst: '' } : null);

    // Split payment breakdown
    let split = null;
    if (method === 'split') {
      const cashP = toPaise($('#splitCash').value), upiP = toPaise($('#splitUpi').value);
      split = { cash: toRupees(cashP), upi: toRupees(upiP), credit: Math.max(toRupees(toPaise(tot.total) - cashP - upiP), 0) };
    }

    const sale = {
      invoiceNo: inv.display, invSeq: inv.seq, fy: inv.fy,
      type: billType(),
      party,
      unpaid: unpaid || (split && split.credit > 0),
      payMethod: method,
      split,
      lines: cart.map((l) => {
        const it = items.find((x) => x.id === l.id);
        return {
          name: l.name, price: l.price, qty: l.qty, unit: l.unit,
          cost: l.cost || 0, hsn: it ? (it.hsn || '') : '', gstRate: it && it.gst != null ? it.gst : taxRate,
          total: +(l.price * l.qty).toFixed(2)
        };
      }),
      subtotal: tot.subtotal, discount: tot.discount, taxRate, tax: tot.tax,
      roundOff: tot.roundOff, total: tot.total,
      createdAt: Date.now()
    };
    // Per-invoice payment tracking: how much is already paid, and a due date for credit.
    const paidNow = split ? (split.cash + split.upi) : (unpaid ? 0 : tot.total);
    sale.paid = +paidNow.toFixed(2);
    sale.payments = paidNow > 0 ? [{ amt: sale.paid, method: method === 'split' ? 'split' : method, ts: Date.now() }] : [];
    const termsDays = Number(await DB.getMeta('creditTerms', 0)) || 0;
    if (sale.unpaid && termsDays > 0) sale.due = Date.now() + termsDays * 86400000;

    // Deduct sold quantities from stock.
    for (const l of cart) {
      const it = items.find((x) => x.id === l.id);
      if (it) { it.quantity = Math.max(it.quantity - l.qty, 0); await DB.saveItem(it); }
    }
    await DB.saveSale(sale);

    // If Udhaar (or split with a credit remainder), record a Khata entry.
    const creditAmt = split ? split.credit : (unpaid ? tot.total : 0);
    if (creditAmt > 0 && party && party.name) {
      await DB.saveKhata({
        customer: { name: party.name, phone: party.phone || '' },
        amount: creditAmt, kind: 'udhaar',
        note: sale.invoiceNo, createdAt: Date.now()
      });
    }

    cart = [];
    $('#billDiscount').value = 0;
    document.querySelector('input[name="payMethod"][value="cash"]').checked = true;
    $('#khataFields').classList.add('hidden');
    $('#splitFields').classList.add('hidden');
    $('#p_name').value = $('#p_phone').value = $('#p_gst').value = '';
    $('#k_name').value = $('#k_phone').value = '';
    await reload();
    await renderBill();
    showReceipt(sale);
    scheduleBackup();
    toast(sale.invoiceNo + ' · ' + money(sale.total) + (sale.unpaid ? ' (Udhaar)' : ''));
  });

  // ---------- Receipt ----------
  let shop = { name: 'My Shop', phone: '', address: '', gst: '', upi: '', upiQr: '' };
  const APP_URL = location.origin + location.pathname.replace(/index\.html$/, '');
  let lastSale = null;

  function upiLink(amount) {
    if (!shop.upi) return '';
    const p = new URLSearchParams({ pa: shop.upi, pn: shop.name, am: Number(amount).toFixed(2), cu: 'INR' });
    return 'upi://pay?' + p.toString();
  }

  function receiptHtml(sale) {
    const lines = sale.lines.map((l) =>
      `<tr><td>${escapeHtml(l.name)}<br><small>${l.qty} ${escapeHtml(l.unit)} × ₹${l.price.toFixed(2)}</small></td><td class="r">₹${l.total.toFixed(2)}</td></tr>`).join('');
    const party = sale.party
      ? `<div class="party">To: <b>${escapeHtml(sale.party.name || '-')}</b>${sale.party.phone ? '<br>Ph: ' + escapeHtml(sale.party.phone) : ''}${sale.party.gst ? '<br>GSTIN: ' + escapeHtml(sale.party.gst) : ''}</div>`
      : '';
    const upiBlock = (shop.upi || shop.upiQr)
      ? `<div class="r-upi">${shop.upiQr ? `<img src="${shop.upiQr}" alt="UPI QR" />` : ''}${shop.upi ? `<div>Pay ₹${sale.total.toFixed(2)} to<br><b>${escapeHtml(shop.upi)}</b></div>` : ''}</div>`
      : '';
    return `
      <div class="r-head">
        <h2>${escapeHtml(shop.name)}</h2>
        ${shop.address ? `<div>${escapeHtml(shop.address)}</div>` : ''}
        ${shop.phone ? `<div>Ph: ${escapeHtml(shop.phone)}</div>` : ''}
        ${shop.gst ? `<div>GSTIN: ${escapeHtml(shop.gst)}</div>` : ''}
      </div>
      <div class="r-meta">
        <span>${escapeHtml(String(sale.invoiceNo))}</span>
        <span>${new Date(sale.createdAt).toLocaleString()}</span>
      </div>
      <div class="r-meta"><span>${sale.type === 'b2b' ? 'B2B / Wholesale' : 'Retail'}${sale.refund ? ' · REFUND' : ''}${sale.unpaid ? ' · UDHAAR' : ''}</span></div>
      ${party}
      <table class="r-table"><tbody>${lines}</tbody></table>
      <div class="r-tot"><span>Subtotal</span><span>₹${sale.subtotal.toFixed(2)}</span></div>
      ${sale.discount ? `<div class="r-tot"><span>Discount</span><span>−₹${sale.discount.toFixed(2)}</span></div>` : ''}
      ${sale.tax ? (shop.gst
        ? `<div class="r-tot"><span>CGST</span><span>₹${(sale.tax / 2).toFixed(2)}</span></div><div class="r-tot"><span>SGST</span><span>₹${(sale.tax / 2).toFixed(2)}</span></div>`
        : `<div class="r-tot"><span>Tax (${sale.taxRate}%)</span><span>₹${sale.tax.toFixed(2)}</span></div>`) : ''}
      ${sale.roundOff ? `<div class="r-tot"><span>Round off</span><span>${sale.roundOff < 0 ? '−' : '+'}₹${Math.abs(sale.roundOff).toFixed(2)}</span></div>` : ''}
      <div class="r-tot grand"><span>TOTAL</span><span>₹${sale.total.toFixed(2)}</span></div>
      ${sale.split ? `<div class="r-meta"><span>Cash ₹${sale.split.cash.toFixed(2)} · UPI ₹${sale.split.upi.toFixed(2)}${sale.split.credit ? ' · Udhaar ₹' + sale.split.credit.toFixed(2) : ''}</span></div>` : (sale.payMethod ? `<div class="r-meta"><span>Paid: ${sale.payMethod.toUpperCase()}</span></div>` : '')}
      ${upiBlock}
      <div class="r-foot">Thank you! Visit again 🙏<br><small>Made with Look Inventory</small></div>`;
  }

  function receiptText(sale) {
    let s = `*${shop.name}*\n`;
    if (shop.phone) s += 'Ph: ' + shop.phone + '\n';
    s += `Bill #${sale.invoiceNo} · ${new Date(sale.createdAt).toLocaleString()}\n`;
    if (sale.party && sale.party.name) s += 'To: ' + sale.party.name + '\n';
    s += '--------------------------------\n';
    sale.lines.forEach((l) => { s += `${l.name}\n  ${l.qty} x ${l.price.toFixed(2)} = ${l.total.toFixed(2)}\n`; });
    s += '--------------------------------\n';
    s += `Subtotal: ${sale.subtotal.toFixed(2)}\n`;
    if (sale.discount) s += `Discount: -${sale.discount.toFixed(2)}\n`;
    if (sale.tax) s += `Tax (${sale.taxRate}%): ${sale.tax.toFixed(2)}\n`;
    s += `TOTAL: ${sale.total.toFixed(2)}\n`;
    if (sale.unpaid) s += '(UDHAAR — unpaid)\n';
    if (shop.upi) s += `\nPay to UPI: ${shop.upi}\n`;
    s += '\nThank you!';
    return s;
  }

  // Render the on-screen receipt DOM to a PNG for WhatsApp image sharing.
  function receiptToCanvas() {
    const el = $('#receiptArea');
    const lines = el.innerText.split('\n').filter((x) => x.trim() !== '');
    const pad = 16, lh = 22, w = 360;
    const c = document.createElement('canvas');
    c.width = w; c.height = pad * 2 + lines.length * lh;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#000'; ctx.font = '15px monospace'; ctx.textBaseline = 'top';
    lines.forEach((ln, i) => ctx.fillText(ln, pad, pad + i * lh));
    return c;
  }

  const RECEIPT_CSS = `
    body{font-family:'Courier New',monospace;color:#000;margin:0;padding:10px;max-width:300px}
    .r-head{text-align:center;margin-bottom:6px}.r-head h2{margin:0;font-size:18px}
    .r-meta{display:flex;justify-content:space-between;font-size:12px}
    .party{font-size:12px;margin:6px 0;border-top:1px dashed #000;padding-top:4px}
    .r-table{width:100%;border-top:1px dashed #000;border-bottom:1px dashed #000;margin:6px 0;font-size:12px;border-collapse:collapse}
    .r-table td{padding:3px 0;vertical-align:top}.r-table td.r{text-align:right;white-space:nowrap}
    .r-table small{color:#333}
    .r-tot{display:flex;justify-content:space-between;font-size:13px}
    .r-tot.grand{font-weight:bold;font-size:16px;border-top:1px solid #000;margin-top:4px;padding-top:4px}
    .r-upi{text-align:center;margin-top:8px;border-top:1px dashed #000;padding-top:6px;font-size:12px}
    .r-upi img{max-width:140px;display:block;margin:4px auto}
    .r-foot{text-align:center;margin-top:10px;font-size:12px}`;

  function showReceipt(sale) {
    lastSale = sale;
    lastReceiptHtml = receiptHtml(sale);
    lastReceiptText = receiptText(sale);
    $('#receiptArea').innerHTML = lastReceiptHtml;
    const link = upiLink(sale.total);
    const wrap = $('#payUpiWrap');
    if (link) { $('#payUpiLink').href = link; wrap.classList.remove('hidden'); }
    else wrap.classList.add('hidden');
    $('#receiptDialog').showModal();
  }

  $('#receiptCloseBtn').addEventListener('click', () => $('#receiptDialog').close());

  // Share receipt as an image (best for WhatsApp).
  $('#receiptImgBtn').addEventListener('click', async () => {
    const canvas = receiptToCanvas();
    canvas.toBlob(async (blob) => {
      const file = new File([blob], 'receipt-' + (lastSale ? lastSale.invoiceNo : '') + '.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Receipt' }); return; } catch (_) {}
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
      URL.revokeObjectURL(a.href);
      toast('Receipt image saved');
    }, 'image/png');
  });

  // Experimental Bluetooth thermal printer.
  $('#receiptBtBtn').addEventListener('click', async () => {
    try {
      toast('Connecting to printer…');
      await BTPrint.print(lastReceiptText);
      toast('Sent to printer');
    } catch (err) {
      toast('Printer: ' + err.message);
    }
  });

  $('#receiptPrintBtn').addEventListener('click', () => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write('<html><head><title>Receipt</title><style>' + RECEIPT_CSS + '</style></head><body>' + lastReceiptHtml + '</body></html>');
    doc.close();
    frame.contentWindow.focus();
    setTimeout(() => { frame.contentWindow.print(); setTimeout(() => frame.remove(), 800); }, 250);
  });

  $('#receiptShareBtn').addEventListener('click', async () => {
    if (navigator.share) {
      try { await navigator.share({ text: lastReceiptText }); return; } catch (_) {}
    }
    try { await navigator.clipboard.writeText(lastReceiptText); toast('Receipt copied — paste into WhatsApp'); }
    catch (_) { toast('Sharing not supported on this browser'); }
  });

  // ---------- Settings: shop details ----------
  const shopInput = $('#shopNameInput');
  shopInput.addEventListener('change', async () => {
    const name = shopInput.value.trim() || 'My Shop';
    shop.name = name;
    await DB.setMeta('shopName', name);
    $('#shopName').textContent = name;
    toast('Shop name saved');
  });
  $('#shopPhoneInput').addEventListener('change', async (e) => {
    shop.phone = e.target.value.trim(); await DB.setMeta('shopPhone', shop.phone);
  });
  $('#shopAddressInput').addEventListener('change', async (e) => {
    shop.address = e.target.value.trim(); await DB.setMeta('shopAddress', shop.address);
  });
  $('#shopGstInput').addEventListener('change', async (e) => {
    shop.gst = e.target.value.trim(); await DB.setMeta('shopGst', shop.gst);
  });
  $('#taxRateInput').addEventListener('change', async (e) => {
    taxRate = Number(e.target.value) || 0; await DB.setMeta('taxRate', taxRate);
    renderCart(); toast('Tax rate set to ' + taxRate + '%');
  });
  $('#shopUpiInput').addEventListener('change', async (e) => {
    shop.upi = e.target.value.trim(); await DB.setMeta('shopUpi', shop.upi); toast('UPI ID saved');
  });
  $('#creditTermsInput').addEventListener('change', async (e) => {
    await DB.setMeta('creditTerms', Number(e.target.value) || 0); toast('Credit terms saved');
  });
  $('#upiQrInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    shop.upiQr = await compressImage(file, 300);
    await DB.setMeta('shopUpiQr', shop.upiQr);
    const prev = $('#upiQrPreview'); prev.src = shop.upiQr; prev.classList.remove('hidden');
    toast('UPI QR saved');
  });

  // ---------- Language ----------
  function buildLangSelect() {
    const sel = $('#langSelect');
    sel.innerHTML = Object.keys(I18N.names).map((k) => `<option value="${k}">${I18N.names[k]}</option>`).join('');
    sel.value = I18N.lang;
  }
  $('#langSelect').addEventListener('change', async (e) => {
    I18N.setLang(e.target.value);
    await DB.setMeta('lang', e.target.value);
    I18N.apply();
    renderAll();          // refresh dynamic strings
    await renderBill();
  });

  // ---------- App share ----------
  $('#shareAppBtn').addEventListener('click', async () => {
    const data = { title: 'Look Inventory', text: 'Free offline shop inventory + billing app', url: APP_URL };
    if (navigator.share) { try { await navigator.share(data); return; } catch (_) {} }
    try { await navigator.clipboard.writeText(APP_URL); toast('Link copied: ' + APP_URL); }
    catch (_) { toast(APP_URL); }
  });

  // ---------- Backup payload ----------
  async function buildPayload() {
    return {
      app: 'look-inventory',
      version: 4,
      exportedAt: Date.now(),
      shopName: await DB.getMeta('shopName', 'My Shop'),
      shopPhone: await DB.getMeta('shopPhone', ''),
      shopAddress: await DB.getMeta('shopAddress', ''),
      shopGst: await DB.getMeta('shopGst', ''),
      shopUpi: await DB.getMeta('shopUpi', ''),
      shopUpiQr: await DB.getMeta('shopUpiQr', ''),
      lang: await DB.getMeta('lang', 'en'),
      taxRate: await DB.getMeta('taxRate', 0),
      creditTerms: await DB.getMeta('creditTerms', 0),
      invoiceCounter: await DB.getMeta('invoiceCounter', 0),
      skuCounter: await DB.getMeta('skuCounter', 0),
      bcCounter: await DB.getMeta('bcCounter', 0),
      items: await DB.allItems(),
      sales: await DB.allSales(),
      khata: await DB.allKhata(),
      purchases: await DB.allPurchases(),
      expenses: await DB.allExpenses(),
      quotes: await DB.allQuotes()
    };
  }

  // Apply a backup/restore payload into local DB.
  async function applyPayload(data) {
    await DB.mergeItems(data.items || []);
    if (data.sales) await DB.mergeSales(data.sales);
    if (data.khata) await DB.mergeKhata(data.khata);
    if (data.purchases) await DB.mergePurchases(data.purchases);
    if (data.expenses) await DB.mergeExpenses(data.expenses);
    if (data.quotes) await DB.mergeQuotes(data.quotes);
    if (data.creditTerms != null) await DB.setMeta('creditTerms', data.creditTerms);
    if (data.skuCounter != null) {
      const cur = await DB.getMeta('skuCounter', 0);
      await DB.setMeta('skuCounter', Math.max(cur, data.skuCounter));
    }
    if (data.bcCounter != null) {
      const cur = await DB.getMeta('bcCounter', 0);
      await DB.setMeta('bcCounter', Math.max(cur, data.bcCounter));
    }
    if (data.shopName) { await DB.setMeta('shopName', data.shopName); $('#shopName').textContent = data.shopName; shop.name = data.shopName; }
    if (data.shopPhone != null) { await DB.setMeta('shopPhone', data.shopPhone); shop.phone = data.shopPhone; }
    if (data.shopAddress != null) { await DB.setMeta('shopAddress', data.shopAddress); shop.address = data.shopAddress; }
    if (data.shopGst != null) { await DB.setMeta('shopGst', data.shopGst); shop.gst = data.shopGst; }
    if (data.shopUpi != null) { await DB.setMeta('shopUpi', data.shopUpi); shop.upi = data.shopUpi; }
    if (data.shopUpiQr != null) { await DB.setMeta('shopUpiQr', data.shopUpiQr); shop.upiQr = data.shopUpiQr; }
    if (data.taxRate != null) { await DB.setMeta('taxRate', data.taxRate); taxRate = data.taxRate; }
    if (data.invoiceCounter != null) {
      const cur = await DB.getMeta('invoiceCounter', 0);
      await DB.setMeta('invoiceCounter', Math.max(cur, data.invoiceCounter));
    }
  }

  // ---------- Khata (credit ledger) ----------
  function khataBalances(rows) {
    const map = new Map();
    rows.forEach((r) => {
      const key = (r.customer.name || '') + '|' + (r.customer.phone || '');
      const cur = map.get(key) || { name: r.customer.name, phone: r.customer.phone, balance: 0, entries: [] };
      cur.balance += (r.kind === 'udhaar' ? r.amount : -r.amount);
      cur.entries.push(r);
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.balance - a.balance);
  }

  async function renderKhata() {
    const rows = await DB.allKhata();
    const customers = khataBalances(rows);
    const totalOwed = customers.reduce((s, c) => s + Math.max(c.balance, 0), 0);
    $('#hubKhataBal').textContent = money(totalOwed);
    $('#khataList').innerHTML = customers.map((c) => `
      <li class="khata-cust">
        <div class="kc-head">
          <b>${escapeHtml(c.name || 'Unnamed')}</b>
          <span class="kc-bal ${c.balance > 0 ? 'owe' : 'clear'}">${money(c.balance)}</span>
        </div>
        ${c.phone ? `<div class="muted">${escapeHtml(c.phone)}</div>` : ''}
        <div class="row">
          <button class="btn ghost small kadd" data-name="${escapeHtml(c.name)}" data-phone="${escapeHtml(c.phone || '')}" data-kind="udhaar">+ Udhaar</button>
          <button class="btn ghost small kadd" data-name="${escapeHtml(c.name)}" data-phone="${escapeHtml(c.phone || '')}" data-kind="paid">− Paid</button>
          <button class="btn ghost small khist" data-name="${escapeHtml(c.name)}" data-phone="${escapeHtml(c.phone || '')}">History</button>
          ${c.phone && c.balance > 0 ? `<button class="btn small kremind" data-name="${escapeHtml(c.name)}" data-phone="${escapeHtml(c.phone)}" data-amt="${c.balance.toFixed(2)}">Remind</button>` : ''}
        </div>
      </li>`).join('') || '<li class="muted">No khata entries yet.</li>';
  }

  async function addKhataEntry(name, phone, kind) {
    const amtStr = prompt((kind === 'udhaar' ? 'Udhaar (owes) amount ₹' : 'Payment received ₹') + ' for ' + (name || 'customer') + ':');
    const amount = Number(amtStr);
    if (!amount || amount <= 0) return;
    await DB.saveKhata({ customer: { name, phone }, amount, kind, note: '', createdAt: Date.now() });
    await renderKhata();
    scheduleBackup();
    toast('Saved');
  }

  $('#openKhataBtn').addEventListener('click', async () => { await renderKhata(); $('#khataDialog').showModal(); });
  $('#khataCloseBtn').addEventListener('click', () => $('#khataDialog').close());
  $('#addKhataBtn').addEventListener('click', async () => {
    const name = prompt('Customer name:'); if (!name) return;
    const phone = prompt('Phone (optional):') || '';
    await addKhataEntry(name.trim(), phone.trim(), 'udhaar');
  });
  $('#khataList').addEventListener('click', (e) => {
    if (e.target.classList.contains('kadd')) {
      addKhataEntry(e.target.dataset.name, e.target.dataset.phone, e.target.dataset.kind);
    } else if (e.target.classList.contains('khist')) {
      $('#khataDialog').close();
      customerHistory(e.target.dataset.name, e.target.dataset.phone);
    } else if (e.target.classList.contains('kremind')) {
      const amt = e.target.dataset.amt;
      const pay = upiLink(amt);   // tappable UPI link with the exact balance
      let msg = `Namaste ${e.target.dataset.name}, your pending balance at ${shop.name} is ₹${amt}. Kindly pay when convenient.`;
      if (pay) msg += `\nPay instantly: ${pay}`;
      else if (shop.upi) msg += `\nPay to UPI: ${shop.upi}`;
      msg += `\nDhanyavaad 🙏`;
      const phone = e.target.dataset.phone.replace(/\D/g, '');
      const wa = 'https://wa.me/' + (phone.length === 10 ? '91' + phone : phone) + '?text=' + encodeURIComponent(msg);
      window.open(wa, '_blank');
    }
  });

  // ---------- Reports ----------
  async function renderReports() {
    const sales = await DB.allSales();
    const now = new Date();
    const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
    const startWeek = startToday.getTime() - 6 * DAY;
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    const sum = (from) => sales.filter((s) => s.createdAt >= from)
      .reduce((a, s) => {
        a.total += s.total;
        a.profit += s.lines.reduce((p, l) => p + ((l.price - (l.cost || 0)) * l.qty), 0) - (s.discount || 0);
        a.count += 1;
        return a;
      }, { total: 0, profit: 0, count: 0 });

    const today = sum(startToday.getTime()), week = sum(startWeek), month = sum(startMonth);

    // Best sellers (by qty, last 30 days)
    const since = now.getTime() - 30 * DAY;
    const qtyMap = new Map();
    sales.filter((s) => s.createdAt >= since).forEach((s) =>
      s.lines.forEach((l) => qtyMap.set(l.name, (qtyMap.get(l.name) || 0) + l.qty)));
    const best = Array.from(qtyMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const card = (label, d) => `
      <div class="rep-card">
        <span>${label}</span>
        <b>${money(d.total)}</b>
        <small>${d.count} bills · profit ${money(d.profit)}</small>
      </div>`;

    // Selected-month day-wise breakdown + GST summary.
    const mv = $('#reportMonth').value; // 'YYYY-MM'
    let monthBlock = '';
    if (mv) {
      const [yy, mm] = mv.split('-').map(Number);
      const mStart = new Date(yy, mm - 1, 1).getTime();
      const mEnd = new Date(yy, mm, 1).getTime();
      const monthSales = sales.filter((s) => s.createdAt >= mStart && s.createdAt < mEnd);
      const byDay = new Map();
      let taxable = 0, gst = 0;
      monthSales.forEach((s) => {
        const d = new Date(s.createdAt).toLocaleDateString();
        byDay.set(d, (byDay.get(d) || 0) + s.total);
        taxable += (s.subtotal - (s.discount || 0)); gst += (s.tax || 0);
      });
      const rows = Array.from(byDay.entries()).map(([d, v]) => `<li><span>${d}</span><b>${money(v)}</b></li>`).join('');
      monthBlock = `
        <h4>Day-wise — ${mv}</h4>
        <ul class="best-list">${rows || '<li class="muted">No sales this month.</li>'}</ul>
        <div class="rep-grid">
          ${card('Month total', sum(mStart).total !== undefined ? { total: monthSales.reduce((a, s) => a + s.total, 0), count: monthSales.length, profit: monthSales.reduce((a, s) => a + s.lines.reduce((p, l) => p + ((l.price - (l.cost || 0)) * l.qty), 0) - (s.discount || 0), 0) } : {})}
          <div class="rep-card"><span>GST collected</span><b>${money(gst)}</b><small>taxable ${money(taxable)}</small></div>
        </div>`;
    }

    // Dead stock: in stock but not sold in 60 days (or never sold).
    const deadCut = now.getTime() - 60 * DAY;
    const dead = items.filter((it) => it.quantity > 0 && (!lastSoldMap[it.name] || lastSoldMap[it.name] < deadCut))
      .sort((a, b) => b.quantity * b.cost - a.quantity * a.cost).slice(0, 10);

    // Inventory valuation + net P&L (this month, after expenses).
    const stockCost = items.reduce((a, it) => a + (it.quantity * (it.cost || 0)), 0);
    const stockMrp = items.reduce((a, it) => a + (it.quantity * (it.price || 0)), 0);
    const expenses = await DB.allExpenses();
    const monthExpense = expenses.filter((x) => x.createdAt >= startMonth).reduce((a, x) => a + x.amount, 0);
    const netPL = month.profit - monthExpense;

    $('#reportsContent').innerHTML = `
      <div class="rep-grid">
        ${card(t('today'), today)}${card('This week', week)}${card('This month', month)}
      </div>
      <h4>Best sellers (30 days)</h4>
      <ul class="best-list">
        ${best.map(([n, q]) => `<li><span>${escapeHtml(n)}</span><b>${q}</b></li>`).join('') || '<li class="muted">No sales yet.</li>'}
      </ul>
      <h4>💤 Dead stock (no sale in 60 days)</h4>
      <ul class="best-list">
        ${dead.map((it) => `<li><span>${escapeHtml(it.name)}</span><b>${it.quantity} ${escapeHtml(it.unit || 'pcs')}</b></li>`).join('') || '<li class="muted">None — good!</li>'}
      </ul>
      <h4>📦 Inventory valuation</h4>
      <div class="rep-grid">
        <div class="rep-card"><span>At cost</span><b>${money(stockCost)}</b></div>
        <div class="rep-card"><span>At MRP</span><b>${money(stockMrp)}</b></div>
        <div class="rep-card"><span>Potential margin</span><b>${money(stockMrp - stockCost)}</b></div>
      </div>
      <h4>📒 Net profit (this month)</h4>
      <div class="rep-grid">
        <div class="rep-card"><span>Gross profit</span><b>${money(month.profit)}</b></div>
        <div class="rep-card"><span>Expenses</span><b>${money(monthExpense)}</b></div>
        <div class="rep-card"><span>Net</span><b class="${netPL < 0 ? 'exp expired' : ''}">${money(netPL)}</b></div>
      </div>
      ${monthBlock}`;
  }
  $('#openReportsBtn').addEventListener('click', async () => {
    if (!$('#reportMonth').value) {
      const n = new Date(); $('#reportMonth').value = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0');
    }
    await renderReports(); $('#reportsDialog').showModal();
  });
  $('#reportsCloseBtn').addEventListener('click', () => $('#reportsDialog').close());
  $('#reportMonth').addEventListener('change', renderReports);

  // Export all sales to CSV (opens in Excel / Google Sheets).
  $('#exportSalesBtn').addEventListener('click', async () => {
    const sales = await DB.allSales();
    const rows = [['Invoice', 'Date', 'Type', 'PayMethod', 'Customer', 'Item', 'Qty', 'Unit', 'Price', 'LineTotal', 'BillTotal']];
    sales.forEach((s) => s.lines.forEach((l) => rows.push([
      s.invoiceNo, new Date(s.createdAt).toLocaleString(), s.type, s.payMethod || '',
      (s.party && s.party.name) || '', l.name, l.qty, l.unit, l.price, l.total, s.total
    ])));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'sales.csv'; a.click();
    URL.revokeObjectURL(a.href);
    toast('Sales CSV exported');
  });

  $('#exportGstrBtn').addEventListener('click', exportGSTR);

  // ---------- Barcode labels ----------
  const labelPick = new Set();
  async function renderLabels() {
    $('#labelsList').innerHTML = items.map((it) => `
      <li>
        <label class="lbl-row">
          <input type="checkbox" class="lblchk" data-id="${it.id}" ${labelPick.has(it.id) ? 'checked' : ''} ${it.barcode ? '' : 'disabled'} />
          <span>${escapeHtml(it.name)} ${it.barcode ? `<small class="muted">${escapeHtml(it.barcode)}</small>` : '<small class="exp expired">no code — Generate in item</small>'}</span>
        </label>
      </li>`).join('');
  }
  $('#openLabelsBtn').addEventListener('click', async () => { await renderLabels(); $('#labelsDialog').showModal(); });
  $('#labelsCloseBtn').addEventListener('click', () => $('#labelsDialog').close());

  // Bulk: assign a barcode to every item that has none, in one tap (then they're printable + tagged).
  $('#genMissingBtn').addEventListener('click', async () => {
    const missing = items.filter((it) => !it.barcode);
    if (!missing.length) return toast('All items already have a code');
    let n = await DB.getMeta('bcCounter', 0);
    for (const it of missing) { n += 1; it.barcode = 'LI' + String(200000 + n); await DB.saveItem(it); labelPick.add(it.id); }
    await DB.setMeta('bcCounter', n);
    await reload(); await renderLabels(); scheduleBackup();
    toast('Generated ' + missing.length + ' codes — now selectable to print');
  });
  $('#selectAllLabelsBtn').addEventListener('click', async () => {
    items.filter((it) => it.barcode).forEach((it) => labelPick.add(it.id));
    await renderLabels();
  });
  $('#labelsList').addEventListener('change', (e) => {
    if (e.target.classList.contains('lblchk')) {
      const id = e.target.dataset.id;
      if (e.target.checked) labelPick.add(id); else labelPick.delete(id);
    }
  });
  $('#printLabelsBtn').addEventListener('click', () => {
    const chosen = items.filter((it) => labelPick.has(it.id) && it.barcode);
    if (!chosen.length) return toast('Select items with a barcode first');
    const cells = chosen.map((it) => `
      <div class="lbl">
        <div class="lbl-name">${escapeHtml(it.name)}</div>
        <div class="lbl-price">${money(it.price)}</div>
        ${Barcode.toSVG(it.barcode, { height: 40, moduleWidth: 1.4 })}
      </div>`).join('');
    const css = `body{font-family:sans-serif;margin:8px}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
      .lbl{border:1px solid #ccc;border-radius:4px;padding:6px;text-align:center;page-break-inside:avoid}
      .lbl-name{font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .lbl-price{font-size:13px;font-weight:700}svg{max-width:100%}`;
    printHtml('<div class="grid">' + cells + '</div>', css);
  });

  // Generic print helper (prints HTML in a hidden iframe).
  function printHtml(html, css) {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write('<html><head><title>Print</title><style>' + (css || '') + '</style></head><body>' + html + '</body></html>');
    doc.close();
    frame.contentWindow.focus();
    setTimeout(() => { frame.contentWindow.print(); setTimeout(() => frame.remove(), 800); }, 300);
  }

  // ---------- Purchases + suppliers ----------
  let puCart = [];   // { id, name, qty, cost, unit }
  function puTotal() { return puCart.reduce((s, l) => s + (l.cost || 0) * (l.qty || 0), 0); }
  function renderPuCart() {
    $('#puList').innerHTML = puCart.map((l) => `
      <li class="item" data-id="${l.id}">
        <div class="item-main"><div class="item-name">${escapeHtml(l.name)}</div>
          <div class="cart-price">Qty <input class="puqty" data-id="${l.id}" type="number" min="0" step="0.001" value="${l.qty}" /> × cost ₹<input class="pucost" data-id="${l.id}" type="number" min="0" step="0.01" value="${l.cost}" /></div>
        </div>
        <button class="qbtn cdel pudel" data-id="${l.id}">✕</button>
      </li>`).join('');
    $('#puTotal').textContent = money(puTotal());
  }
  async function renderSuppliers() {
    const purchases = await DB.allPurchases();
    const map = new Map();
    purchases.forEach((p) => {
      const k = p.supplier || 'Unknown';
      const cur = map.get(k) || { name: k, owed: 0 };
      if (p.unpaid) cur.owed += p.total;
      map.set(k, cur);
    });
    const list = Array.from(map.values());
    $('#supplierList').innerHTML = list.map((s) => `
      <li class="khata-cust"><div class="kc-head"><b>${escapeHtml(s.name)}</b>
      <span class="kc-bal ${s.owed > 0 ? 'owe' : 'clear'}">${money(s.owed)}</span></div></li>`).join('')
      || '<li class="muted">No purchases yet.</li>';
  }
  $('#openPurchasesBtn').addEventListener('click', async () => { puCart = []; renderPuCart(); await renderSuppliers(); $('#purchasesDialog').showModal(); });
  $('#purchasesCloseBtn').addEventListener('click', () => $('#purchasesDialog').close());
  $('#puSearch').addEventListener('input', () => {
    const q = $('#puSearch').value.trim().toLowerCase();
    const box = $('#puSuggest');
    if (!q) { box.classList.add('hidden'); return; }
    const matches = items.filter((it) => it.name.toLowerCase().includes(q) || (it.barcode && it.barcode.includes(q))).slice(0, 8);
    box.innerHTML = matches.map((it) => `<li data-id="${it.id}">${escapeHtml(it.name)} <span class="muted">cost ${money(it.cost)}</span></li>`).join('');
    box.classList.toggle('hidden', !matches.length);
  });
  $('#puSuggest').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]'); if (!li) return;
    const it = items.find((x) => x.id === li.dataset.id);
    if (it && !puCart.find((l) => l.id === it.id)) puCart.push({ id: it.id, name: it.name, qty: 1, cost: it.cost || 0, unit: it.unit });
    $('#puSearch').value = ''; $('#puSuggest').classList.add('hidden'); renderPuCart();
  });
  $('#puList').addEventListener('input', (e) => {
    const l = puCart.find((x) => x.id === e.target.dataset.id); if (!l) return;
    if (e.target.classList.contains('puqty')) l.qty = Number(e.target.value) || 0;
    else if (e.target.classList.contains('pucost')) l.cost = Number(e.target.value) || 0;
    $('#puTotal').textContent = money(puTotal());
  });
  $('#puList').addEventListener('click', (e) => {
    if (e.target.classList.contains('pudel')) { puCart = puCart.filter((l) => l.id !== e.target.dataset.id); renderPuCart(); }
  });
  $('#savePurchaseBtn').addEventListener('click', async () => {
    if (!puCart.length) return toast('Add items first');
    const supplier = $('#pu_supplier').value.trim() || 'Unknown';
    const unpaid = $('#puUnpaid').checked;
    const purchase = {
      supplier, unpaid, total: +puTotal().toFixed(2),
      lines: puCart.map((l) => ({ name: l.name, qty: l.qty, cost: l.cost })), createdAt: Date.now()
    };
    // Add to stock + refresh cost price.
    for (const l of puCart) {
      const it = items.find((x) => x.id === l.id);
      if (it) { it.quantity += l.qty; if (l.cost) it.cost = l.cost; await DB.saveItem(it); }
    }
    await DB.savePurchase(purchase);
    $('#pu_supplier').value = ''; $('#puUnpaid').checked = false; puCart = [];
    await reload(); renderPuCart(); await renderSuppliers();
    scheduleBackup();
    toast('Purchase saved · stock updated');
  });

  // ---------- Day close / cash summary ----------
  async function renderDayClose() {
    const sales = await DB.allSales();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const today = sales.filter((s) => s.createdAt >= start.getTime());
    const by = { cash: 0, upi: 0, credit: 0 };
    today.forEach((s) => {
      if (s.split) { by.cash += s.split.cash; by.upi += s.split.upi; by.credit += s.split.credit; }
      else { const m = s.payMethod === 'credit' ? 'credit' : (s.payMethod || 'cash'); by[m] = (by[m] || 0) + s.total; }
    });
    const total = today.reduce((a, s) => a + s.total, 0);
    $('#dayCloseContent').innerHTML = `
      <div class="rep-grid">
        <div class="rep-card"><span>Total</span><b>${money(total)}</b><small>${today.length} bills</small></div>
        <div class="rep-card"><span>💵 Cash</span><b>${money(by.cash)}</b></div>
        <div class="rep-card"><span>📱 UPI</span><b>${money(by.upi)}</b></div>
        <div class="rep-card"><span>📒 Udhaar</span><b>${money(by.credit)}</b></div>
      </div>`;
  }
  $('#openDayCloseBtn').addEventListener('click', async () => { await renderDayClose(); $('#dayCloseDialog').showModal(); });
  $('#dayCloseCloseBtn').addEventListener('click', () => $('#dayCloseDialog').close());
  $('#cashReceived').addEventListener('input', () => {
    const totalText = $('#dayCloseContent').querySelector('.rep-card b');
    const total = Number((totalText ? totalText.textContent : '').replace(/[^0-9.]/g, '')) || 0;
    const recv = Number($('#cashReceived').value) || 0;
    $('#changeDue').textContent = money(Math.max(recv - total, 0));
  });

  // ====================================================================
  //  Feature flags, PWA update, privacy, park/returns/adjust, roles, GST
  // ====================================================================

  // ---------- Feature flags: gate UI + handlers ----------
  function flagOn(name) { return Flags.on(name); }
  function applyFlags() {
    document.querySelectorAll('[data-flag]').forEach((el) => {
      el.classList.toggle('flag-off', !Flags.on(el.dataset.flag));
    });
  }
  function renderFeatures() {
    const labels = {
      billing: 'Billing', reorder: 'To-Order', scan: 'Barcode scan', voice: 'Voice billing',
      khata: 'Khata', reports: 'Reports', purchases: 'Purchases', labels: 'Barcode labels',
      dayclose: 'Day close', returns: 'Returns', splitPay: 'Split payment', parkBill: 'Park bills',
      stockAdjust: 'Stock adjustment', gst: 'GST fields', driveSync: 'Google Drive', liveSync: 'Live sync'
    };
    const all = Flags.all();
    $('#featuresList').innerHTML = Object.keys(labels).map((k) =>
      `<label class="switch-row"><span>${labels[k]}</span><input type="checkbox" class="flagchk" data-flag="${k}" ${all[k] ? 'checked' : ''} /></label>`).join('');
  }
  $('#featuresList').addEventListener('change', async (e) => {
    if (!e.target.classList.contains('flagchk')) return;
    Flags.set(e.target.dataset.flag, e.target.checked);
    await DB.setMeta('flagOverrides', Flags.overrides);
    applyFlags();
    if (!Flags.on('billing') && currentView === 'bill') showView('inventory');
  });

  // ---------- Roles: owner vs cashier ----------
  // Cashier mode hides owner-only screens (Reports, Purchases, settings, etc.).
  // Exiting requires the owner's PIN, so staff can bill but not see reports/change prices.
  function applyCashier(on) {
    document.body.classList.toggle('cashier', !!on);
    $('#cashierExit').classList.toggle('hidden', !on);
    if (on && (currentView === 'settings')) showView('inventory');
  }
  $('#cashierModeBtn').addEventListener('click', async () => {
    const hash = await DB.getMeta('pinHash', '');
    if (!hash) return toast('Set a PIN first (above) to use cashier mode');
    await DB.setMeta('cashier', true);
    applyCashier(true);
    toast('Cashier mode on');
  });
  $('#cashierExit').addEventListener('click', async () => {
    const hash = await DB.getMeta('pinHash', '');
    const pin = prompt('Enter owner PIN to exit cashier mode:');
    if (pin == null) return;
    if (await sha256(pin) === hash) {
      await DB.setMeta('cashier', false);
      applyCashier(false);
      toast('Owner mode');
    } else {
      toast('Wrong PIN');
    }
  });

  // ---------- PWA update prompt ----------
  function watchForUpdates(reg) {
    if (!reg) return;
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          $('#updateBanner').classList.remove('hidden');
          $('#updateBtn').onclick = () => { nw.postMessage('skipWaiting'); location.reload(); };
        }
      });
    });
  }

  // ---------- Privacy / terms ----------
  $('#privacyBtn').addEventListener('click', () => $('#privacyDialog').showModal());
  $('#privacyCloseBtn').addEventListener('click', () => $('#privacyDialog').close());

  // ---------- Tutorial / Help ----------
  const TUTORIAL = [
    { i: '📦', t: 'Add your stock', d: 'Open <b>Stock</b> → <b>+ Add</b>. Type the name, price, quantity. Tap <b>−</b> when you sell one, <b>+</b> when stock arrives. Tap a row to see full details.' },
    { i: '🔖', t: 'Item number & barcode', d: 'Give each item your own <b>Item number</b> (or tap Generate). If a product has a printed <b>barcode</b>, scan it into the item — then the camera finds it instantly.' },
    { i: '🧾', t: 'Make a bill', d: 'Open <b>Bill</b>. Search, scan, tap a favourite, or use 🎤 voice to add items. Pick <b>Cash / UPI / Udhaar / Split</b>, then <b>Generate bill</b> — stock drops automatically and a receipt opens.' },
    { i: '📲', t: 'Give the receipt', d: 'On the receipt: <b>Print</b>, <b>Share image</b> (WhatsApp), or 🖨️ a Bluetooth printer. If you set a UPI ID, a <b>Pay</b> button shows for the customer.' },
    { i: '📒', t: 'Khata (udhaar)', d: 'Choose <b>Udhaar</b> on a bill to record credit. In <b>More → Khata</b> see who owes you and tap <b>Remind</b> to message them on WhatsApp.' },
    { i: '📝', t: 'Re-order stock', d: 'Low items appear in <b>To Order</b> automatically with a suggested quantity. Tap <b>Send list</b> to WhatsApp your wholesaler. Tick items when they arrive to restock.' },
    { i: '📊', t: 'See your profit', d: '<b>More → Reports</b> shows today/week/month sales, profit, best-sellers and dead stock. Log rent/salary in <b>Expenses</b> for true net profit.' },
    { i: '☁️', t: 'Keep data safe', d: 'Everything works offline. <b>Sign in with Google</b> in More to auto-backup, so your data is safe and follows you to a new phone.' },
    { i: '🌐', t: 'Language & lock', d: 'Change language in <b>More → Language</b>. Set a <b>PIN</b> and turn on <b>cashier mode</b> so staff can bill but not see reports or change prices.' }
  ];
  function openHelp() {
    $('#helpContent').innerHTML = TUTORIAL.map((s, n) => `
      <div class="help-step">
        <div class="help-ic">${s.i}</div>
        <div><b>${n + 1}. ${s.t}</b><p>${s.d}</p></div>
      </div>`).join('');
    $('#helpDialog').showModal();
  }
  $('#helpBtn').addEventListener('click', openHelp);
  $('#helpCloseBtn').addEventListener('click', () => $('#helpDialog').close());
  $('#obHelp').addEventListener('click', openHelp);

  // ---------- Admin remote access control (kill switch) ----------
  async function getDeviceId() {
    let id = await DB.getMeta('deviceId', '');
    if (!id) {
      id = 'D-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
      await DB.setMeta('deviceId', id);
    }
    return id;
  }
  function lockRevoked(msg) {
    if (msg) $('#revokedMsg').textContent = msg;
    $('#revokedScreen').classList.remove('hidden');
  }
  async function enforceAccess() {
    if (!Flags.on('accessControl')) return;
    const url = (CONFIG && CONFIG.accessListUrl) || await DB.getMeta('accessListUrl', '');
    // Already revoked locally → stay locked even offline.
    if (await DB.getMeta('revoked', false)) { lockRevoked(await DB.getMeta('revokedMsg', '')); return; }
    if (!url || !navigator.onLine) return;   // can't check offline → fail open (offline-first)
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const list = await res.json();
      const deviceId = await getDeviceId();
      const shopCode = await DB.getMeta('fbShopCode', '');
      const blocked = list.killAll === true
        || (Array.isArray(list.blocked) && (list.blocked.includes(deviceId) || (shopCode && list.blocked.includes(shopCode))));
      if (blocked) {
        await DB.setMeta('revoked', true);
        await DB.setMeta('revokedMsg', list.message || '');
        lockRevoked(list.message || '');
      } else if (await DB.getMeta('revoked', false)) {
        await DB.setMeta('revoked', false);   // admin re-enabled this device
      }
    } catch (_) { /* network/parse error → fail open, app keeps working */ }
  }

  // ---------- Park / hold bills ----------
  let parked = [];
  async function loadParked() { parked = await DB.getMeta('parkedBills', []); renderParked(); }
  function renderParked() {
    const box = $('#parkedBills');
    box.classList.toggle('hidden', !parked.length);
    box.innerHTML = parked.map((p, i) =>
      `<button class="btn ghost small" data-park="${i}">🧾 ${p.cart.length} items · ${money(p.total)}</button>`).join('');
  }
  $('#parkBillBtn').addEventListener('click', async () => {
    if (!cart.length) return toast('Cart is empty');
    parked.push({ cart: cart.slice(), total: cartTotals().total, ts: Date.now() });
    await DB.setMeta('parkedBills', parked);
    cart = []; renderCart(); renderParked();
    toast('Bill held');
  });
  $('#parkedBills').addEventListener('click', async (e) => {
    const i = e.target.dataset.park; if (i == null) return;
    const p = parked.splice(Number(i), 1)[0];
    if (p) { cart = p.cart; renderCart(); }
    await DB.setMeta('parkedBills', parked); renderParked();
  });

  // ---------- Returns / refunds ----------
  async function renderReturns(q) {
    const sales = (await DB.allSales()).filter((s) => !s.refund);
    const list = q ? sales.filter((s) => String(s.invoiceNo).toLowerCase().includes(q) || (s.party && (s.party.name || '').toLowerCase().includes(q))) : sales.slice(0, 30);
    $('#returnsList').innerHTML = list.map((s) =>
      `<li><span>${escapeHtml(String(s.invoiceNo))} · ${new Date(s.createdAt).toLocaleDateString()}</span><b>${money(s.total)}</b><button class="btn ghost small doReturn" data-id="${s.id}">Refund</button></li>`).join('')
      || '<li class="muted">No bills.</li>';
  }
  $('#openReturnsBtn').addEventListener('click', async () => { await renderReturns(''); $('#returnsDialog').showModal(); });
  $('#returnsCloseBtn').addEventListener('click', () => $('#returnsDialog').close());
  $('#returnSearch').addEventListener('input', (e) => renderReturns(e.target.value.trim().toLowerCase()));
  $('#returnsList').addEventListener('click', async (e) => {
    if (!e.target.classList.contains('doReturn')) return;
    const sales = await DB.allSales();
    const orig = sales.find((s) => s.id === e.target.dataset.id);
    if (!orig) return;
    if (!confirm('Refund ' + orig.invoiceNo + ' for ' + money(orig.total) + '? Items go back to stock.')) return;
    // Restock and record a refund (credit note) as a negative sale.
    for (const l of orig.lines) {
      const it = items.find((x) => x.name === l.name);
      if (it) { it.quantity += l.qty; await DB.saveItem(it); }
    }
    await DB.saveSale({
      invoiceNo: 'CN/' + String(orig.invoiceNo), refund: true, refundOf: orig.invoiceNo,
      type: orig.type, party: orig.party, payMethod: orig.payMethod,
      lines: orig.lines.map((l) => ({ ...l, total: -Math.abs(l.total) })),
      subtotal: -orig.subtotal, discount: 0, taxRate: orig.taxRate, tax: -(orig.tax || 0),
      roundOff: 0, total: -orig.total, createdAt: Date.now()
    });
    await reload(); await renderReturns(''); scheduleBackup();
    toast('Refunded ' + orig.invoiceNo);
  });

  // ---------- Stock adjustment ----------
  let adjItem = null;
  $('#openAdjustBtn').addEventListener('click', async () => { adjItem = null; $('#adjustForm').classList.add('hidden'); await renderAdjustLog(); $('#adjustDialog').showModal(); });
  $('#adjustCloseBtn').addEventListener('click', () => $('#adjustDialog').close());
  $('#adjustSearch').addEventListener('input', () => {
    const q = $('#adjustSearch').value.trim().toLowerCase();
    const box = $('#adjustSuggest');
    if (!q) { box.classList.add('hidden'); return; }
    const matches = items.filter((it) => it.name.toLowerCase().includes(q)).slice(0, 8);
    box.innerHTML = matches.map((it) => `<li data-id="${it.id}">${escapeHtml(it.name)} <span class="muted">${it.quantity} ${escapeHtml(it.unit || '')}</span></li>`).join('');
    box.classList.toggle('hidden', !matches.length);
  });
  $('#adjustSuggest').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]'); if (!li) return;
    adjItem = items.find((x) => x.id === li.dataset.id);
    $('#adjustName').textContent = adjItem.name;
    $('#adjustCur').textContent = adjItem.quantity + ' ' + (adjItem.unit || '');
    $('#adjustQty').value = ''; $('#adjustForm').classList.remove('hidden');
    $('#adjustSearch').value = ''; $('#adjustSuggest').classList.add('hidden');
  });
  $('#adjustSaveBtn').addEventListener('click', async () => {
    if (!adjItem) return;
    const delta = Number($('#adjustQty').value);
    if (!delta) return toast('Enter a +/− amount');
    adjItem.quantity = Math.max(adjItem.quantity + delta, 0);
    await DB.saveItem(adjItem);
    const log = await DB.getMeta('adjustments', []);
    log.unshift({ name: adjItem.name, delta, reason: $('#adjustReason').value, ts: Date.now() });
    await DB.setMeta('adjustments', log.slice(0, 200));
    adjItem = null; $('#adjustForm').classList.add('hidden');
    await reload(); await renderAdjustLog(); scheduleBackup();
    toast('Stock adjusted');
  });
  async function renderAdjustLog() {
    const log = await DB.getMeta('adjustments', []);
    $('#adjustLog').innerHTML = log.slice(0, 20).map((a) =>
      `<li><span>${escapeHtml(a.name)} · ${a.reason}</span><b>${a.delta > 0 ? '+' : ''}${a.delta}</b></li>`).join('') || '<li class="muted">No adjustments.</li>';
  }

  // ---------- GSTR-ready export (B2B tax summary) ----------
  async function exportGSTR() {
    const sales = (await DB.allSales()).filter((s) => !s.refund);
    const rows = [['Invoice', 'Date', 'GSTIN', 'HSN', 'Taxable', 'GST%', 'CGST', 'SGST', 'Total']];
    sales.forEach((s) => s.lines.forEach((l) => {
      const taxable = l.total / (1 + ((l.gstRate || 0) / 100));
      const gst = l.total - taxable;
      rows.push([s.invoiceNo, new Date(s.createdAt).toLocaleDateString(), (s.party && s.party.gst) || '',
        l.hsn || '', taxable.toFixed(2), l.gstRate || 0, (gst / 2).toFixed(2), (gst / 2).toFixed(2), l.total.toFixed(2)]);
    }));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'gstr.csv'; a.click();
    URL.revokeObjectURL(a.href); toast('GSTR CSV exported');
  }

  // ====================================================================
  //  Receivables, partial payments, quotations, statements, challan, expenses
  // ====================================================================
  const outstanding = (s) => (s.refund ? 0 : Math.max((s.total || 0) - (s.paid || 0), 0));

  // ---------- Per-invoice payments ----------
  let payTarget = null;
  function openPayDialog(sale) {
    payTarget = sale;
    $('#payInfo').textContent = sale.invoiceNo + ' · total ' + money(sale.total) + ' · due ' + money(outstanding(sale));
    $('#payAmount').value = outstanding(sale).toFixed(2);
    $('#payDialog').showModal();
  }
  $('#payCancelBtn').addEventListener('click', () => $('#payDialog').close());
  $('#payConfirmBtn').addEventListener('click', async () => {
    if (!payTarget) return;
    const amt = Number($('#payAmount').value) || 0;
    if (amt <= 0) return;
    payTarget.paid = +((payTarget.paid || 0) + amt).toFixed(2);
    payTarget.payments = payTarget.payments || [];
    payTarget.payments.push({ amt, method: 'manual', ts: Date.now() });
    if (payTarget.paid >= payTarget.total) payTarget.unpaid = false;
    await DB.saveSale(payTarget);
    // Reflect in Khata so the customer's balance drops too.
    if (payTarget.party && payTarget.party.name) {
      await DB.saveKhata({ customer: { name: payTarget.party.name, phone: payTarget.party.phone || '' },
        amount: amt, kind: 'paid', note: 'Payment ' + payTarget.invoiceNo, createdAt: Date.now() });
    }
    $('#payDialog').close();
    await renderKhata(); await renderReceivables(); scheduleBackup();
    toast('Payment recorded');
  });

  // ---------- Receivables + aging ----------
  async function renderReceivables() {
    const sales = await DB.allSales();
    const open = sales.filter((s) => outstanding(s) > 0);
    const totalDue = open.reduce((a, s) => a + outstanding(s), 0);
    $('#hubReceivable').textContent = money(totalDue);
    const now = Date.now();
    const bucket = { cur: 0, b30: 0, b60: 0, b90: 0 };
    open.forEach((s) => {
      const age = (now - (s.createdAt || now)) / 86400000;
      if (age <= 30) bucket.cur += outstanding(s);
      else if (age <= 60) bucket.b30 += outstanding(s);
      else if (age <= 90) bucket.b60 += outstanding(s);
      else bucket.b90 += outstanding(s);
    });
    const rows = open.sort((a, b) => a.createdAt - b.createdAt).map((s) => {
      const overdue = s.due && now > s.due;
      return `<li><span>${escapeHtml(String(s.invoiceNo))} · ${escapeHtml((s.party && s.party.name) || '-')}${overdue ? ' · <b class="exp expired">overdue</b>' : ''}</span><b>${money(outstanding(s))}</b><button class="btn ghost small payBtn" data-id="${s.id}">Pay</button></li>`;
    }).join('') || '<li class="muted">Nothing outstanding 🎉</li>';
    $('#receivablesContent').innerHTML = `
      <div class="rep-grid">
        <div class="rep-card"><span>0–30d</span><b>${money(bucket.cur)}</b></div>
        <div class="rep-card"><span>30–60d</span><b>${money(bucket.b30)}</b></div>
        <div class="rep-card"><span>60–90d</span><b>${money(bucket.b60)}</b></div>
        <div class="rep-card"><span>90d+</span><b>${money(bucket.b90)}</b></div>
      </div>
      <h4>Open invoices · total ${money(totalDue)}</h4>
      <ul class="sales-list">${rows}</ul>`;
  }
  $('#openReceivablesBtn').addEventListener('click', async () => { await renderReceivables(); $('#receivablesDialog').showModal(); });
  $('#receivablesCloseBtn').addEventListener('click', () => $('#receivablesDialog').close());
  $('#receivablesContent').addEventListener('click', async (e) => {
    if (!e.target.classList.contains('payBtn')) return;
    const sales = await DB.allSales();
    const sale = sales.find((s) => s.id === e.target.dataset.id);
    if (sale) openPayDialog(sale);
  });

  // ---------- Quotations ----------
  $('#saveQuoteBtn').addEventListener('click', async () => {
    if (!cart.length) return toast('Cart is empty');
    const tot = cartTotals();
    await DB.saveQuote({
      party: billType() === 'b2b' ? { name: $('#p_name').value.trim(), phone: $('#p_phone').value.trim() } : null,
      lines: cart.map((l) => ({ id: l.id, name: l.name, price: l.price, qty: l.qty, unit: l.unit, cost: l.cost || 0 })),
      total: tot.total, createdAt: Date.now()
    });
    toast('Saved as quotation');
  });
  async function renderQuotes() {
    const quotes = await DB.allQuotes();
    $('#quotesList').innerHTML = quotes.map((q) =>
      `<li><span>${new Date(q.createdAt).toLocaleDateString()} · ${escapeHtml((q.party && q.party.name) || 'Quote')} · ${q.lines.length} items</span><b>${money(q.total)}</b><button class="btn ghost small toBill" data-id="${q.id}">Make bill</button></li>`).join('')
      || '<li class="muted">No quotations.</li>';
  }
  $('#openQuotesBtn').addEventListener('click', async () => { await renderQuotes(); $('#quotesDialog').showModal(); });
  $('#quotesCloseBtn').addEventListener('click', () => $('#quotesDialog').close());
  $('#quotesList').addEventListener('click', async (e) => {
    if (!e.target.classList.contains('toBill')) return;
    const quotes = await DB.allQuotes();
    const q = quotes.find((x) => x.id === e.target.dataset.id);
    if (!q) return;
    cart = q.lines.map((l) => ({ id: l.id, name: l.name, price: l.price, basePrice: l.price, qty: l.qty, unit: l.unit, cost: l.cost || 0 }));
    await DB.deleteQuote(q.id);
    $('#quotesDialog').close();
    showView('bill'); renderCart();
    toast('Quotation loaded into cart');
  });

  // ---------- Customer statement (shareable) ----------
  async function shareStatement(name, phone) {
    const sales = (await DB.allSales()).filter((s) => s.party && s.party.name === name);
    let s = `*${shop.name}* — Statement for ${name}\n`;
    let bal = 0;
    sales.sort((a, b) => a.createdAt - b.createdAt).forEach((x) => {
      s += `${new Date(x.createdAt).toLocaleDateString()} ${x.invoiceNo}: ${money(x.total)} (paid ${money(x.paid || 0)})\n`;
      bal += outstanding(x);
    });
    s += `\nOutstanding: ${money(bal)}`;
    if (navigator.share) { try { await navigator.share({ text: s }); return; } catch (_) {} }
    try { await navigator.clipboard.writeText(s); toast('Statement copied'); } catch (_) { toast('Statement ready'); }
  }

  // ---------- Delivery challan (print goods list, no prices) ----------
  $('#receiptChallanBtn').addEventListener('click', () => {
    if (!lastSale) return;
    const rows = lastSale.lines.map((l) => `<tr><td>${escapeHtml(l.name)}</td><td style="text-align:right">${l.qty} ${escapeHtml(l.unit || '')}</td></tr>`).join('');
    const css = `body{font-family:sans-serif;padding:16px}h2{margin:0}table{width:100%;border-collapse:collapse;margin-top:10px}td,th{border-bottom:1px solid #ccc;padding:6px;text-align:left}`;
    printHtml(`<h2>${escapeHtml(shop.name)}</h2><div>Delivery Challan · ${escapeHtml(String(lastSale.invoiceNo))}</div>
      <div>${new Date(lastSale.createdAt).toLocaleString()}</div>
      ${lastSale.party ? `<div>To: <b>${escapeHtml(lastSale.party.name || '')}</b></div>` : ''}
      <table><thead><tr><th>Item</th><th style="text-align:right">Qty</th></tr></thead><tbody>${rows}</tbody></table>
      <p style="margin-top:24px">Received in good condition: ____________________</p>`, css);
  });

  // ---------- Expenses ----------
  $('#saveExpenseBtn').addEventListener('click', async () => {
    const amount = Number($('#expAmount').value) || 0;
    if (amount <= 0) return toast('Enter an amount');
    await DB.saveExpense({ amount, category: $('#expCategory').value, note: $('#expNote').value.trim(), createdAt: Date.now() });
    $('#expAmount').value = ''; $('#expNote').value = '';
    await renderExpenses(); scheduleBackup();
    toast('Expense saved');
  });
  async function renderExpenses() {
    const ex = await DB.allExpenses();
    $('#expensesList').innerHTML = ex.slice(0, 30).map((x) =>
      `<li><span>${new Date(x.createdAt).toLocaleDateString()} · ${escapeHtml(x.category)}${x.note ? ' · ' + escapeHtml(x.note) : ''}</span><b>${money(x.amount)}</b></li>`).join('')
      || '<li class="muted">No expenses logged.</li>';
  }
  $('#openExpensesBtn').addEventListener('click', async () => { await renderExpenses(); $('#expensesDialog').showModal(); });
  $('#expensesCloseBtn').addEventListener('click', () => $('#expensesDialog').close());

  // ---------- Theme ----------
  function applyTheme(dark, large) {
    document.documentElement.classList.toggle('dark', !!dark);
    document.documentElement.classList.toggle('large', !!large);
  }
  $('#darkToggle').addEventListener('change', async (e) => { await DB.setMeta('dark', e.target.checked); applyTheme(e.target.checked, $('#largeToggle').checked); });
  $('#largeToggle').addEventListener('change', async (e) => { await DB.setMeta('large', e.target.checked); applyTheme($('#darkToggle').checked, e.target.checked); });

  // ---------- PIN lock ----------
  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  $('#savePinBtn').addEventListener('click', async () => {
    const pin = $('#pinInput').value.trim();
    if (pin && !/^\d{4,6}$/.test(pin)) return toast('PIN must be 4–6 digits');
    await DB.setMeta('pinHash', pin ? await sha256(pin) : '');
    $('#pinInput').value = '';
    toast(pin ? 'PIN set' : 'PIN removed');
  });
  async function maybeLock() {
    const hash = await DB.getMeta('pinHash', '');
    if (!hash) return;
    $('#lockScreen').classList.remove('hidden');
    const input = $('#lockPin');
    input.value = ''; input.focus();
    input.oninput = async () => {
      if (input.value.length < 4) { $('#lockError').textContent = ''; return; }
      if (await sha256(input.value) === hash) {
        $('#lockScreen').classList.add('hidden');
      } else if (input.value.length >= 6) {
        $('#lockError').textContent = 'Wrong PIN'; input.value = '';
      }
    };
  }

  // ---------- Customer purchase history (from a Khata customer) ----------
  async function customerHistory(name, phone) {
    const sales = await DB.allSales();
    const mine = sales.filter((s) => s.party && s.party.name === name && (!phone || s.party.phone === phone));
    if (!mine.length) { toast('No bills found for ' + name); return; }
    const last = mine[0];
    const lines = mine.slice(0, 10).map((s) => `<li><span>#${s.invoiceNo} · ${new Date(s.createdAt).toLocaleDateString()}</span><b>${money(s.total)}</b></li>`).join('');
    $('#detailContent').innerHTML = `
      <h3>${escapeHtml(name)}</h3>
      <ul class="best-list">${lines}</ul>
      <div class="dialog-actions">
        <button class="btn ghost" data-act="close">${t('close')}</button>
        <span class="spacer"></span>
        <button class="btn" data-act="statement">📄 Statement</button>
        <button class="btn primary" data-act="repeat">Repeat last order</button>
      </div>`;
    const dlg = $('#detailDialog');
    dlg.onclick = (e) => {
      if (e.target.dataset.act === 'close') dlg.close();
      else if (e.target.dataset.act === 'statement') shareStatement(name, phone);
      else if (e.target.dataset.act === 'repeat') {
        cart = last.lines.map((l) => { const it = items.find((x) => x.name === l.name); return { id: it ? it.id : DB.uid(), name: l.name, price: l.price, cost: l.cost || 0, qty: l.qty, unit: l.unit }; });
        dlg.close(); showView('bill'); renderCart();
        toast('Loaded last order into cart');
      }
    };
    dlg.showModal();
  }

  // ---------- Send low-stock list to wholesaler ----------
  $('#sendWholesalerBtn').addEventListener('click', async () => {
    const toOrder = items.filter((it) => isLow(it) || it.toOrder);
    if (!toOrder.length) return toast('Nothing to order');
    let msg = `*${shop.name}* — order list:\n`;
    toOrder.forEach((it) => {
      msg += `• ${it.name} — ${it.orderQty || suggestOrderQty(it)} ${it.unit || 'pcs'}\n`;
    });
    if (navigator.share) { try { await navigator.share({ text: msg }); return; } catch (_) {} }
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  });

  // ---------- File export / import ----------
  $('#exportBtn').addEventListener('click', async () => {
    const payload = await buildPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'look-inventory-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Backup file downloaded');
  });

  $('#importBtn').addEventListener('click', () => $('#importInput').click());
  $('#importInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.items) throw new Error('Not a valid backup file');
      await applyPayload(data);
      await reload();
      toast('Imported ' + data.items.length + ' items');
    } catch (err) {
      toast('Import failed: ' + err.message);
    }
    e.target.value = '';
  });

  // ---------- Google Drive sign-in (one tap) ----------
  const gClientId = $('#gClientId');
  gClientId.addEventListener('change', () => DB.setMeta('gClientId', gClientId.value.trim()));

  function setSync(state, text) {
    const el = $('#syncStatus');
    el.className = 'sync-status ' + state;
    el.textContent = text;
  }

  // App-level Client ID (set once by developer in config.js) wins; else user/manual.
  async function effectiveClientId() {
    return (CONFIG && CONFIG.googleClientId) || gClientId.value.trim() || await DB.getMeta('gClientId', '');
  }

  // Shared sign-in used by both onboarding and Settings. Auto-restores on a fresh device.
  async function googleSignIn() {
    const cid = await effectiveClientId();
    if (!cid) throw new Error('Google sign-in not configured (set CONFIG.googleClientId).');
    await Sync.signIn(cid);
    $('#gBackupBtn').disabled = false;
    $('#gRestoreBtn').disabled = false;
    setSync('online', 'Online · Drive ready');
    // If this device has only sample/empty data but Drive has a backup, pull it in.
    try {
      const cloudData = await Sync.restore();
      const localCount = (await DB.allItems()).length;
      if (cloudData && cloudData.items && cloudData.items.length && localCount <= 3) {
        await applyPayload(cloudData);
        await reload();
        toast('Restored your data from Google');
      }
    } catch (_) {}
    scheduleBackup();
    return true;
  }

  $('#gSignInBtn').addEventListener('click', async () => {
    try {
      $('#gStatus').textContent = 'Opening Google sign-in…';
      await googleSignIn();
      $('#gStatus').textContent = 'Signed in ✓ · auto-backup on';
      renderChecklist();
    } catch (err) {
      $('#gStatus').textContent = err.message;
    }
  });

  $('#gBackupBtn').addEventListener('click', async () => {
    try {
      $('#gStatus').textContent = 'Backing up…';
      await Sync.backup(await buildPayload());
      $('#gStatus').textContent = 'Backed up to Drive ✓';
      setSync('online', 'Online · backed up');
      toast('Backed up to Google Drive');
    } catch (err) {
      $('#gStatus').textContent = err.message;
    }
  });

  $('#gRestoreBtn').addEventListener('click', async () => {
    try {
      $('#gStatus').textContent = 'Restoring…';
      const data = await Sync.restore();
      if (!data) { $('#gStatus').textContent = 'No backup found in Drive.'; return; }
      await applyPayload(data);
      await reload();
      $('#gStatus').textContent = 'Restored ✓';
      toast('Restored from Google Drive');
    } catch (err) {
      $('#gStatus').textContent = err.message;
    }
  });

  // ---------- Install to home screen ----------
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    $('#obInstall').classList.remove('hidden');
  });
  async function doInstall() {
    if (!deferredInstall) { toast('Use browser menu → "Add to Home screen"'); return; }
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    $('#obInstall').classList.add('hidden');
  }
  $('#obInstall').addEventListener('click', doInstall);

  // ---------- First-run setup wizard ----------
  let obStep = 1;
  const OB_STEPS = 5;
  function showStep(n) {
    obStep = Math.max(1, Math.min(n, OB_STEPS));
    $$('.onboard-step').forEach((el) => el.classList.toggle('hidden', Number(el.dataset.step) !== obStep));
    $$('.ob-progress span').forEach((s, i) => s.classList.toggle('on', i < obStep));
  }
  function openOnboarding() {
    // Populate language choices, prefill any known values.
    const sel = $('#obLang');
    sel.innerHTML = Object.keys(I18N.names).map((k) => `<option value="${k}">${I18N.names[k]}</option>`).join('');
    sel.value = I18N.lang;
    $('#obName').value = shop.name && shop.name !== 'My Shop' ? shop.name : '';
    $('#obPhone').value = shop.phone || '';
    $('#obAddr').value = shop.address || '';
    $('#obUpi').value = shop.upi || '';
    showStep(1);
    $('#onboard').classList.remove('hidden');
  }
  $('#obLang').addEventListener('change', async (e) => {
    I18N.setLang(e.target.value); await DB.setMeta('lang', e.target.value); I18N.apply();
    buildLangSelect();
  });
  document.querySelectorAll('.ob-next').forEach((b) => b.addEventListener('click', () => showStep(obStep + 1)));
  document.querySelectorAll('.ob-back').forEach((b) => b.addEventListener('click', () => showStep(obStep - 1)));
  $('#obUpiQr').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    shop.upiQr = await compressImage(f, 300); await DB.setMeta('shopUpiQr', shop.upiQr);
  });
  $('#obGoogle').addEventListener('click', async () => {
    $('#obGoogleStatus').textContent = 'Opening Google…';
    try { await googleSignIn(); $('#obGoogleStatus').textContent = 'Signed in ✓ — backup & sync on'; }
    catch (err) { $('#obGoogleStatus').textContent = err.message; }
  });
  $('#obSkip').addEventListener('click', async () => { await finishOnboarding(false); });
  document.querySelector('.ob-finish').addEventListener('click', () => finishOnboarding(true));

  async function finishOnboarding(save) {
    if (save) {
      const name = $('#obName').value.trim() || 'My Shop';
      shop.name = name; await DB.setMeta('shopName', name); $('#shopName').textContent = name;
      shop.phone = $('#obPhone').value.trim(); await DB.setMeta('shopPhone', shop.phone);
      shop.address = $('#obAddr').value.trim(); await DB.setMeta('shopAddress', shop.address);
      shop.upi = $('#obUpi').value.trim(); await DB.setMeta('shopUpi', shop.upi);
      if ($('#obClear').checked) {
        // Remove the 3 seeded sample items if still present and untouched.
        const samples = ['Parle-G Biscuit', 'Tata Salt 1kg', 'Amul Milk 500ml'];
        for (const it of items.filter((x) => samples.includes(x.name))) await DB.deleteItem(it.id);
      }
      // reflect into Settings fields
      $('#shopNameInput').value = shop.name; $('#shopPhoneInput').value = shop.phone;
      $('#shopAddressInput').value = shop.address; $('#shopUpiInput').value = shop.upi;
      await reload();
    }
    await DB.setMeta('onboarded', true);
    $('#onboard').classList.add('hidden');
    renderChecklist();
  }

  // ---------- Setup checklist (More) ----------
  async function renderChecklist() {
    const hasName = shop.name && shop.name !== 'My Shop';
    const hasUpi = !!(shop.upi || shop.upiQr);
    const hasBackup = Sync.isSignedIn() || Cloud.isReady() || !!(await DB.getMeta('lastBackup', 0));
    const hasPin = !!(await DB.getMeta('pinHash', ''));
    const row = (ok, label) => `<li class="${ok ? 'done' : ''}">${ok ? '✅' : '⬜'} ${label}</li>`;
    const done = [hasName, hasUpi, hasBackup].filter(Boolean).length;
    $('#setupChecklist').innerHTML = `
      <h3>🚀 Setup ${done >= 3 ? '· complete' : '(' + done + '/3)'}</h3>
      <ul class="check-list">
        ${row(hasName, 'Shop name')}
        ${row(hasUpi, 'UPI payments')}
        ${row(hasBackup, 'Backup / sign in with Google')}
        ${row(hasPin, 'App PIN (optional)')}
      </ul>
      <button id="rerunSetupBtn" class="btn ghost full">Run setup again</button>`;
    $('#rerunSetupBtn').addEventListener('click', openOnboarding);
  }

  // ---------- Data durability ----------
  // Ask the browser to keep our data even under storage pressure (prevents auto-eviction).
  async function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        const already = await navigator.storage.persisted();
        const granted = already || await navigator.storage.persist();
        const note = $('#storageNote');
        if (note) note.textContent = granted
          ? '🔒 Storage is protected on this device.'
          : '⚠️ Add to Home screen and set up a backup — storage may be cleared otherwise.';
      }
    } catch (_) {}
  }

  // Auto-sync (debounced) after any data change: Google Drive backup + Firebase live push.
  let backupTimer = null;
  function scheduleBackup() {
    if (!Sync.isSignedIn() && !Cloud.isReady()) return;
    clearTimeout(backupTimer);
    backupTimer = setTimeout(async () => {
      const payload = await buildPayload();
      if (Sync.isSignedIn()) {
        try { await Sync.backup(payload); await DB.setMeta('lastBackup', Date.now()); setSync('online', 'Online · auto-backed up'); } catch (_) {}
      }
      if (Cloud.isReady()) {
        try { await Cloud.push(payload); } catch (_) {}
      }
    }, 3000);
  }

  // Apply data pushed from another device via Firebase.
  async function onCloudRemote(payload) {
    await applyPayload(payload);
    await reload();
    await renderBill();
    await renderKhata();
    toast('Synced from another device');
  }

  $('#fbConnectBtn').addEventListener('click', async () => {
    const cfg = $('#fbConfig').value.trim();
    const code = $('#fbShopCode').value.trim();
    if (!cfg || !code) return toast('Enter Firebase config and shop code');
    $('#fbStatus').textContent = 'Connecting…';
    try {
      await Cloud.connect(cfg, code, onCloudRemote);
      await DB.setMeta('fbConfig', cfg);
      await DB.setMeta('fbShopCode', code);
      await Cloud.push(await buildPayload());   // seed the cloud with current data
      $('#fbStatus').textContent = '🔥 Live sync connected ✓';
      setSync('online', 'Online · live sync');
      toast('Live sync connected');
    } catch (err) {
      $('#fbStatus').textContent = 'Failed: ' + err.message;
    }
  });

  // ---------- Licensing: trial → paid (48h offline lease) ----------
  function showLicense(title, msg, opts) {
    opts = opts || {};
    $('#licenseTitle').textContent = title;
    $('#licenseMsg').textContent = msg;
    const sub = $('#subscribeBtn');
    if (CONFIG.subscribeUrl) { sub.href = CONFIG.subscribeUrl; sub.classList.remove('hidden'); }
    else sub.classList.add('hidden');
    $('#licenseScreen').classList.remove('hidden');
  }
  function hideLicense() { $('#licenseScreen').classList.add('hidden'); }
  function showTrialBanner(days) {
    const b = $('#trialBanner');
    b.textContent = `🎁 Trial — ${days} day${days === 1 ? '' : 's'} left. Tap to subscribe.`;
    b.classList.remove('hidden');
    b.onclick = () => { if (CONFIG.subscribeUrl) window.open(CONFIG.subscribeUrl, '_blank'); };
  }

  async function enforceLicense() {
    if (!Flags.on('licensing') || !License.configured()) return true;   // free app
    let trialStart = await DB.getMeta('trialStart', 0);
    if (!trialStart) { trialStart = Date.now(); await DB.setMeta('trialStart', trialStart); }
    let token = await DB.getMeta('licenseToken', '');
    const deviceId = await getDeviceId();
    const shop = await DB.getMeta('fbShopCode', '');

    let res = await License.evaluate({ token, trialStart, now: Date.now(), online: navigator.onLine });

    // Try to refresh the token when online (covers: just paid, lease expired, trial→paid).
    if (navigator.onLine && (res.state === 'lease_expired' || res.state === 'expired' || res.state === 'trial')) {
      try {
        const fresh = await License.renew(deviceId, shop);
        if (await License.verify(fresh)) {
          token = fresh; await DB.setMeta('licenseToken', fresh);
          res = await License.evaluate({ token, trialStart, now: Date.now(), online: true });
        }
      } catch (_) { /* offline or not licensed yet → keep current state */ }
    }

    hideLicense(); $('#trialBanner').classList.add('hidden');
    if (res.state === 'active' || res.state === 'off') return true;
    if (res.state === 'trial') { showTrialBanner(res.daysLeft); return true; }
    if (res.state === 'lease_expired') {
      showLicense('Please reconnect', 'Connect to the internet once to verify your subscription, then continue.');
      return false;
    }
    // expired / no trial left
    showLicense(t('sub_needed') || 'Subscription needed',
      (res.msg || 'Your free trial has ended. Subscribe to keep using the app.'));
    return false;
  }

  $('#licenseRetryBtn').addEventListener('click', async () => {
    $('#licenseRetryBtn').textContent = 'Checking…';
    await enforceLicense();
    $('#licenseRetryBtn').textContent = "I've paid · Retry";
  });

  // ---------- Online/offline indicator ----------
  function updateNetwork() {
    if (navigator.onLine) {
      const live = Cloud.isReady();
      setSync(live || Sync.isSignedIn() ? 'online' : 'idle',
        live ? 'Online · live sync' : (Sync.isSignedIn() ? 'Online · Drive ready' : 'Online · sign in to back up'));
    } else {
      setSync('offline', 'Offline · saved on phone');
    }
  }
  window.addEventListener('offline', updateNetwork);
  // When internet returns: reconnect live sync if configured, flush a backup, re-arm Firebase.
  window.addEventListener('online', async () => {
    updateNetwork();
    enforceAccess();    // re-check kill switch as soon as we're back online
    enforceLicense();   // renew the offline lease while we have a connection
    if (!Cloud.isReady()) {
      const cfg = await DB.getMeta('fbConfig', '') || (CONFIG && CONFIG.firebase ? JSON.stringify(CONFIG.firebase) : '');
      const code = await DB.getMeta('fbShopCode', '');
      if (cfg && code) {
        Cloud.connect(cfg, code, onCloudRemote).then(updateNetwork).catch(() => {});
      }
    }
    scheduleBackup();   // push anything that changed while offline
  });

  // ---------- Seed sample data on first run ----------
  async function seedIfEmpty() {
    const existing = await DB.allItems();
    if (existing.length) return;
    const samples = [
      { name: 'Parle-G Biscuit', barcode: '8901719101234', price: 10, cost: 8, quantity: 24, unit: 'pkt', category: 'Snacks', reorder: 6 },
      { name: 'Tata Salt 1kg', barcode: '8901030865278', price: 28, cost: 24, quantity: 4, unit: 'pkt', category: 'Grocery', reorder: 5 },
      { name: 'Amul Milk 500ml', barcode: '8901262010016', price: 27, cost: 24, quantity: 10, unit: 'pkt', category: 'Dairy', reorder: 8 }
    ];
    for (const s of samples) await DB.saveItem(s);
  }

  // ---------- Init ----------
  async function init() {
    await maybeLock();    // show PIN screen first if one is set

    Flags.init(await DB.getMeta('flagOverrides', {}));
    await enforceAccess();   // admin kill-switch — locks revoked devices
    await enforceLicense();  // trial / subscription gate (inert unless configured)
    $('#deviceIdLabel').textContent = await getDeviceId();
    applyFlags();
    renderFeatures();
    await loadParked();
    if (await DB.getMeta('cashier', false)) applyCashier(true);

    I18N.setLang(await DB.getMeta('lang', 'en'));
    buildLangSelect();
    I18N.apply();

    const dark = await DB.getMeta('dark', false);
    const large = await DB.getMeta('large', false);
    $('#darkToggle').checked = dark;
    $('#largeToggle').checked = large;
    applyTheme(dark, large);

    shop.name = await DB.getMeta('shopName', 'My Shop');
    shop.phone = await DB.getMeta('shopPhone', '');
    shop.address = await DB.getMeta('shopAddress', '');
    shop.gst = await DB.getMeta('shopGst', '');
    shop.upi = await DB.getMeta('shopUpi', '');
    shop.upiQr = await DB.getMeta('shopUpiQr', '');
    taxRate = Number(await DB.getMeta('taxRate', 0)) || 0;

    $('#shopName').textContent = shop.name;
    shopInput.value = shop.name;
    $('#shopPhoneInput').value = shop.phone;
    $('#shopAddressInput').value = shop.address;
    $('#shopGstInput').value = shop.gst;
    $('#shopUpiInput').value = shop.upi;
    $('#taxRateInput').value = taxRate;
    $('#creditTermsInput').value = await DB.getMeta('creditTerms', 0);
    if (shop.upiQr) { const p = $('#upiQrPreview'); p.src = shop.upiQr; p.classList.remove('hidden'); }

    const savedClientId = await DB.getMeta('gClientId', '');
    if (savedClientId) gClientId.value = savedClientId;
    // If the developer baked in a Client ID, hide the technical field — shopkeepers never see it.
    if (CONFIG && CONFIG.googleClientId) $('#clientIdField').classList.add('hidden');

    // Restore Firebase live-sync config and auto-connect if set (or use baked-in config).
    let fbCfg = await DB.getMeta('fbConfig', '');
    if (!fbCfg && CONFIG && CONFIG.firebase) fbCfg = JSON.stringify(CONFIG.firebase);
    const fbCode = await DB.getMeta('fbShopCode', '');
    $('#fbConfig').value = fbCfg;
    $('#fbShopCode').value = fbCode;
    if (fbCfg && fbCode && navigator.onLine) {
      Cloud.connect(fbCfg, fbCode, onCloudRemote)
        .then(() => { $('#fbStatus').textContent = '🔥 Live sync connected ✓'; setSync('online', 'Online · live sync'); })
        .catch((err) => { $('#fbStatus').textContent = 'Sync offline: ' + err.message; });
    }

    await seedIfEmpty();
    await reload();
    await renderBill();
    await renderKhata();
    await renderReceivables();
    await renderChecklist();
    $('#hubToday').textContent = $('#todayTotal').textContent;
    updateNetwork();
    requestPersistence();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').then(watchForUpdates).catch(() => {});
    }

    // First run → show the one-time setup wizard.
    if (!(await DB.getMeta('onboarded', false))) openOnboarding();
  }
  init();
})();
