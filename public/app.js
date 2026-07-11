'use strict';

const DEFAULT_BUDGET = 5_000_000;

const DEFAULT_STOCKS = [
  { id: '2330', name: '台積電', symbol: '2330.TW', market: '台股', currency: 'TWD', percent: 25 },
  { id: 'TSM', name: 'TSM ADR', symbol: 'TSM', market: '美股', currency: 'USD', percent: 25 },
  { id: 'HYNIX', name: 'SK hynix', symbol: '000660.KS', market: '韓股', currency: 'KRW', percent: 10 },
  { id: 'NVDA', name: 'NVIDIA', symbol: 'NVDA', market: '美股', currency: 'USD', percent: 7 },
  { id: '2308', name: '台達電', symbol: '2308.TW', market: '台股', currency: 'TWD', percent: 7 },
  { id: '2383', name: '台光電', symbol: '2383.TW', market: '台股', currency: 'TWD', percent: 5 },
  { id: '3017', name: '奇鋐', symbol: '3017.TW', market: '台股', currency: 'TWD', percent: 5 },
  { id: 'MU', name: 'Micron', symbol: 'MU', market: '美股', currency: 'USD', percent: 5 },
  { id: 'AVGO', name: 'Broadcom', symbol: 'AVGO', market: '美股', currency: 'USD', percent: 3 },
  { id: '3324', name: '雙鴻', symbol: '3324.TWO', market: '上櫃', currency: 'TWD', percent: 3 },
  { id: '2368', name: '金像電', symbol: '2368.TW', market: '台股', currency: 'TWD', percent: 3 },
  { id: '3037', name: '欣興', symbol: '3037.TW', market: '台股', currency: 'TWD', percent: 2 },
];

const CURRENCIES = ['TWD', 'USD', 'KRW', 'JPY', 'HKD'];

// 該幣別換算台幣的 Yahoo 匯率代號（USD 用 TWD=X，其餘用 <幣別>TWD=X）
function fxSymbolOf(currency) {
  if (currency === 'TWD') return null;
  return currency === 'USD' ? 'TWD=X' : currency + 'TWD=X';
}

const state = {
  budget: DEFAULT_BUDGET,
  stocks: DEFAULT_STOCKS,
  transactions: [],
  quotes: {},
  quoteErrors: {},
  fetchedAt: null,
  usingCachedQuotes: false,
};

const $ = (id) => document.getElementById(id);

// ---------- 格式化 ----------
const fmtTWD = (n, digits = 0) =>
  n == null || Number.isNaN(n)
    ? '—'
    : 'NT$' + n.toLocaleString('zh-TW', { maximumFractionDigits: digits, minimumFractionDigits: digits });

const fmtNum = (n, digits = 2) =>
  n == null || Number.isNaN(n)
    ? '—'
    : n.toLocaleString('zh-TW', { maximumFractionDigits: digits });

const fmtPct = (n, digits = 1) =>
  n == null || Number.isNaN(n) ? '—' : (n * 100).toFixed(digits) + '%';

const signed = (n, fmt) => (n > 0 ? '+' : '') + fmt(n);
const pnlClass = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const tickerOf = (symbol) => String(symbol).split('.')[0];

// ---------- 資料存取 ----------
function applyDoc(data) {
  state.transactions = Array.isArray(data.transactions) ? data.transactions : [];
  if (Array.isArray(data.stocks) && data.stocks.length) state.stocks = data.stocks;
  if (Number(data.budget) > 0) state.budget = Number(data.budget);
}

async function loadPortfolio() {
  try {
    const res = await fetch('/api/portfolio');
    applyDoc(await res.json());
  } catch {
    /* 保持預設值 */
  }
  // 伺服器是空的但本機瀏覽器有備份（例如資料庫被清空）→ 還原
  const backup = localStorage.getItem('portfolio-backup');
  if (!state.transactions.length && backup) {
    try {
      const parsed = JSON.parse(backup);
      if (Array.isArray(parsed.transactions) && parsed.transactions.length) {
        applyDoc(parsed);
        savePortfolio();
        showNotice('伺服器上沒有資料，已從瀏覽器備份還原紀錄。');
      }
    } catch { /* 備份損毀就略過 */ }
  }
}

