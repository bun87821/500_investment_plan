'use strict';

const DEFAULT_BUDGET = 5_000_000;

const DEFAULT_STOCKS = [
  { id: '2330', name: '台積電', symbol: '2330.TW', market: '台股', currency: 'TWD', category: '晶圓代工', percent: 25 },
  { id: 'TSM', name: 'TSM ADR', symbol: 'TSM', market: '美股', currency: 'USD', category: '晶圓代工', percent: 25 },
  { id: 'HYNIX', name: 'SK hynix', symbol: '000660.KS', market: '韓股', currency: 'KRW', category: '記憶體', percent: 10 },
  { id: 'NVDA', name: 'NVIDIA', symbol: 'NVDA', market: '美股', currency: 'USD', category: 'IC設計', percent: 7 },
  { id: '2308', name: '台達電', symbol: '2308.TW', market: '台股', currency: 'TWD', category: '電源', percent: 7 },
  { id: '2383', name: '台光電', symbol: '2383.TW', market: '台股', currency: 'TWD', category: '銅箔基板', percent: 5 },
  { id: '3017', name: '奇鋐', symbol: '3017.TW', market: '台股', currency: 'TWD', category: '散熱', percent: 5 },
  { id: 'MU', name: 'Micron', symbol: 'MU', market: '美股', currency: 'USD', category: '記憶體', percent: 5 },
  { id: 'AVGO', name: 'Broadcom', symbol: 'AVGO', market: '美股', currency: 'USD', category: 'IC設計', percent: 3 },
  { id: '3324', name: '雙鴻', symbol: '3324.TWO', market: '上櫃', currency: 'TWD', category: '散熱', percent: 3 },
  { id: '2368', name: '金像電', symbol: '2368.TW', market: '台股', currency: 'TWD', category: 'PCB/載板', percent: 3 },
  { id: '3037', name: '欣興', symbol: '3037.TW', market: '台股', currency: 'TWD', category: 'PCB/載板', percent: 2 },
];

const CURRENCIES = ['TWD', 'USD', 'KRW', 'JPY', 'HKD'];

// 類別配色（依 dataviz 調色盤固定順序，第 9 種以後歸為灰色）
const CATEGORY_PALETTE_LIGHT = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
const CATEGORY_PALETTE_DARK = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'];
const CATEGORY_OTHER_COLOR = '#898781';

function isDarkMode() {
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

// 依標的清單中類別首次出現的順序，穩定地分配顏色
function categoryColorMap() {
  const palette = isDarkMode() ? CATEGORY_PALETTE_DARK : CATEGORY_PALETTE_LIGHT;
  const order = [];
  for (const s of state.stocks) {
    const c = s.category || '未分類';
    if (!order.includes(c)) order.push(c);
  }
  const map = {};
  order.forEach((c, i) => {
    map[c] = i < palette.length ? palette[i] : CATEGORY_OTHER_COLOR;
  });
  return { map, order };
}

// 圓餅圖佔比基準
let chartBasis = null; // 'target' | 'invested' | 'value'
let basisLocked = false; // 使用者手動點選後鎖定，不再自動挑選
const BASIS = {
  target: { label: '目標配置', valueOf: (r) => Number(r.stock.percent) || 0, fmtVal: (v) => fmtNum(v, 1) + '%' },
  invested: { label: '投入成本', valueOf: (r) => r.invested ?? 0, fmtVal: (v) => fmtTWD(v) },
  value: { label: '目前市值', valueOf: (r) => r.valueTWD ?? 0, fmtVal: (v) => fmtTWD(v) },
};

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
  authEnabled: false,
  user: null, // { sub, email, name, picture }
};

// 各使用者在瀏覽器端的備份各自存一份；訪客（未登入）模式的正式儲存位置就是這裡
const backupKey = () => 'portfolio-backup:' + (state.user?.sub || 'local');

// 啟用登入但尚未登入 → 訪客模式：資料只存瀏覽器 localStorage，不打伺服器
const isGuest = () => state.authEnabled && !state.user;

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
  if (Array.isArray(data.stocks) && data.stocks.length) {
    // 舊資料可能沒有 category 欄位，依 id 對回預設分類，找不到則標為「未分類」
    state.stocks = data.stocks.map((s) => ({
      ...s,
      category: s.category || DEFAULT_STOCKS.find((d) => d.id === s.id)?.category || '未分類',
    }));
  }
  if (Number(data.budget) > 0) state.budget = Number(data.budget);
}

function tryApplyBackup(key) {
  const backup = localStorage.getItem(key);
  if (!backup) return false;
  try {
    const parsed = JSON.parse(backup);
    if (Array.isArray(parsed.transactions) && parsed.transactions.length) {
      applyDoc(parsed);
      return true;
    }
  } catch { /* 備份損毀就略過 */ }
  return false;
}

