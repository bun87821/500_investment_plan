'use strict';

const TOTAL_BUDGET = 5_000_000;

const STOCKS = [
  { id: '2330', name: '台積電', ticker: '2330', symbol: '2330.TW', market: '台股', currency: 'TWD', percent: 25 },
  { id: 'TSM', name: 'TSM ADR', ticker: 'TSM', symbol: 'TSM', market: '美股', currency: 'USD', percent: 25 },
  { id: 'HYNIX', name: 'SK hynix', ticker: '000660', symbol: '000660.KS', market: '韓股', currency: 'KRW', percent: 10 },
  { id: 'NVDA', name: 'NVIDIA', ticker: 'NVDA', symbol: 'NVDA', market: '美股', currency: 'USD', percent: 7 },
  { id: '2308', name: '台達電', ticker: '2308', symbol: '2308.TW', market: '台股', currency: 'TWD', percent: 7 },
  { id: '2383', name: '台光電', ticker: '2383', symbol: '2383.TW', market: '台股', currency: 'TWD', percent: 5 },
  { id: '3017', name: '奇鋐', ticker: '3017', symbol: '3017.TW', market: '台股', currency: 'TWD', percent: 5 },
  { id: 'MU', name: 'Micron', ticker: 'MU', symbol: 'MU', market: '美股', currency: 'USD', percent: 5 },
  { id: 'AVGO', name: 'Broadcom', ticker: 'AVGO', symbol: 'AVGO', market: '美股', currency: 'USD', percent: 3 },
  { id: '3324', name: '雙鴻', ticker: '3324', symbol: '3324.TW', market: '台股', currency: 'TWD', percent: 3 },
  { id: '2368', name: '金像電', ticker: '2368', symbol: '2368.TW', market: '台股', currency: 'TWD', percent: 3 },
  { id: '3037', name: '欣興', ticker: '3037', symbol: '3037.TW', market: '台股', currency: 'TWD', percent: 2 },
];

// 換算成台幣用的匯率報價代號
const FX_SYMBOLS = { USD: 'TWD=X', KRW: 'KRWTWD=X' };

const state = {
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

// ---------- 資料存取 ----------
async function loadPortfolio() {
  try {
    const res = await fetch('/api/portfolio');
    const data = await res.json();
    state.transactions = data.transactions || [];
  } catch {
    state.transactions = [];
  }
  // 伺服器是空的但本機瀏覽器有備份（例如 Railway 重新部署後）→ 還原
  const backup = localStorage.getItem('portfolio-backup');
  if (!state.transactions.length && backup) {
    try {
      const parsed = JSON.parse(backup);
      if (Array.isArray(parsed.transactions) && parsed.transactions.length) {
        state.transactions = parsed.transactions;
        savePortfolio();
        showNotice('伺服器上沒有資料，已從瀏覽器備份還原交易紀錄。');
      }
    } catch { /* 備份損毀就略過 */ }
  }
}

async function savePortfolio() {
  const payload = { transactions: state.transactions };
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
  const symbols = [...STOCKS.map((s) => s.symbol), ...Object.values(FX_SYMBOLS)];
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
  if (currency === 'TWD') return 1;
  const q = state.quotes[FX_SYMBOLS[currency]];
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

  const targetTWD = (TOTAL_BUDGET * stock.percent) / 100;
  const avgCost = shares > 0 ? costNative / shares : null;
  const price = quote ? quote.price : null;
  const valueTWD = price != null && fx != null ? shares * price * fx : shares === 0 ? 0 : null;
  const invested = investedKnown ? investedTWD : null;
  const pnl = valueTWD != null && invested != null ? valueTWD - invested : null;
  const progress = invested != null ? invested / targetTWD : null;
  const dayChange =
    quote && quote.previousClose ? (quote.price - quote.previousClose) / quote.previousClose : null;

  return { stock, shares, avgCost, invested, targetTWD, price, valueTWD, pnl, progress, dayChange };
}

// ---------- 畫面 ----------
function render() {
  const rows = STOCKS.map(computeStock);

  const totalInvested = rows.reduce((s, r) => s + (r.invested ?? 0), 0);
  const anyValueMissing = rows.some((r) => r.valueTWD == null);
  const totalValue = anyValueMissing ? null : rows.reduce((s, r) => s + r.valueTWD, 0);
  const totalPnl = totalValue != null ? totalValue - totalInvested : null;
  const overallProgress = totalInvested / TOTAL_BUDGET;

  $('kpi-invested').textContent = fmtTWD(totalInvested);
  $('kpi-invested-sub').textContent = '剩餘可投入 ' + fmtTWD(Math.max(TOTAL_BUDGET - totalInvested, 0));
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

  $('overall-progress-label').textContent =
    fmtTWD(totalInvested) + ' / ' + fmtTWD(TOTAL_BUDGET) + '（' + fmtPct(overallProgress) + '）';
  const bar = $('overall-progress-bar');
  bar.style.width = Math.min(overallProgress * 100, 100) + '%';
  bar.classList.toggle('over', overallProgress > 1);

  renderHoldings(rows, totalInvested, totalValue, totalPnl);
  renderTransactions();

  $('fx-info').textContent = ['USD', 'KRW']
    .map((c) => {
      const r = fxRate(c);
      return r ? `${c}/TWD ${fmtNum(r, c === 'KRW' ? 4 : 3)}` : null;
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
    const priceDigits = stock.currency === 'KRW' ? 0 : 2;
    tr.innerHTML = `
      <td>
        <div class="stock-name">${stock.name}</div>
        <div class="stock-meta"><span>${stock.ticker}</span><span class="chip">${stock.market}</span></div>
      </td>
      <td class="num">${stock.percent}%<span class="cell-sub">${fmtTWD(r.targetTWD)}</span></td>
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

  $('holdings-foot').innerHTML = `
    <tr>
      <td>合計</td>
      <td class="num">100%<span class="cell-sub">${fmtTWD(TOTAL_BUDGET)}</span></td>
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
    const stock = STOCKS.find((s) => s.id === t.stockId);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${t.date}</td>
      <td>${stock ? stock.name : t.stockId}</td>
      <td class="num ${t.shares < 0 ? 'down' : ''}">${fmtNum(t.shares, 4)}</td>
      <td class="num">${fmtNum(t.price, 4)} ${stock ? stock.currency : ''}</td>
      <td class="num">${t.twdCost != null ? fmtTWD(t.twdCost) : '（依匯率）'}</td>
      <td><button class="tx-del" data-id="${t.id}" title="刪除">✕</button></td>`;
    body.appendChild(tr);
  }
  $('tx-empty').hidden = sorted.length > 0;
}

// ---------- 事件 ----------
function initForm() {
  const select = $('tx-stock');
  for (const s of STOCKS) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.name}（${s.ticker}・${s.currency}）`;
    select.appendChild(opt);
  }
  $('tx-date').value = new Date().toISOString().slice(0, 10);

  $('tx-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const shares = parseFloat($('tx-shares').value);
    const price = parseFloat($('tx-price').value);
    if (!shares || Number.isNaN(price)) return;
    const twdRaw = $('tx-twd').value.trim();
    state.transactions.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      stockId: select.value,
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
    const blob = new Blob([JSON.stringify({ transactions: state.transactions }, null, 2)], {
      type: 'application/json',
    });
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
      state.transactions = data.transactions;
      await savePortfolio();
      render();
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
  await loadPortfolio();
  render();
  // 開頁時載入一次現價，之後由「↻ 更新報價」按鈕手動更新
  await loadQuotes();
  render();
})();