async function savePortfolio() {
  const payload = { budget: state.budget, stocks: state.stocks, transactions: state.transactions };
  localStorage.setItem('portfolio-backup', JSON.stringify(payload));
  try {
    const res = await fetch('/api/portfolio', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error();
  } catch {
    showNotice('儲存到伺服器失敗，資料暫存在瀏覽器中，請稍後重試或匯出備份。');
  }
}

async function loadQuotes() {
  const fxSyms = [...new Set(state.stocks.map((s) => fxSymbolOf(s.currency)).filter(Boolean))];
  const symbols = [...state.stocks.map((s) => s.symbol), ...fxSyms];
  try {
    const res = await fetch('/api/quotes?symbols=' + encodeURIComponent(symbols.join(',')));
    if (!res.ok) throw new Error();
    const data = await res.json();
    state.quotes = data.quotes || {};
    state.quoteErrors = data.errors || {};
    state.fetchedAt = data.fetchedAt;
    state.usingCachedQuotes = false;
    if (Object.keys(state.quotes).length) {
      localStorage.setItem('quotes-cache', JSON.stringify({ quotes: state.quotes, fetchedAt: state.fetchedAt }));
    }
  } catch {
    const cached = localStorage.getItem('quotes-cache');
    if (cached) {
      const parsed = JSON.parse(cached);
      state.quotes = parsed.quotes;
      state.fetchedAt = parsed.fetchedAt;
      state.usingCachedQuotes = true;
    }
  }
  const failed = Object.keys(state.quoteErrors);
  if (state.usingCachedQuotes) {
    showNotice('無法取得即時報價，目前顯示上次快取的報價。');
  } else if (failed.length) {
    showNotice('部分報價取得失敗：' + failed.join('、'));
  } else {
    hideNotice();
  }
}

function showNotice(msg) {
  const el = $('notice');
  el.textContent = '⚠ ' + msg;
  el.hidden = false;
}
function hideNotice() {
  $('notice').hidden = true;
}

// ---------- 計算 ----------
function fxRate(currency) {
  const sym = fxSymbolOf(currency);
  if (!sym) return 1;
  const q = state.quotes[sym];
  return q ? q.price : null;
}

function computeStock(stock) {
  const txs = state.transactions.filter((t) => t.stockId === stock.id);
  const fx = fxRate(stock.currency);
  const quote = state.quotes[stock.symbol];

  let shares = 0;
  let costNative = 0;
  let investedTWD = 0;
  let investedKnown = true;

  for (const t of txs) {
    shares += t.shares;
    costNative += t.shares * t.price;
    if (t.twdCost != null) {
      investedTWD += t.twdCost * Math.sign(t.shares || 1);
    } else if (fx != null) {
      investedTWD += t.shares * t.price * fx;
    } else {
      investedKnown = false;
    }
  }

  const targetTWD = (state.budget * stock.percent) / 100;
  const avgCost = shares > 0 ? costNative / shares : null;
  const price = quote ? quote.price : null;
  const valueTWD = price != null && fx != null ? shares * price * fx : shares === 0 ? 0 : null;
  const invested = investedKnown ? investedTWD : null;
  const pnl = valueTWD != null && invested != null ? valueTWD - invested : null;
  const progress = invested != null && targetTWD > 0 ? invested / targetTWD : null;
  const dayChange =
    quote && quote.previousClose ? (quote.price - quote.previousClose) / quote.previousClose : null;

  return { stock, shares, avgCost, invested, targetTWD, price, valueTWD, pnl, progress, dayChange };
}

// ---------- 畫面 ----------
function render() {
  const rows = state.stocks.map(computeStock);

  const totalInvested = rows.reduce((s, r) => s + (r.invested ?? 0), 0);
  const anyValueMissing = rows.some((r) => r.valueTWD == null);
  const totalValue = anyValueMissing ? null : rows.reduce((s, r) => s + r.valueTWD, 0);
  const totalPnl = totalValue != null ? totalValue - totalInvested : null;
  const overallProgress = totalInvested / state.budget;

  $('subtitle').textContent = `總預算 ${fmtTWD(state.budget)} ・ ${state.stocks.length} 檔標的目標配置`;

  $('kpi-invested').textContent = fmtTWD(totalInvested);
  $('kpi-invested-sub').textContent = '剩餘可投入 ' + fmtTWD(Math.max(state.budget - totalInvested, 0));
  $('kpi-value').textContent = fmtTWD(totalValue);
  $('kpi-value-sub').textContent = state.fetchedAt
    ? '報價時間 ' + new Date(state.fetchedAt).toLocaleString('zh-TW', { hour12: false })
    : '';
  const pnlEl = $('kpi-pnl');
  pnlEl.textContent = totalPnl == null ? '—' : signed(totalPnl, (n) => fmtTWD(n));
  pnlEl.className = 'kpi-value ' + pnlClass(totalPnl ?? 0);
  $('kpi-pnl-sub').textContent =
    totalPnl != null && totalInvested > 0 ? '報酬率 ' + signed(totalPnl / totalInvested, fmtPct) : '';
  $('kpi-progress').textContent = fmtPct(overallProgress);
  $('kpi-progress-sub').textContent = '目標 ' + fmtTWD(state.budget);

  $('overall-progress-label').textContent =
    fmtTWD(totalInvested) + ' / ' + fmtTWD(state.budget) + '（' + fmtPct(overallProgress) + '）';
  const bar = $('overall-progress-bar');
  bar.style.width = Math.min(overallProgress * 100, 100) + '%';
  bar.classList.toggle('over', overallProgress > 1);

  renderHoldings(rows, totalInvested, totalValue, totalPnl);
  renderTransactions();

  $('fx-info').textContent = [...new Set(state.stocks.map((s) => s.currency))]
    .filter((c) => c !== 'TWD')
    .map((c) => {
      const r = fxRate(c);
      return r ? `${c}/TWD ${fmtNum(r, r < 1 ? 4 : 3)}` : null;
    })
    .filter(Boolean)
    .join('　');
  $('updated-at').textContent = state.fetchedAt
    ? '更新於 ' + new Date(state.fetchedAt).toLocaleString('zh-TW', { hour12: false }) + (state.usingCachedQuotes ? '（快取）' : '')
    : '尚未取得報價';
}

function renderHoldings(rows, totalInvested, totalValue, totalPnl) {
  const body = $('holdings-body');
  body.innerHTML = '';
  for (const r of rows) {
    const { stock } = r;
    const tr = document.createElement('tr');
    const priceDigits = stock.currency === 'KRW' || stock.currency === 'JPY' ? 0 : 2;
    tr.innerHTML = `
      <td>
        <div class="stock-name">${esc(stock.name)}</div>
        <div class="stock-meta"><span>${esc(tickerOf(stock.symbol))}</span><span class="chip">${esc(stock.market)}</span></div>
      </td>
      <td class="num">${fmtNum(stock.percent, 1)}%<span class="cell-sub">${fmtTWD(r.targetTWD)}</span></td>
      <td class="num">${r.shares ? fmtNum(r.shares, 4) : '—'}</td>
      <td class="num">${r.avgCost != null ? fmtNum(r.avgCost, priceDigits) : '—'}</td>
      <td class="num">${fmtTWD(r.invested)}</td>
      <td>
        <div class="progress-cell">
          <div class="bar-track"><div class="bar-fill ${r.progress > 1 ? 'over' : ''}" style="width:${Math.min((r.progress ?? 0) * 100, 100)}%"></div></div>
          <span class="pct">${fmtPct(r.progress)}${r.invested != null ? '，還差 ' + fmtTWD(Math.max(r.targetTWD - r.invested, 0)) : ''}</span>
        </div>
      </td>
      <td class="num">${r.price != null ? fmtNum(r.price, priceDigits) : '—'}${
        r.dayChange != null
          ? `<span class="cell-sub ${pnlClass(r.dayChange)}">${signed(r.dayChange, (n) => fmtPct(n, 2))}</span>`
          : ''
      }</td>
      <td class="num">${fmtTWD(r.valueTWD)}</td>
      <td class="num ${pnlClass(r.pnl ?? 0)}">${r.pnl != null ? signed(r.pnl, (n) => fmtTWD(n)) : '—'}${
        r.pnl != null && r.invested > 0
          ? `<span class="cell-sub ${pnlClass(r.pnl)}">${signed(r.pnl / r.invested, fmtPct)}</span>`
          : ''
      }</td>`;
    body.appendChild(tr);
  }

  const totalPercent = state.stocks.reduce((s, x) => s + (Number(x.percent) || 0), 0);
  $('holdings-foot').innerHTML = `
    <tr>
      <td>合計</td>
      <td class="num">${fmtNum(totalPercent, 1)}%<span class="cell-sub">${fmtTWD(state.budget)}</span></td>
      <td class="num"></td>
      <td class="num"></td>
      <td class="num">${fmtTWD(totalInvested)}</td>
      <td></td>
      <td class="num"></td>
      <td class="num">${fmtTWD(totalValue)}</td>
      <td class="num ${pnlClass(totalPnl ?? 0)}">${totalPnl != null ? signed(totalPnl, (n) => fmtTWD(n)) : '—'}</td>
    </tr>`;
}

function renderTransactions() {
  const body = $('tx-body');
  body.innerHTML = '';
  const sorted = [...state.transactions].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const t of sorted) {
    const stock = state.stocks.find((s) => s.id === t.stockId);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(t.date)}</td>
      <td>${esc(stock ? stock.name : t.stockId)}</td>
      <td class="num ${t.shares < 0 ? 'down' : ''}">${fmtNum(t.shares, 4)}</td>
      <td class="num">${fmtNum(t.price, 4)} ${stock ? esc(stock.currency) : ''}</td>
      <td class="num">${t.twdCost != null ? fmtTWD(t.twdCost) : '（依匯率）'}</td>
      <td><button class="tx-del" data-id="${esc(t.id)}" title="刪除">✕</button></td>`;
    body.appendChild(tr);
  }
  $('tx-empty').hidden = sorted.length > 0;
}

function rebuildStockSelect() {
  const select = $('tx-stock');
  const prev = select.value;
  select.innerHTML = '';
  for (const s of state.stocks) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.name}（${tickerOf(s.symbol)}・${s.currency}）`;
    select.appendChild(opt);
  }
  if (state.stocks.some((s) => s.id === prev)) select.value = prev;
}

