// Training quiz — teaches a new cashier/helper how to run the shop on this app.
// Self-contained: builds its own dialog, reuses app CSS (so dark mode + large text
// work automatically), no network, no dependencies. Questions are shuffled every
// round (and so are the options) so it feels "always new". 4 difficulty levels.
const Training = (() => {
  // ---- Question bank. Each: { q, options:[...], a: <correct text>, why } ----
  // `a` is matched by VALUE (not index) so options can be shuffled safely.
  const BANK = {
    easy: [
      { q: 'You sold one packet of biscuits. On the Stock list you tap…', options: ['the − button on that item', 'the + button', 'the photo', 'Add'], a: 'the − button on that item', why: '− records a sale and reduces stock by one. + adds stock.' },
      { q: 'To add a brand-new product to your shop, you tap…', options: ['+ Add (top right of Stock)', 'the Scan camera only', 'the − button', 'More → Reports'], a: '+ Add (top right of Stock)', why: 'The “+ Add” button on the Stock tab opens the new-item form.' },
      { q: 'A red “Low” tag on an item means…', options: ['stock has reached the reorder level', 'the item has no price', 'the item is expired', 'it is a favourite'], a: 'stock has reached the reorder level', why: 'Low appears when quantity is at or below the “Reorder at” number you set.' },
      { q: 'A customer will pay later, not now. Which payment do you pick?', options: ['Udhaar (credit)', 'Cash', 'UPI', 'Split'], a: 'Udhaar (credit)', why: 'Udhaar records it as credit and tracks who owes you in the Khata.' },
      { q: 'Which tab do you use to make a customer’s bill?', options: ['Bill', 'Stock', 'To Order', 'More'], a: 'Bill', why: 'The Bill tab is where you build a cart and generate a receipt.' },
      { q: 'The 📷 camera button is for…', options: ['scanning a product barcode', 'taking a selfie', 'closing the app', 'printing'], a: 'scanning a product barcode', why: 'It opens the scanner to find an item by its barcode.' }
    ],
    medium: [
      { q: 'An item shows “⏳ 5d”. What does it mean?', options: ['it expires in 5 days', 'only 5 left in stock', '5 sold today', '5% discount'], a: 'it expires in 5 days', why: 'The hourglass shows items expiring soon so you sell them first.' },
      { q: 'The “To Order” list fills up automatically with…', options: ['items that are low on stock', 'your best sellers', 'expired items', 'every item in the shop'], a: 'items that are low on stock', why: 'It collects low-stock items so you know what to buy from the wholesaler.' },
      { q: 'A customer takes goods on credit. To track who owes you, you must enter their…', options: ['name (and phone)', 'Aadhaar number', 'nothing', 'GSTIN'], a: 'name (and phone)', why: 'The name links the Udhaar to a Khata customer so you can chase payment later.' },
      { q: 'You set “Reorder at qty” to 5 for sugar. The app will warn you when sugar…', options: ['drops to 5 or below', 'goes above 5', 'is exactly 0 only', 'never'], a: 'drops to 5 or below', why: 'Reorder level is the cushion that triggers the Low warning.' },
      { q: 'Day Close (in More) mainly shows you…', options: ['the day’s cash summary', 'tomorrow’s weather', 'your GST return', 'customer photos'], a: 'the day’s cash summary', why: 'It totals the day’s sales and cash so you can tally your drawer.' },
      { q: 'A “Hold / Park” bill is useful when…', options: ['a customer steps away and you serve the next one', 'you want to delete a bill', 'the app is offline', 'you need a refund'], a: 'a customer steps away and you serve the next one', why: 'Parking saves the cart so you can resume it after billing someone else.' }
    ],
    hard: [
      { q: 'An item has GST 18% and the sale is inside your state. The receipt splits the tax into…', options: ['CGST 9% + SGST 9%', 'IGST 18%', 'CGST 18%', 'no split'], a: 'CGST 9% + SGST 9%', why: 'Intra-state sales split GST equally into CGST and SGST.' },
      { q: 'Bill is ₹500. Customer pays ₹300 cash + ₹100 UPI (Split). The remaining ₹100 is recorded as…', options: ['Udhaar (credit)', 'a discount', 'extra cash', 'lost'], a: 'Udhaar (credit)', why: 'Any unpaid remainder in a split bill is booked as credit in the Khata.' },
      { q: 'A customer returns one item. The Returns screen…', options: ['adds the item back to stock and makes a credit note', 'deletes the original bill', 'charges them again', 'does nothing to stock'], a: 'adds the item back to stock and makes a credit note', why: 'Returns restock the item and issue a credit note for the refund.' },
      { q: 'You set a wholesale price with a “min qty” of 12. The wholesale price applies when the buyer takes…', options: ['12 or more units', 'fewer than 12', 'exactly 1', 'any quantity'], a: '12 or more units', why: 'Tiered pricing kicks in only once quantity meets the wholesale minimum.' },
      { q: 'At checkout the app warns “selling below cost”. That means the…', options: ['sell price is lower than the cost price', 'customer has no money', 'stock is zero', 'GST is missing'], a: 'sell price is lower than the cost price', why: 'It’s a guard so you don’t accidentally sell at a loss.' },
      { q: 'You want to give a buyer a price estimate without selling yet. You use…', options: ['Quotation (save the cart as a quote)', 'Day Close', 'Returns', 'Stock adjust'], a: 'Quotation (save the cart as a quote)', why: 'Quotes save a cart you can later convert into a real bill.' }
    ],
    expert: [
      { q: 'In an invoice number like INV/2025-26/0001, the “2025-26” is the…', options: ['financial year', 'customer ID', 'GST rate', 'pin code'], a: 'financial year', why: 'Invoice numbers reset and are sequenced per financial year for tax records.' },
      { q: 'Receivables aging groups unpaid bills into buckets of…', options: ['0–30, 30–60, 60–90, 90+ days', 'small / medium / large', 'cash / UPI / credit', 'this week only'], a: '0–30, 30–60, 60–90, 90+ days', why: 'Aging buckets show how overdue each customer’s balance is.' },
      { q: 'Cashier mode hides owner screens (Reports, Purchases, settings). To exit it you need the…', options: ['owner’s PIN', 'internet', 'a barcode', 'nothing'], a: 'owner’s PIN', why: 'Staff can bill but cannot see profits or change settings without the PIN.' },
      { q: 'Inventory valuation is calculated as…', options: ['stock quantity × cost price, totalled', 'sell price only', 'number of items', 'today’s sales'], a: 'stock quantity × cost price, totalled', why: 'It values what your shelves are worth at what you paid.' },
      { q: 'A “credit term” of 30 days on a B2B/Udhaar bill sets the…', options: ['due date used for overdue alerts', 'GST rate', 'discount', 'delivery time'], a: 'due date used for overdue alerts', why: 'Credit terms create a due date so the app can flag overdue receivables.' },
      { q: 'To safely move data to a brand-new phone with no internet, you use…', options: ['Export backup file, then Import on the new phone', 'nothing — it’s automatic offline', 'Stock adjust', 'Day Close'], a: 'Export backup file, then Import on the new phone', why: 'The file backup works fully offline; cloud sync needs the internet.' }
    ]
  };

  const LEVELS = [
    { key: 'easy',   icon: '🌱', name: 'Easy',   desc: 'First day basics' },
    { key: 'medium', icon: '📘', name: 'Medium', desc: 'Daily counter work' },
    { key: 'hard',   icon: '🔥', name: 'Hard',   desc: 'Credit, GST & returns' },
    { key: 'expert', icon: '🏆', name: 'Expert', desc: 'Owner-level mastery' }
  ];
  const ROUND = 6;          // questions per round

  function vibe(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (_) {} }
  function shuffle(arr) {   // Fisher–Yates, returns a new array
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---- Dialog (built once, reused) ----
  let dlg, state;
  function ensureDialog() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'trainingDialog';
    dlg.className = 'quiz-dlg';
    document.body.appendChild(dlg);
    dlg.addEventListener('click', onClick);
    return dlg;
  }

  function open() {
    ensureDialog();
    renderLevels();
    dlg.showModal();
  }

  function renderLevels() {
    dlg.innerHTML = `
      <div class="dialog-head">
        <h3>🎓 Training</h3>
        <button class="btn ghost" data-act="close">Close</button>
      </div>
      <p class="muted">Practice running the shop. Questions change every time. Pick a level:</p>
      <div class="quiz-levels">
        ${LEVELS.map((l) => `
          <button class="quiz-level" data-act="start" data-level="${l.key}">
            <span class="ql-ic">${l.icon}</span>
            <b>${l.name}</b>
            <small>${esc(l.desc)}</small>
          </button>`).join('')}
      </div>`;
  }

  function start(level) {
    const pool = shuffle(BANK[level] || []).slice(0, ROUND).map((item) => ({
      q: item.q, why: item.why, a: item.a, options: shuffle(item.options)
    }));
    state = { level, pool, i: 0, score: 0, answered: false };
    renderQuestion();
  }

  function renderQuestion() {
    const s = state, item = s.pool[s.i];
    const dots = s.pool.map((_, n) => `<span class="qd ${n < s.i ? 'done' : n === s.i ? 'now' : ''}"></span>`).join('');
    dlg.innerHTML = `
      <div class="dialog-head">
        <h3>${LEVELS.find((l) => l.key === s.level).icon} ${s.i + 1} / ${s.pool.length}</h3>
        <button class="btn ghost" data-act="close">Close</button>
      </div>
      <div class="quiz-dots">${dots}</div>
      <p class="quiz-q">${esc(item.q)}</p>
      <div class="quiz-opts">
        ${item.options.map((o) => `<button class="quiz-opt" data-act="answer" data-val="${esc(o)}">${esc(o)}</button>`).join('')}
      </div>
      <p class="quiz-why hidden"></p>
      <button class="btn primary full hidden" data-act="next">Next →</button>`;
  }

  function answer(val) {
    const s = state;
    if (s.answered) return;
    s.answered = true;
    const item = s.pool[s.i];
    const correct = val === item.a;
    if (correct) { s.score++; vibe(15); } else { vibe([20, 50, 20]); }
    dlg.querySelectorAll('.quiz-opt').forEach((b) => {
      b.disabled = true;
      if (b.dataset.val === item.a) b.classList.add('right');
      else if (b.dataset.val === val) b.classList.add('wrong');
    });
    const why = dlg.querySelector('.quiz-why');
    why.textContent = (correct ? '✓ Correct. ' : '✗ ' + item.a + '. ') + item.why;
    why.classList.remove('hidden');
    why.classList.toggle('ok', correct);
    why.classList.toggle('no', !correct);
    dlg.querySelector('[data-act="next"]').classList.remove('hidden');
  }

  function next() {
    const s = state;
    s.i++; s.answered = false;
    if (s.i >= s.pool.length) renderResult();
    else renderQuestion();
  }

  function renderResult() {
    const s = state, total = s.pool.length, pct = Math.round((s.score / total) * 100);
    const pass = pct >= 70;
    if (pass) vibe([15, 40, 15, 40, 15]);
    const msg = pct === 100 ? 'Perfect! You’re ready for the counter. 🎉'
      : pass ? 'Well done — you’ve got the basics. Try a harder level.'
      : 'Good start. Review the tips and try again.';
    dlg.innerHTML = `
      <div class="quiz-result">
        <div class="qr-emoji">${pass ? '🏆' : '📚'}</div>
        <h3>${s.score} / ${total}</h3>
        <p class="muted">${msg}</p>
        <button class="btn primary full" data-act="start" data-level="${s.level}">Try again</button>
        <button class="btn full" data-act="levels">Choose another level</button>
        <button class="btn ghost full" data-act="close">Close</button>
      </div>`;
  }

  function onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'close') dlg.close();
    else if (act === 'levels') renderLevels();
    else if (act === 'start') start(btn.dataset.level);
    else if (act === 'answer') answer(btn.dataset.val);
    else if (act === 'next') next();
  }

  return { open };
})();