async function loadPortfolio() {
  if (isGuest()) {
    // 訪客模式：直接從瀏覽器讀（也相容啟用登入前的舊 key）
    tryApplyBackup(backupKey()) || tryApplyBackup('portfolio-backup');
    return;
  }
  try {
    const res = await fetch('/api/portfolio');
    if (res.ok) applyDoc(await res.json());
  } catch {
    /* 保持預設值 */
  }
  // 伺服器是空的但瀏覽器有備份 → 還原。依序找：這個帳號的備份、訪客模式的資料
  //（剛登入的新帳號會把訪客時期建立的計畫帶上雲端）、舊版未分帳號的備份
  if (!state.transactions.length) {
    const restored =
      tryApplyBackup(backupKey()) || tryApplyBackup('portfolio-backup:local') || tryApplyBackup('portfolio-backup');
    if (restored) {
      savePortfolio();
      showNotice('已將瀏覽器中的紀錄同步到你的帳號。');
    }
  }
}

async function savePortfolio() {
  const payload = { budget: state.budget, stocks: state.stocks, transactions: state.transactions };
  localStorage.setItem(backupKey(), JSON.stringify(payload));
  if (isGuest()) return; // 訪客模式只存瀏覽器
  try {
    const res = await fetch('/api/portfolio', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      showNotice('登入已過期，資料暫存在瀏覽器中 — 請重新整理頁面登入後再操作一次。');
      return;
    }
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
  renderDonut(rows);
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

// ---------- 圓餅圖（甜甜圈）----------
function polar(cx, cy, r, angleDeg) {
  const a = ((angleDeg - 90) * Math.PI) / 180; // 0 度指向正上方，順時針遞增
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(cx, cy, rO, rI, a0, a1) {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [ox0, oy0] = polar(cx, cy, rO, a0);
  const [ox1, oy1] = polar(cx, cy, rO, a1);
  const [ix1, iy1] = polar(cx, cy, rI, a1);
  const [ix0, iy0] = polar(cx, cy, rI, a0);
  return `M ${ox0} ${oy0} A ${rO} ${rO} 0 ${large} 1 ${ox1} ${oy1} L ${ix1} ${iy1} A ${rI} ${rI} 0 ${large} 0 ${ix0} ${iy0} Z`;
}

function ringPath(cx, cy, rO, rI) {
  return (
    `M ${cx - rO} ${cy} a ${rO} ${rO} 0 1 0 ${rO * 2} 0 a ${rO} ${rO} 0 1 0 ${-rO * 2} 0 Z ` +
    `M ${cx - rI} ${cy} a ${rI} ${rI} 0 1 1 ${rI * 2} 0 a ${rI} ${rI} 0 1 1 ${-rI * 2} 0 Z`
  );
}

function renderDonut(rows) {
  // 使用者未手動點選前，自動挑選最佳基準：有市值優先市值，其次投入成本，再其次目標配置
  if (!basisLocked) {
    const tV = rows.reduce((s, r) => s + (r.valueTWD ?? 0), 0);
    const tI = rows.reduce((s, r) => s + (r.invested ?? 0), 0);
    chartBasis = tV > 0 ? 'value' : tI > 0 ? 'invested' : 'target';
  }
  // 更新基準切換鈕的選取狀態
  document.querySelectorAll('#basis-control button').forEach((b) => {
    b.classList.toggle('active', b.dataset.basis === chartBasis);
  });

  const basis = BASIS[chartBasis];
  const { map: colorMap, order: catOrder } = categoryColorMap();

  // 依「類別出現順序」排序標的，讓同類別的切片相鄰、視覺上形成一個類別扇形
  const ordered = [...rows].sort((a, b) => {
    const ca = catOrder.indexOf(a.stock.category || '未分類');
    const cb = catOrder.indexOf(b.stock.category || '未分類');
    return ca - cb;
  });

  const slices = ordered
    .map((r) => ({
      row: r,
      cat: r.stock.category || '未分類',
      color: colorMap[r.stock.category || '未分類'],
      value: basis.valueOf(r),
    }))
    .filter((s) => s.value > 0);

  const total = slices.reduce((s, x) => s + x.value, 0);

  const donutEl = $('donut');
  const cx = 160;
  const cy = 160;
  const rO = 140;
  const rI = 88;

  if (total <= 0) {
    donutEl.innerHTML = `<div class="donut-empty">目前${basis.label}為 0，<br>尚無資料可顯示</div>`;
    $('donut-legend').innerHTML = '';
    return;
  }

  let angle = 0;
  let paths = '';
  for (const s of slices) {
    const sweep = (s.value / total) * 360;
    const a0 = angle;
    const a1 = angle + sweep;
    const pct = s.value / total;
    const d = sweep >= 359.999 ? ringPath(cx, cy, rO, rI) : arcPath(cx, cy, rO, rI, a0, a1);
    const rule = sweep >= 359.999 ? ' fill-rule="evenodd"' : '';
    const label = `${s.row.stock.name}（${s.cat}）\n${basis.fmtVal(s.value)}・${fmtPct(pct)}`;
    paths += `<path class="donut-slice" d="${d}"${rule} fill="${s.color}" stroke="var(--surface)" stroke-width="3" stroke-linejoin="round" data-cat="${esc(s.cat)}" data-label="${esc(label)}">`;
    paths += `<title>${esc(label)}</title></path>`;
    // 佔比較大的切片直接標示股票簡稱，避免小切片文字擁擠
    if (pct >= 0.10 && sweep < 359.999) {
      const mid = (a0 + a1) / 2;
      const [lx, ly] = polar(cx, cy, (rO + rI) / 2, mid);
      paths += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="slice-label" text-anchor="middle" dominant-baseline="central">${esc(
        s.row.stock.name
      )}</text>`;
    }
    angle = a1;
  }

  const centerNum = chartBasis === 'target' ? fmtTWD(state.budget) : fmtTWD(total);
  donutEl.innerHTML = `
    <svg viewBox="0 0 320 320" class="donut-svg" role="img" aria-label="資產類別配置圓餅圖">
      <defs>
        <filter id="donut-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="rgba(0,0,0,0.18)" flood-opacity="1"/>
        </filter>
      </defs>
      <circle cx="160" cy="160" r="142" class="donut-backdrop"></circle>
      <g filter="url(#donut-shadow)">
      ${paths}
      </g>
      <circle cx="160" cy="160" r="80" class="donut-hole"></circle>
      <text x="160" y="150" text-anchor="middle" class="donut-center-label">${basis.label}</text>
      <text x="160" y="176" text-anchor="middle" class="donut-center-value">${centerNum}</text>
      <text x="160" y="197" text-anchor="middle" class="donut-center-sub">合計</text>
    </svg>
    <div class="donut-tooltip" id="donut-tooltip" hidden></div>`;

  renderDonutLegend(ordered, colorMap, catOrder, basis, total);
  bindDonutTooltip();
}

function renderDonutLegend(ordered, colorMap, catOrder, basis, total) {
  const legend = $('donut-legend');
  let html = '';
  for (const cat of catOrder) {
    const members = ordered.filter((r) => (r.stock.category || '未分類') === cat);
    const catValue = members.reduce((s, r) => s + basis.valueOf(r), 0);
    const catPct = total > 0 ? catValue / total : 0;
    const legendValue = chartBasis === 'target' ? fmtTWD((state.budget * catValue) / 100) : basis.fmtVal(catValue);
    const memberHtml = members
      .map((r) => {
        const v = basis.valueOf(r);
        const p = total > 0 ? v / total : 0;
        return `<span class="legend-member${v <= 0 ? ' zero' : ''}"><span>${esc(r.stock.name)}</span><span>${fmtPct(p)}</span></span>`;
      })
      .join('');
    html += `
      <div class="legend-group" data-cat="${esc(cat)}">
        <div class="legend-head">
          <span class="legend-swatch" style="background:${colorMap[cat]}"></span>
          <span class="legend-cat">${esc(cat)}</span>
          <span class="legend-cat-pct">${fmtPct(catPct)}</span>
        </div>
        <div class="legend-value">${legendValue}</div>
        <div class="legend-track"><span style="width:${Math.max(2, catPct * 100).toFixed(2)}%; background:${colorMap[cat]}"></span></div>
        <div class="legend-members">${memberHtml}</div>
      </div>`;
  }
  legend.innerHTML = html;
}

function bindDonutTooltip() {
  const svg = $('donut').querySelector('.donut-svg');
  const tip = $('donut-tooltip');
  if (!svg || !tip) return;
  const wrap = $('donut');
  const legend = $('donut-legend');

  const setActiveCat = (cat) => {
    wrap.querySelectorAll('.donut-slice').forEach((slice) => {
      slice.classList.toggle('is-muted', !!cat && slice.dataset.cat !== cat);
      slice.classList.toggle('is-active', !!cat && slice.dataset.cat === cat);
    });
    legend.querySelectorAll('.legend-group').forEach((group) => {
      group.classList.toggle('is-muted', !!cat && group.dataset.cat !== cat);
      group.classList.toggle('is-active', !!cat && group.dataset.cat === cat);
    });
  };

  svg.querySelectorAll('path').forEach((p) => {
    p.addEventListener('mousemove', (e) => {
      tip.textContent = p.dataset.label;
      tip.hidden = false;
      setActiveCat(p.dataset.cat);
      const rect = wrap.getBoundingClientRect();
      tip.style.left = e.clientX - rect.left + 12 + 'px';
      tip.style.top = e.clientY - rect.top + 12 + 'px';
    });
    p.addEventListener('mouseleave', () => {
      tip.hidden = true;
      setActiveCat(null);
    });
  });

  legend.querySelectorAll('.legend-group').forEach((group) => {
    group.addEventListener('mouseenter', () => setActiveCat(group.dataset.cat));
    group.addEventListener('mouseleave', () => setActiveCat(null));
  });
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
function editorRow(s = { id: '', name: '', symbol: '', market: '台股', currency: 'TWD', category: '', percent: 0 }) {
  const tr = document.createElement('tr');
  tr.dataset.id = s.id;
  const currencyOptions = CURRENCIES.map(
    (c) => `<option value="${c}" ${c === s.currency ? 'selected' : ''}>${c}</option>`
  ).join('');
  tr.innerHTML = `
    <td><input class="e-name" value="${esc(s.name)}" placeholder="名稱"></td>
    <td><input class="e-symbol" value="${esc(s.symbol)}" placeholder="如 2330.TW"></td>
    <td><input class="e-market" value="${esc(s.market)}" placeholder="台股"></td>
    <td><input class="e-category" list="category-list" value="${esc(s.category || '')}" placeholder="如 記憶體"></td>
    <td><select class="e-currency">${currencyOptions}</select></td>
    <td class="num"><input class="e-percent" type="number" step="any" min="0" value="${Number(s.percent) || 0}"></td>
    <td><button type="button" class="tx-del e-del" title="刪除標的">✕</button></td>`;
  return tr;
}

function refreshCategoryDatalist() {
  const dl = $('category-list');
  if (!dl) return;
  const cats = [...new Set(state.stocks.map((s) => s.category).filter(Boolean))];
  dl.innerHTML = cats.map((c) => `<option value="${esc(c)}"></option>`).join('');
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
  refreshCategoryDatalist();
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
      category: q('.e-category').value.trim() || '未分類',
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

  $('basis-control').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-basis]');
    if (!btn) return;
    chartBasis = btn.dataset.basis;
    basisLocked = true;
    render();
  });

  // 深色/淺色切換時重畫圓餅圖以套用對應配色
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  }

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

// ---------- 登入 ----------
function showLoginBanner(clientId) {
  $('login-view').hidden = false;

  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.onload = () => {
    google.accounts.id.initialize({ client_id: clientId, callback: onGoogleCredential });
    google.accounts.id.renderButton($('gsi-button'), {
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      locale: 'zh_TW',
      width: 240,
    });
  };
  script.onerror = () => {
    const err = $('login-error');
    err.textContent = '（Google 登入元件載入失敗，訪客模式不受影響）';
    err.hidden = false;
  };
  document.head.appendChild(script);
}

async function onGoogleCredential(response) {
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    state.user = data.user;
    $('login-view').hidden = true;
    // 換人了：先回到預設狀態再載入帳號資料，避免訪客資料和帳號資料混在一起
    state.budget = DEFAULT_BUDGET;
    state.stocks = DEFAULT_STOCKS;
    state.transactions = [];
    await enterApp();
  } catch {
    const err = $('login-error');
    err.textContent = '（登入驗證失敗，請再試一次）';
    err.hidden = false;
  }
}

function updateUserChip() {
  if (!state.user) return;
  $('user-chip').hidden = false;
  $('user-name').textContent = state.user.name;
  const avatar = $('user-avatar');
  if (state.user.picture) {
    avatar.src = state.user.picture;
  } else {
    avatar.hidden = true;
  }
}

async function enterApp() {
  updateUserChip();
  $('header-actions').hidden = false;
  $('app-main').hidden = false;
  await loadPortfolio();
  rebuildStockSelect();
  render();
  // 開頁時載入一次現價，之後由「↻ 更新報價」按鈕手動更新
  await loadQuotes();
  render();
}

// ---------- 啟動 ----------
(async function main() {
  initForm();
  initEditor();
  $('logout-btn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.reload();
  });

  let cfg = { authEnabled: false };
  try {
    cfg = await (await fetch('/api/config')).json();
  } catch { /* 當作未啟用登入 */ }
  state.authEnabled = cfg.authEnabled;

  if (cfg.authEnabled) {
    let me = { user: null };
    try {
      me = await (await fetch('/api/me')).json();
    } catch { /* 視為未登入 */ }
    if (me.user) {
      state.user = me.user;
    } else {
      showLoginBanner(cfg.googleClientId); // 訪客照常使用，資料存瀏覽器
    }
  }
  await enterApp();
})();