// ---------- 標的編輯 ----------
function editorRow(s = { id: '', name: '', symbol: '', market: '台股', currency: 'TWD', percent: 0 }) {
  const tr = document.createElement('tr');
  tr.dataset.id = s.id;
  const currencyOptions = CURRENCIES.map(
    (c) => `<option value="${c}" ${c === s.currency ? 'selected' : ''}>${c}</option>`
  ).join('');
  tr.innerHTML = `
    <td><input class="e-name" value="${esc(s.name)}" placeholder="名稱"></td>
    <td><input class="e-symbol" value="${esc(s.symbol)}" placeholder="如 2330.TW"></td>
    <td><input class="e-market" value="${esc(s.market)}" placeholder="台股"></td>
    <td><select class="e-currency">${currencyOptions}</select></td>
    <td class="num"><input class="e-percent" type="number" step="any" min="0" value="${Number(s.percent) || 0}"></td>
    <td><button type="button" class="tx-del e-del" title="刪除標的">✕</button></td>`;
  return tr;
}

function updateEditorTotal() {
  const total = [...document.querySelectorAll('#editor-body .e-percent')].reduce(
    (s, el) => s + (parseFloat(el.value) || 0),
    0
  );
  const el = $('editor-total');
  el.textContent = '比例合計 ' + fmtNum(total, 1) + '%';
  el.className = Math.abs(total - 100) < 0.01 ? 'editor-total ok' : 'editor-total warn';
}

function openEditor() {
  $('edit-budget').value = state.budget;
  const body = $('editor-body');
  body.innerHTML = '';
  for (const s of state.stocks) body.appendChild(editorRow(s));
  updateEditorTotal();
  $('editor-card').hidden = false;
  $('edit-stocks-btn').hidden = true;
}

function closeEditor() {
  $('editor-card').hidden = true;
  $('edit-stocks-btn').hidden = false;
}

function saveEditor() {
  const budget = parseFloat($('edit-budget').value);
  if (!(budget > 0)) {
    alert('總預算必須是正數');
    return;
  }

  const rows = [...$('editor-body').children];
  if (!rows.length) {
    alert('至少要有一檔標的');
    return;
  }

  const stocks = [];
  for (const tr of rows) {
    const q = (cls) => tr.querySelector(cls);
    const symbol = q('.e-symbol').value.trim().toUpperCase();
    if (!symbol) {
      alert('每檔標的都要填 Yahoo 代號');
      return;
    }
    const name = q('.e-name').value.trim() || tickerOf(symbol);
    stocks.push({
      id: tr.dataset.id || symbol,
      name,
      symbol,
      market: q('.e-market').value.trim() || '—',
      currency: q('.e-currency').value,
      percent: parseFloat(q('.e-percent').value) || 0,
    });
  }

  const ids = stocks.map((s) => s.id);
  if (new Set(ids).size !== ids.length) {
    alert('標的代號重複了，請確認每檔代號都不同');
    return;
  }

  const total = stocks.reduce((s, x) => s + x.percent, 0);
  if (Math.abs(total - 100) > 0.01 && !confirm(`比例合計是 ${fmtNum(total, 1)}%（不是 100%），仍要儲存嗎？`)) {
    return;
  }

  state.budget = budget;
  state.stocks = stocks;
  savePortfolio();
  rebuildStockSelect();
  closeEditor();
  render();
  loadQuotes().then(render); // 新標的需要抓報價
}

function initEditor() {
  $('edit-stocks-btn').addEventListener('click', openEditor);
  $('editor-cancel').addEventListener('click', closeEditor);
  $('editor-save').addEventListener('click', saveEditor);
  $('editor-add').addEventListener('click', () => {
    $('editor-body').appendChild(editorRow());
    updateEditorTotal();
  });
  $('editor-body').addEventListener('input', (e) => {
    if (e.target.classList.contains('e-percent')) updateEditorTotal();
  });
  $('editor-body').addEventListener('click', (e) => {
    const btn = e.target.closest('.e-del');
    if (!btn) return;
    const tr = btn.closest('tr');
    const id = tr.dataset.id;
    if (id && state.transactions.some((t) => t.stockId === id)) {
      alert('這檔標的已有交易紀錄，請先刪除其交易紀錄再移除標的。');
      return;
    }
    tr.remove();
    updateEditorTotal();
  });
}

// ---------- 事件 ----------
function initForm() {
  rebuildStockSelect();
  $('tx-date').value = new Date().toISOString().slice(0, 10);

  $('tx-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const shares = parseFloat($('tx-shares').value);
    const price = parseFloat($('tx-price').value);
    if (!shares || Number.isNaN(price)) return;
    const twdRaw = $('tx-twd').value.trim();
    state.transactions.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      stockId: $('tx-stock').value,
      date: $('tx-date').value,
      shares,
      price,
      twdCost: twdRaw === '' ? null : Math.abs(parseFloat(twdRaw)),
    });
    await savePortfolio();
    $('tx-shares').value = '';
    $('tx-price').value = '';
    $('tx-twd').value = '';
    render();
  });

  $('tx-body').addEventListener('click', async (e) => {
    const btn = e.target.closest('.tx-del');
    if (!btn) return;
    if (!confirm('確定要刪除這筆交易嗎？')) return;
    state.transactions = state.transactions.filter((t) => t.id !== btn.dataset.id);
    await savePortfolio();
    render();
  });

  $('refresh-btn').addEventListener('click', async () => {
    const btn = $('refresh-btn');
    btn.disabled = true;
    btn.textContent = '更新中…';
    await loadQuotes();
    render();
    btn.disabled = false;
    btn.textContent = '↻ 更新報價';
  });

  $('export-btn').addEventListener('click', () => {
    const doc = { budget: state.budget, stocks: state.stocks, transactions: state.transactions };
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `portfolio-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.transactions)) throw new Error();
      if (!confirm(`將以備份檔（${data.transactions.length} 筆交易）覆蓋目前紀錄，確定嗎？`)) return;
      applyDoc(data);
      await savePortfolio();
      rebuildStockSelect();
      render();
      loadQuotes().then(render);
    } catch {
      alert('備份檔格式錯誤');
    } finally {
      e.target.value = '';
    }
  });
}

// ---------- 啟動 ----------
(async function main() {
  initForm();
  initEditor();
  await loadPortfolio();
  rebuildStockSelect();
  render();
  // 開頁時載入一次現價，之後由「↻ 更新報價」按鈕手動更新
  await loadQuotes();
  render();
})();
