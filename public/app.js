'use strict';

const DEFAULT_STOCKS = [
  { id: '2330', name: '台積電', symbol: '2330.TW', market: '台股', currency: 'TWD', category: '晶圓代工', percent: 25 },
  { id: '006208', name: '富邦台50', symbol: '006208.TW', market: '台灣', currency: 'TWD', category: '大盤', percent: 0 },
  { id: '0050', name: '元大台灣50', symbol: '0050.TW', market: '台灣', currency: 'TWD', category: '大盤', percent: 0 },
  { id: '1802', name: '台玻', symbol: '1802.TW', market: '台灣', currency: 'TWD', category: '原料供應商', percent: 0 },
  { id: 'TSM', name: 'TSM ADR', symbol: 'TSM', market: '美股', currency: 'USD', category: '晶圓代工', percent: 25 },
  { id: 'HYNIX', name: 'SK hynix', symbol: '000660.KS', market: '韓股', currency: 'KRW', category: '記憶體', percent: 10 },
  { id: 'NVDA', name: 'NVIDIA', symbol: 'NVDA', market: '美股', currency: 'USD', category: 'IC設計', percent: 7 },
  { id: '2308', name: '台達電', symbol: '2308.TW', market: '台股', currency: 'TWD', category: '電源', percent: 7 },
  { id: '2345', name: '智邦', symbol: '2345.TW', market: '台灣', currency: 'TWD', category: '網路通訊', percent: 0 },
  { id: '2383', name: '台光電', symbol: '2383.TW', market: '台股', currency: 'TWD', category: '銅箔基板', percent: 5 },
  { id: '2454', name: '聯發科', symbol: '2454.TW', market: '台灣', currency: 'TWD', category: 'IC設計', percent: 0 },
  { id: '2615', name: '萬海', symbol: '2615.TW', market: '台灣', currency: 'TWD', category: '航運', percent: 0 },
  { id: '3017', name: '奇鋐', symbol: '3017.TW', market: '台股', currency: 'TWD', category: '散熱', percent: 5 },
  { id: '3231', name: '緯創', symbol: '3231.TW', market: '台灣', currency: 'TWD', category: '機櫃', percent: 0 },
  { id: 'MU', name: 'Micron', symbol: 'MU', market: '美股', currency: 'USD', category: '記憶體', percent: 5 },
  { id: 'AVGO', name: 'Broadcom', symbol: 'AVGO', market: '美股', currency: 'USD', category: 'IC設計', percent: 3 },
  { id: '3324', name: '雙鴻', symbol: '3324.TWO', market: '上櫃', currency: 'TWD', category: '散熱', percent: 3 },
  { id: '2368', name: '金像電', symbol: '2368.TW', market: '台股', currency: 'TWD', category: 'PCB/載板', percent: 3 },
  { id: '3037', name: '欣興', symbol: '3037.TW', market: '台股', currency: 'TWD', category: 'PCB/載板', percent: 2 },
  { id: '3653', name: '健策', symbol: '3653.TW', market: '台灣', currency: 'TWD', category: '散熱', percent: 0 },
  { id: '5009', name: '榮剛', symbol: '5009.TWO', market: '台北', currency: 'TWD', category: '傳產', percent: 0 },
  { id: '6770', name: '力積電', symbol: '6770.TW', market: '台灣', currency: 'TWD', category: '半導體', percent: 0 },
  { id: '00929', name: '復華台灣科技優息', symbol: '00929.TW', market: '台灣', currency: 'TWD', category: '大盤', percent: 0 },
  { id: '6788', name: '華景電', symbol: '6788.TWO', market: '台北', currency: 'TWD', category: '廠務', percent: 0 },
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

// 共用計算（平均成本重放等）住在 portfolio-math.js，前後端共用同一份實作
const fxSymbolOf = PortfolioMath.fxSymbolOf;

const state = {
  plans: [], // 具名投資規劃 { id, name, budget, allocations }；載入時由遷移保證至少有一個
  activePlanId: null, // 目前計畫（分頁）
  stocks: DEFAULT_STOCKS,
  transactions: [],
  snapshots: [],
  ignoredEvents: [], // 已忽略的分割/配息提醒（跨裝置同步）
  events: null, // /api/events 回傳的分割與配息事件
  rev: 0, // 伺服器資料版本（樂觀鎖）
  quotes: {},
  quoteErrors: {},
  fetchedAt: null,
  usingCachedQuotes: false,
  authEnabled: false,
  user: null, // { sub, email, name, picture }
};

// 各使用者在瀏覽器端的備份各自存一份；訪客（未登入）模式的正式儲存位置就是這裡
const backupKey = () => 'portfolio-backup:' + (state.user?.sub || 'local');
const newTxId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
// 目前計畫記在瀏覽器，依使用者分開
const activePlanKey = () => 'active-plan:' + (state.user?.sub || 'local');

// 目前計畫，以及「只屬於它」的交易與總預算——畫面上所有計算都經過這三個入口
const activePlan = () => state.plans.find((p) => p.id === state.activePlanId) || state.plans[0] || null;
// 總預算留空（null／不存在）＝純記錄型計畫；所有與目標有關的顯示都經過這兩個入口
const planBudget = () => (Number(activePlan()?.budget) > 0 ? Number(activePlan().budget) : null);
const hasTarget = () => planBudget() != null;
const planTxs = () => PortfolioMath.transactionsInPlan(state.transactions, activePlan()?.id);
// 目標配置比例跟著計畫走：標的清單全帳號共用，percent 由目前計畫的 allocations 提供
const planPercentOf = (stockId) => Number(activePlan()?.allocations?.[stockId]) || 0;
const planStocks = () => state.stocks.map((s) => ({ ...s, percent: planPercentOf(s.id) }));

// 啟用登入但尚未登入 → 訪客模式：資料只存瀏覽器 localStorage，不打伺服器
const isGuest = () => state.authEnabled && !state.user;

const $ = (id) => document.getElementById(id);

function collapseKeyForCard(card, index) {
  if (card.dataset.collapseKey) return card.dataset.collapseKey;
  if (card.id) return card.id;
  const stableClass = [...card.classList].find((name) => name !== 'card');
  return stableClass || `section-${index + 1}`;
}

function isCardCollapsed(key) {
  const stored = localStorage.getItem(`section-collapsed:${key}`);
  if (stored != null) return stored === '1';
  return key === 'allocation-card' && localStorage.getItem('allocation-collapsed') === '1';
}

function setCardCollapsed(card, collapsed) {
  const body = card.querySelector(':scope > .collapsible-body');
  const toggle = card.querySelector(':scope > .card-head .section-collapse-toggle');
  if (!body || !toggle) return;

  body.hidden = collapsed;
  card.classList.toggle('is-collapsed', collapsed);
  toggle.textContent = collapsed ? '展開' : '收合';
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.setAttribute('aria-label', `${collapsed ? '展開' : '收合'}${card.dataset.collapseTitle || '區塊'}`);
}

function ensureCardHeader(card) {
  const first = card.firstElementChild;
  if (first?.classList.contains('card-head')) return first;

  const head = document.createElement('div');
  head.className = 'card-head';
  const title = first?.tagName === 'H2' ? first : document.createElement('h2');
  if (title !== first) title.textContent = card.dataset.collapseTitle || '區塊';
  card.insertBefore(head, first);
  head.appendChild(title);
  return head;
}

function initCollapsibleSections() {
  document.querySelectorAll('#app-main .card[data-collapsible]').forEach((card, index) => {
    if (card.dataset.collapseReady === '1') return;

    const key = collapseKeyForCard(card, index);
    const head = ensureCardHeader(card);
    const body = document.createElement('div');
    body.className = 'collapsible-body';
    body.id = `collapsible-body-${key}`;
    while (head.nextSibling) body.appendChild(head.nextSibling);
    card.appendChild(body);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn btn-ghost section-collapse-toggle';
    toggle.setAttribute('aria-controls', body.id);
    head.appendChild(toggle);

    toggle.addEventListener('click', () => {
      const collapsed = !card.classList.contains('is-collapsed');
      localStorage.setItem(`section-collapsed:${key}`, collapsed ? '1' : '0');
      setCardCollapsed(card, collapsed);
    });

    card.dataset.collapseReady = '1';
    setCardCollapsed(card, isCardCollapsed(key));
  });
}

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
const parseDecimalInput = (value) => {
  const normalized = String(value ?? '').trim().replace(',', '.');
  return normalized === '' ? NaN : parseFloat(normalized);
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function setSyncStatus(kind, detail = '') {
  const el = $('sync-status');
  if (!el) return;
  const labels = {
    loading: '同步狀態確認中',
    guest: '訪客本機',
    saving: '儲存中',
    saved: 'Google 雲端已儲存',
    local: '暫存在本機',
    conflict: '已載入雲端新版',
  };
  el.textContent = detail || labels[kind] || '';
  el.className = `sync-status ${kind || ''}`;
}

const tickerOf = (symbol) => String(symbol).split('.')[0];
const quoteUrlOf = (symbol) => {
  const s = encodeURIComponent(String(symbol || '').trim());
  return /\.TW$|\.TWO$/.test(String(symbol || '')) ? `https://tw.stock.yahoo.com/quote/${s}` : `https://finance.yahoo.com/quote/${s}`;
};

function mergeDefaultStocks(stocks) {
  const defaultById = new Map(DEFAULT_STOCKS.map((s) => [s.id, s]));
  const merged = (Array.isArray(stocks) ? stocks : [])
    .filter((s) => s && s.id && s.symbol)
    .map((s) => ({
      ...s,
      category: s.category || defaultById.get(s.id)?.category || '未分類',
    }));
  const seenIds = new Set(merged.map((s) => s.id));
  const seenSymbols = new Set(merged.map((s) => String(s.symbol).toUpperCase()));
  for (const s of DEFAULT_STOCKS) {
    if (!seenIds.has(s.id) && !seenSymbols.has(String(s.symbol).toUpperCase())) merged.push({ ...s });
  }
  return merged;
}

// ---------- 資料存取 ----------
function applyDoc(raw) {
  // 舊格式在載入時就地遷移（記憶體），下一次存檔才落地到伺服器
  const data = PortfolioMath.migratePortfolio({ ...raw, stocks: Array.isArray(raw.stocks) && raw.stocks.length ? raw.stocks : state.stocks });
  if (data.rev !== undefined) state.rev = Number(data.rev) || 0;
  state.plans = data.plans;
  // 帳號資料還沒有標的清單（新帳號、或只用 API 寫入交易的資料）→ 標的與目標配置一起套用預設
  if (!(Array.isArray(raw.stocks) && raw.stocks.length) && state.plans[0] && !Object.keys(state.plans[0].allocations || {}).length) {
    state.plans[0].allocations = Object.fromEntries(DEFAULT_STOCKS.filter((s) => s.percent > 0).map((s) => [s.id, s.percent]));
  }
  state.transactions = Array.isArray(data.transactions) ? data.transactions : [];
  state.snapshots = Array.isArray(data.snapshots) ? data.snapshots : [];
  state.ignoredEvents = Array.isArray(data.ignoredEvents) ? data.ignoredEvents : [];
  state.stocks = mergeDefaultStocks(Array.isArray(data.stocks) && data.stocks.length ? data.stocks : state.stocks);
  selectPlan(localStorage.getItem(activePlanKey()));
}

// 切到指定計畫；找不到（例如已被刪除）就退回第一個計畫
function selectPlan(planId) {
  const before = state.activePlanId;
  const found = state.plans.find((p) => p.id === planId);
  state.activePlanId = (found || state.plans[0])?.id || null;
  if (state.activePlanId) localStorage.setItem(activePlanKey(), state.activePlanId);
  // 換了計畫就把交易表單的預設勾選改成新的目前計畫（正在編輯某筆交易時不動）
  if (state.activePlanId !== before && !editingTxId) renderTxPlans(null);
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

// 完全沒有資料可套用時（訪客且無備份）applyDoc 不會跑到，這裡補上預設計畫
function ensurePlans() {
  state.stocks = mergeDefaultStocks(state.stocks);
  if (!state.plans.length) {
    state.plans = PortfolioMath.migratePortfolio({ stocks: state.stocks }).plans;
    selectPlan(localStorage.getItem(activePlanKey()));
  }
}

async function loadPortfolio() {
  if (isGuest()) {
    // 訪客模式：直接從瀏覽器讀（也相容啟用登入前的舊 key）
    tryApplyBackup(backupKey()) || tryApplyBackup('portfolio-backup');
    ensurePlans();
    setSyncStatus('guest', '訪客本機：這台裝置限定');
    return;
  }
  try {
    setSyncStatus('loading');
    const res = await fetch('/api/portfolio');
    if (res.ok) {
      applyDoc(await res.json());
      setSyncStatus('saved', state.user ? `Google 雲端：${state.user.email || state.user.name || '已登入'}` : '伺服器已載入');
    }
  } catch {
    setSyncStatus('local', '讀取雲端失敗：暫存在本機');
    /* 保持預設值 */
  }
  // 伺服器是空的但瀏覽器有備份 → 還原。依序找：這個帳號的備份、訪客模式的資料
  //（剛登入的新帳號會把訪客時期建立的計畫帶上雲端）、舊版未分帳號的備份
  if (!state.transactions.length) {
    const restored =
      tryApplyBackup(backupKey()) || tryApplyBackup('portfolio-backup:local') || tryApplyBackup('portfolio-backup');
    if (restored) {
      await savePortfolio({ includeSnapshots: true });
      showNotice('已將瀏覽器中的紀錄同步到你的帳號。');
    }
  }
  ensurePlans();
}

async function savePortfolio({ includeSnapshots = false } = {}) {
  const backup = {
    plans: state.plans,
    stocks: state.stocks,
    transactions: state.transactions,
    snapshots: state.snapshots,
    ignoredEvents: state.ignoredEvents,
  };
  const payload = {
    plans: state.plans,
    stocks: state.stocks,
    transactions: state.transactions,
    ignoredEvents: state.ignoredEvents,
    rev: state.rev,
  };
  if (includeSnapshots || isGuest()) payload.snapshots = state.snapshots;
  localStorage.setItem(backupKey(), JSON.stringify(backup));
  if (isGuest()) {
    setSyncStatus('guest', '訪客本機：這台裝置限定');
    return true; // 訪客模式只存瀏覽器
  }
  try {
    setSyncStatus('saving');
    const res = await fetch('/api/portfolio', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      showNotice('登入已過期，資料暫存在瀏覽器中 — 請重新整理頁面登入後再操作一次。');
      setSyncStatus('local', '登入過期：暫存在本機');
      return false;
    }
    if (res.status === 409) {
      // 其他裝置改過資料：改用伺服器最新版，提醒使用者重做這次操作
      const data = await res.json().catch(() => ({}));
      if (data.current) {
        applyDoc(data.current);
        rebuildStockSelect();
        render();
      }
      showNotice('資料已在其他裝置更新，畫面已載入最新版本 — 請確認後再操作一次。');
      setSyncStatus('conflict');
      return false;
    }
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (data.rev !== undefined) state.rev = Number(data.rev) || state.rev;
    setSyncStatus('saved', state.user ? `Google 雲端已儲存：${state.user.email || state.user.name || '已登入'}` : '伺服器已儲存');
    return true;
  } catch {
    showNotice('儲存到伺服器失敗，資料暫存在瀏覽器中，請稍後重試或匯出備份。');
    setSyncStatus('local', '儲存失敗：暫存在本機');
    return false;
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

// ---------- 分割與配息提醒 ----------
async function loadEvents() {
  const held = state.stocks.filter((s) => state.transactions.some((t) => t.stockId === s.id));
  if (!held.length) {
    state.events = null;
    renderAlerts();
    return;
  }
  try {
    const res = await fetch('/api/events?symbols=' + encodeURIComponent(held.map((s) => s.symbol).join(',')));
    if (!res.ok) throw new Error();
    state.events = (await res.json()).events || {};
  } catch {
    state.events = null; // 抓不到事件就不提醒
  }
  renderAlerts();
}

function collectAlerts() {
  if (!state.events) return [];
  const alerts = [];
  for (const stock of state.stocks) {
    const ev = state.events[stock.symbol];
    if (!ev) continue;
    for (const s of PortfolioMath.detectUnappliedSplits({
      stock,
      transactions: state.transactions,
      splits: ev.splits,
      ignored: state.ignoredEvents,
    })) {
      alerts.push({ type: 'split', stock, ...s });
    }
    for (const d of PortfolioMath.detectUnrecordedDividends({
      stock,
      transactions: state.transactions,
      dividends: ev.dividends,
      splits: ev.splits,
      ignored: state.ignoredEvents,
    })) {
      alerts.push({ type: 'div', stock, ...d });
    }
  }
  return alerts;
}

async function ignoreAllDividendAlerts(alerts = collectAlerts()) {
  const keys = alerts
    .filter((a) => a.type === 'div')
    .map((a) => PortfolioMath.eventKey(a.type, a.stock.symbol, a.date));
  if (!keys.length) return;
  state.ignoredEvents = [...new Set([...state.ignoredEvents, ...keys])];
  await savePortfolio();
  renderAlerts();
}

function renderAlerts() {
  const box = $('alerts');
  const alerts = collectAlerts();
  box.innerHTML = '';
  const dividendAlerts = alerts.filter((a) => a.type === 'div');
  if (dividendAlerts.length) {
    const toolbar = document.createElement('div');
    toolbar.className = 'alert-toolbar';
    toolbar.innerHTML = `<span>配息提醒 ${dividendAlerts.length} 筆</span><button type="button" class="alert-ignore-divs">忽略全部配息</button>`;
    toolbar.querySelector('.alert-ignore-divs').addEventListener('click', () => ignoreAllDividendAlerts(alerts));
    box.appendChild(toolbar);
  }
  for (const a of alerts) {
    const div = document.createElement('div');
    div.className = 'notice alert-banner';
    const key = PortfolioMath.eventKey(a.type, a.stock.symbol, a.date);
    if (a.type === 'split') {
      div.innerHTML = `📢 <b>${esc(a.stock.name)}</b> 於 ${esc(a.date)} 股票分割 1→${fmtNum(a.ratio, 4)}，你的交易紀錄尚未調整。
        <span class="alert-actions"><button class="alert-apply">套用分割</button><button class="alert-ignore">忽略</button></span>`;
      div.querySelector('.alert-apply').addEventListener('click', async () => {
        // 分割是客觀事實：一次補齊每個在分割日持有這檔標的的計畫，不必逐個分頁重按
        const holders = PortfolioMath.plansHoldingOn(state.plans, state.transactions, a.stock.id, a.date);
        for (const planId of holders) {
          state.transactions.push({
            id: 'split-' + a.stock.id + '-' + a.date + '-' + planId,
            stockId: a.stock.id,
            date: a.date,
            kind: 'split',
            ratio: a.ratio,
            plans: [planId],
          });
        }
        await savePortfolio();
        render();
        renderAlerts();
        loadHistory();
      });
    } else {
      div.innerHTML = `💰 <b>${esc(a.stock.name)}</b> 於 ${esc(a.date)} 除息，每股 ${fmtNum(a.perShare, 4)} ${esc(
        a.stock.currency
      )}（分割調整後 ${fmtNum(a.shares, 2)} 股，估 ${fmtNum(a.estimatedAmount, 2)} ${esc(a.stock.currency)}），尚未記帳。
        <span class="alert-actions"><button class="alert-fill">帶入配息表單</button><button class="alert-ignore">忽略</button></span>`;
      div.querySelector('.alert-fill').addEventListener('click', () => {
        $('tx-kind').value = 'dividend';
        updateTxKindUI();
        $('tx-stock').value = a.stock.id;
        $('tx-date').value = a.date;
        $('tx-amount').value = String(Math.round(a.estimatedAmount * 100) / 100);
        $('tx-twd').value = '';
        renderTxPlans(PortfolioMath.plansHoldingOn(state.plans, state.transactions, a.stock.id, a.date));
        $('tx-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
    div.querySelector('.alert-ignore').addEventListener('click', async () => {
      state.ignoredEvents.push(key);
      await savePortfolio();
      renderAlerts();
    });
    box.appendChild(div);
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
  return PortfolioMath.fxRateOf(currency, state.quotes);
}

// 平均成本重放的實作在 portfolio-math.js；這裡只把 state 轉接成純函式參數
function computeStock(stock) {
  return computeStockFor(activePlan(), stock);
}

// 指定計畫視角下的重放（快照要對每個計畫各算一次）
function computeStockFor(plan, stock) {
  const withPercent = { ...stock, percent: Number(plan?.allocations?.[stock.id]) || 0 };
  return PortfolioMath.computeStock(
    withPercent,
    PortfolioMath.transactionsInPlan(state.transactions, plan?.id),
    state.quotes,
    Number(plan?.budget) > 0 ? Number(plan.budget) : 0
  );
}

function sortedByTargetPercent(items, stockOf = (x) => x) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const pa = Number(stockOf(a.item).percent) || 0;
      const pb = Number(stockOf(b.item).percent) || 0;
      return pb - pa || a.index - b.index;
    })
    .map(({ item }) => item);
}

function todayTaipei() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// ---------- 計畫分頁 ----------

function renderPlanTabs() {
  syncTxPlansOptions();
  const list = $('plan-tab-list');
  list.innerHTML = '';
  for (const p of state.plans) {
    const btn = document.createElement('button');
    btn.className = 'plan-tab' + (p.id === activePlan()?.id ? ' active' : '');
    btn.textContent = p.name;
    btn.dataset.planId = p.id;
    btn.setAttribute('aria-current', p.id === activePlan()?.id ? 'page' : 'false');
    list.appendChild(btn);
  }
}

// 切換分頁：換一組篩過的交易重跑同一套計算，歷史區間也要跟著重抓
async function switchPlan(planId) {
  if (planId === activePlan()?.id) return;
  selectPlan(planId);
  closePlanCard();
  render();
  await loadHistory();
}

let deletingPlanId = null; // 正在等待打字確認的計畫

// 管理計畫：每個計畫一列，可改名、改總預算、調順序、刪除
function renderPlanRows() {
  const wrap = $('plan-rows');
  wrap.innerHTML = '';
  state.plans.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'plan-row';
    row.dataset.planId = p.id;
    row.innerHTML = `
      <input class="plan-row-name" type="text" maxlength="20" value="${esc(p.name)}" aria-label="計畫名稱" />
      <input class="plan-row-budget" type="text" inputmode="decimal" value="${Number(p.budget) > 0 ? Number(p.budget) : ''}" placeholder="不設目標" aria-label="總預算" />
      <button type="button" class="btn btn-ghost plan-move" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="上移">↑</button>
      <button type="button" class="btn btn-ghost plan-move" data-dir="1" ${i === state.plans.length - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
      <button type="button" class="btn btn-ghost plan-delete" ${state.plans.length < 2 ? 'disabled title="最後一個計畫不能刪除"' : ''}>刪除</button>`;
    wrap.appendChild(row);

    if (deletingPlanId === p.id) {
      const orphans = PortfolioMath.transactionsOnlyInPlan(state.transactions, p.id).length;
      const confirmRow = document.createElement('div');
      confirmRow.className = 'plan-confirm';
      confirmRow.innerHTML = `
        <p>刪除「${esc(p.name)}」將連帶刪除 <strong>${orphans}</strong> 筆只屬於它的交易，無法復原。同時掛在其他計畫的交易會保留。</p>
        <div class="plan-confirm-row">
          <input type="text" id="plan-confirm-input" placeholder="輸入「${esc(p.name)}」確認" aria-label="輸入計畫名稱確認" />
          <button type="button" class="btn btn-primary" id="plan-confirm-btn" disabled>確認刪除</button>
          <button type="button" class="btn" id="plan-confirm-cancel">取消</button>
        </div>`;
      wrap.appendChild(confirmRow);
    }
  });
}

// 複製來源下拉：不選＝建立空白計畫
function renderPlanCopyFrom() {
  const sel = $('plan-copy-from');
  sel.innerHTML = '<option value="">（不複製，建立空白計畫）</option>';
  for (const p of state.plans) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  updatePlanCopyUI();
}

function updatePlanCopyUI() {
  const from = $('plan-copy-from').value;
  $('plan-copy-options').hidden = !from;
  $('plan-copy-hint').hidden = !from || !$('plan-copy-txs').checked;
}

function openPlanCard() {
  deletingPlanId = null;
  $('plan-name').value = '';
  $('plan-budget').value = '';
  $('plan-copy-txs').checked = false;
  $('plan-copy-alloc').checked = true;
  renderPlanCopyFrom();
  renderPlanRows();
  $('plan-card').hidden = false;
  $('plan-name').focus();
}

function closePlanCard() {
  deletingPlanId = null;
  $('plan-card').hidden = true;
}

async function deletePlan(planId) {
  const beforeDelete = {
    plans: state.plans,
    transactions: state.transactions,
    snapshots: state.snapshots,
    activePlanId: state.activePlanId,
  };
  const doc = PortfolioMath.removePlan(
    { plans: state.plans, transactions: state.transactions, snapshots: state.snapshots },
    planId
  );
  state.plans = doc.plans;
  state.transactions = doc.transactions;
  state.snapshots = doc.snapshots;
  selectPlan(state.activePlanId); // 刪掉的是目前計畫 → 退回第一個
  // 刪計畫會一併移除該計畫的快照；儲存是合併語意，不帶 snapshots 的話伺服器會留下孤兒快照
  const saved = await savePortfolio({ includeSnapshots: true });
  if (!saved) {
    const conflictReloadedPlan = state.plans.some((p) => p.id === planId);
    if (!conflictReloadedPlan) {
      state.plans = beforeDelete.plans;
      state.transactions = beforeDelete.transactions;
      state.snapshots = beforeDelete.snapshots;
      selectPlan(beforeDelete.activePlanId);
    }
    deletingPlanId = planId;
    $('plan-card').hidden = false;
    render();
    renderPlanRows();
    return;
  }
  closePlanCard();
  render();
  await loadHistory();
}

// 計畫識別碼不隨名稱改變，且不重複使用——刪掉的計畫留下的舊 id
//（其他裝置的 localStorage、舊備份檔）不會意外對到新建的計畫
function newPlanId() {
  return 'plan-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function initPlans() {
  $('plan-tab-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.plan-tab');
    if (btn) switchPlan(btn.dataset.planId);
  });
  $('plan-manage-btn').addEventListener('click', () => {
    if ($('plan-card').hidden) openPlanCard();
    else closePlanCard();
  });
  $('plan-cancel').addEventListener('click', closePlanCard);
  $('tx-plans').addEventListener('change', updateTxPlansHint);
  $('plan-copy-from').addEventListener('change', updatePlanCopyUI);
  $('plan-copy-txs').addEventListener('change', updatePlanCopyUI);

  // 管理計畫的列：改名、改總預算、調順序、刪除
  $('plan-rows').addEventListener('change', async (e) => {
    const row = e.target.closest('.plan-row');
    if (!row) return;
    const plan = state.plans.find((p) => p.id === row.dataset.planId);
    if (!plan) return;
    if (e.target.classList.contains('plan-row-name')) {
      const name = e.target.value.trim();
      if (!name) return (e.target.value = plan.name);
      plan.name = name;
    } else if (e.target.classList.contains('plan-row-budget')) {
      // 清空＝改成純記錄型計畫；要填就必須是正數
      const raw = e.target.value.trim();
      if (raw === '') plan.budget = null;
      else {
        const budget = parseDecimalInput(raw);
        if (!(budget > 0)) return (e.target.value = plan.budget ?? '');
        plan.budget = budget;
      }
    } else return;
    await savePortfolio();
    render();
  });

  $('plan-rows').addEventListener('input', (e) => {
    if (e.target.id !== 'plan-confirm-input') return;
    const plan = state.plans.find((p) => p.id === deletingPlanId);
    $('plan-confirm-btn').disabled = !plan || e.target.value.trim() !== plan.name;
  });

  $('plan-rows').addEventListener('click', async (e) => {
    if (e.target.id === 'plan-confirm-cancel') {
      deletingPlanId = null;
      return renderPlanRows();
    }
    if (e.target.id === 'plan-confirm-btn') return deletePlan(deletingPlanId);

    const row = e.target.closest('.plan-row');
    if (!row) return;
    const idx = state.plans.findIndex((p) => p.id === row.dataset.planId);
    if (idx < 0) return;
    if (e.target.classList.contains('plan-move')) {
      const to = idx + Number(e.target.dataset.dir);
      if (to < 0 || to >= state.plans.length) return;
      [state.plans[idx], state.plans[to]] = [state.plans[to], state.plans[idx]];
      renderPlanRows();
      await savePortfolio();
      render();
    } else if (e.target.classList.contains('plan-delete')) {
      deletingPlanId = state.plans[idx].id;
      renderPlanRows();
      $('plan-confirm-input')?.focus();
    }
  });
  $('plan-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('plan-name').value.trim();
    const source = state.plans.find((p) => p.id === $('plan-copy-from').value);
    const copyAlloc = source && $('plan-copy-alloc').checked;
    const budgetRaw = $('plan-budget').value.trim();
    // 複製目標金額時，總預算欄留空就沿用來源的
    // 留空＝不設目標的純記錄型計畫；若勾了複製目標金額則沿用來源
    const budget = budgetRaw === '' ? (copyAlloc ? source.budget ?? null : null) : parseDecimalInput(budgetRaw);
    if (!name) return alert('請填計畫名稱');
    if (budget != null && !(budget > 0)) return alert('總預算留空即可，要填就必須是正數');
    const plan = {
      id: newPlanId(),
      name,
      budget,
      allocations: copyAlloc ? { ...source.allocations } : {},
    };
    state.plans.push(plan);
    if (source && $('plan-copy-txs').checked) {
      // 獨立副本：之後在新分頁改動或刪除都不影響來源計畫
      state.transactions.push(
        ...PortfolioMath.copyTransactionsToPlan(state.transactions, source.id, plan.id, newTxId)
      );
    }
    selectPlan(plan.id);
    closePlanCard();
    await savePortfolio();
    render();
    await loadHistory();
  });
}

// ---------- 畫面 ----------
function render() {
  renderPlanTabs();
  const rows = sortedByTargetPercent(planStocks().map(computeStock), (r) => r.stock);
  const hasHoldingActivity = (r) =>
    r.shares !== 0 ||
    (r.invested ?? 0) !== 0 ||
    (r.valueTWD ?? 0) !== 0 ||
    (r.realized ?? 0) !== 0 ||
    (r.dividends ?? 0) !== 0;
  const holdingRows = rows.filter((r) => Number(r.stock.percent) > 0 || hasHoldingActivity(r));
  const targetStockCount = rows.filter((r) => Number(r.stock.percent) > 0).length;

  const totalInvested = rows.reduce((s, r) => s + (r.invested ?? 0), 0);
  const anyValueMissing = rows.some((r) => r.valueTWD == null);
  const totalValue = anyValueMissing ? null : rows.reduce((s, r) => s + r.valueTWD, 0);
  const totalPnl = totalValue != null ? totalValue - totalInvested : null;
  const overallProgress = hasTarget() ? totalInvested / planBudget() : null;

  $('subtitle').textContent = hasTarget()
    ? `總預算 ${fmtTWD(planBudget())} ・ ${targetStockCount} 檔標的目標配置`
    : `純記錄型計畫 ・ 只記錄持股與損益，不設目標`;

  $('kpi-invested').textContent = fmtTWD(totalInvested);
  $('kpi-invested-sub').textContent = hasTarget()
    ? '剩餘可投入 ' + fmtTWD(Math.max(planBudget() - totalInvested, 0))
    : '';
  $('kpi-value').textContent = fmtTWD(totalValue);
  $('kpi-value-sub').textContent = state.fetchedAt
    ? '報價時間 ' + new Date(state.fetchedAt).toLocaleString('zh-TW', { hour12: false })
    : '';
  const pnlEl = $('kpi-pnl');
  pnlEl.textContent = totalPnl == null ? '—' : signed(totalPnl, (n) => fmtTWD(n));
  pnlEl.className = 'kpi-value ' + pnlClass(totalPnl ?? 0);
  $('kpi-pnl-sub').textContent =
    totalPnl != null && totalInvested > 0 ? '報酬率 ' + signed(totalPnl / totalInvested, fmtPct) : '';

  const totalRealizedTrade = rows.reduce((s, r) => s + (r.realized ?? 0), 0);
  const totalDividends = rows.reduce((s, r) => s + (r.dividends ?? 0), 0);
  const totalRealized = totalRealizedTrade + totalDividends;
  const realizedEl = $('kpi-realized');
  realizedEl.textContent = signed(totalRealized, (n) => fmtTWD(n));
  realizedEl.className = 'kpi-value ' + pnlClass(totalRealized);
  $('kpi-realized-sub').textContent = totalDividends !== 0 ? '含股利 ' + fmtTWD(totalDividends) : '賣出損益＋股利';

  // 純記錄型計畫：達成率、進度條、再平衡都沒有意義，整塊收起來
  $('kpi-progress-card').hidden = !hasTarget();
  $('overall-progress-card').hidden = !hasTarget();
  $('rebalance-card').hidden = !hasTarget();
  $('basis-target-btn').hidden = !hasTarget();
  if (!hasTarget() && chartBasis === 'target') {
    chartBasis = 'value';
    basisLocked = false;
  }
  if (hasTarget()) {
    $('kpi-progress').textContent = fmtPct(overallProgress);
    $('kpi-progress-sub').textContent = '目標 ' + fmtTWD(planBudget());
    $('overall-progress-label').textContent =
      fmtTWD(totalInvested) + ' / ' + fmtTWD(planBudget()) + '（' + fmtPct(overallProgress) + '）';
    const bar = $('overall-progress-bar');
    bar.style.width = Math.min(overallProgress * 100, 100) + '%';
    bar.classList.toggle('over', overallProgress > 1);
  }

  renderHoldings(holdingRows, totalInvested, totalValue, totalPnl);
  renderRebalance(rows, totalValue);
  renderSnapshotChart(rows);
  renderDonut(rows);
  renderTransactions();
  renderMonthlyReport();

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

function snapshotFromRows(rows, source = 'manual', planId = activePlan()?.id ?? null) {
  const totalInvested = rows.reduce((s, r) => s + (r.invested ?? 0), 0);
  const anyValueMissing = rows.some((r) => r.valueTWD == null);
  const totalValue = anyValueMissing ? null : rows.reduce((s, r) => s + r.valueTWD, 0);
  const pnl = totalValue != null ? totalValue - totalInvested : null;
  const pnlPct = pnl != null && totalInvested > 0 ? pnl / totalInvested : null;
  // 只留圖表會讀的欄位（見 portfolio-math 的 slimSnapshot）；rows 只用來加總
  return PortfolioMath.slimSnapshot({
    date: todayTaipei(),
    planId,
    at: Date.now(),
    source,
    totalInvested,
    totalValue,
    pnl,
    pnlPct,
  });
}

function upsertLocalSnapshot(snapshot) {
  state.snapshots = PortfolioMath.upsertSnapshots(state.snapshots, [snapshot]);
}

// ---------- 歷史市值回填 ----------
const BENCH_SYMBOL = '0050.TW';
let histDisplayRange = localStorage.getItem('hist-range') || '3mo';
let benchmarkOn = localStorage.getItem('benchmark-on') === '1';
const HIST_DISPLAY_DAYS = { '1mo': 31, '3mo': 93, '6mo': 186, '1y': 372, all: Infinity };

async function loadHistory() {
  const txs = planTxs();
  const held = state.stocks.filter((s) => txs.some((t) => t.stockId === s.id));
  if (!held.length) {
    state.history = null;
    return;
  }
  const firstTx = txs.reduce((min, t) => (t.date < min ? t.date : min), '9999');
  const days = (Date.now() - new Date(firstTx).getTime()) / 86400_000;
  const range =
    days <= 25 ? '1mo' : days <= 85 ? '3mo' : days <= 175 ? '6mo' : days <= 360 ? '1y' : days <= 720 ? '2y' : days <= 1800 ? '5y' : 'max';
  const fxSyms = [...new Set(held.map((s) => fxSymbolOf(s.currency)).filter(Boolean))];
  const symbols = [...new Set([...held.map((s) => s.symbol), ...fxSyms, BENCH_SYMBOL])];
  state.historyLoading = true;
  try {
    const res = await fetch(`/api/history?range=${range}&symbols=${encodeURIComponent(symbols.join(','))}`);
    if (!res.ok) throw new Error();
    state.history = await res.json();
  } catch {
    state.history = null; // 圖表退回快照資料
  } finally {
    state.historyLoading = false;
  }
  render();
}

// 歷史回推的實作在 portfolio-math.js；這裡只把 state 轉接成純函式參數
function computeDailySeries() {
  return PortfolioMath.computeDailySeries({
    history: state.history,
    stocks: state.stocks,
    transactions: planTxs(),
    quotes: state.quotes,
    budget: planBudget(),
    benchSymbol: BENCH_SYMBOL,
    today: todayTaipei(),
  });
}

// XIRR 的實作在 portfolio-math.js；這裡只把 state 轉接成純函式參數
function computeXirr(rows) {
  return PortfolioMath.computeXirr({
    rows,
    stocks: state.stocks,
    transactions: planTxs(),
    quotes: state.quotes,
    today: todayTaipei(),
  });
}

// 圖表資料來源：優先用歷史回推，抓不到歷史價時退回每日快照
function getChartSeries() {
  const computed = computeDailySeries();
  if (computed && computed.length) {
    return {
      source: 'history',
      points: computed.map((p) => ({
        date: p.date,
        totalValue: p.value,
        totalInvested: p.invested,
        pnl: p.value - p.invested,
        bench: p.bench,
      })),
      daily: computed.map((p) => (p.dPnl == null ? null : { dPnl: p.dPnl, dPct: p.dPct })),
    };
  }
  const snaps = state.snapshots
    .filter((s) => s.totalValue != null && (!s.planId || s.planId === activePlan()?.id))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!snaps.length) return null;
  return {
    source: 'snapshots',
    points: snaps.map((s) => ({ date: s.date, totalValue: s.totalValue, totalInvested: s.totalInvested ?? null, pnl: s.pnl ?? null, bench: null })),
    daily: snaps.map((s, i) => {
      if (i === 0 || s.pnl == null || snaps[i - 1].pnl == null) return null;
      const dPnl = s.pnl - snaps[i - 1].pnl;
      return { dPnl, dPct: snaps[i - 1].totalValue > 0 ? dPnl / snaps[i - 1].totalValue : null };
    }),
  };
}

// 金額縮寫（軸標籤用）：1.2億、350萬、8,000
function fmtCompactTWD(v) {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e8) return sign + (abs / 1e8).toFixed(abs >= 1e9 || abs % 1e8 === 0 ? 0 : 1) + '億';
  if (abs >= 1e4) return sign + Math.round(abs / 1e4).toLocaleString('zh-TW') + '萬';
  return sign + Math.round(abs).toLocaleString('zh-TW');
}

// 在 [lo, hi] 之間取「好看」的刻度（1/2/5 × 10^n）
function niceTicks(lo, hi, count = 4) {
  const span = hi - lo || Math.abs(hi) || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) ticks.push(v);
  return ticks;
}

function renderSnapshotChart(rowsForXirr) {
  const el = $('snapshot-chart');
  const data = getChartSeries();

  document.querySelectorAll('#hist-range-control button').forEach((b) => {
    b.classList.toggle('active', b.dataset.range === histDisplayRange);
  });
  const benchToggle = $('bench-toggle');
  if (benchToggle) benchToggle.checked = benchmarkOn;

  if (!data || !data.points.length) {
    $('snapshot-subtitle').textContent = state.historyLoading
      ? '載入歷史價格中…'
      : '新增交易後會依歷史收盤價自動回推市值曲線。';
    el.innerHTML = '<div class="snapshot-empty">尚無資料 — 記錄第一筆交易後，這裡會顯示完整的市值與每日損益走勢。</div>';
    return;
  }
  $('snapshot-subtitle').textContent =
    data.source === 'history'
      ? '依交易紀錄與歷史收盤價回推，最後一點為即時報價；14:00 快照為備援。'
      : `歷史價格暫不可用，改顯示每日快照（已記錄 ${data.points.length} 天）。`;

  // 顯示範圍（資料一次抓全期，切範圍不用重新請求）
  const cutoffDays = HIST_DISPLAY_DAYS[histDisplayRange] ?? 93;
  let snapshots = data.points;
  let daily = data.daily;
  if (cutoffDays !== Infinity) {
    const cutoff = new Date(Date.now() - cutoffDays * 86400_000).toISOString().slice(0, 10);
    const startIdx = snapshots.findIndex((p) => p.date >= cutoff);
    if (startIdx > 0) {
      snapshots = snapshots.slice(startIdx);
      daily = daily.slice(startIdx);
    }
  }

  const showBench = benchmarkOn && data.source === 'history' && snapshots.some((p) => p.bench != null);
  const xirr = computeXirr(rowsForXirr || []);

  // ---- 版面：上下兩個共用時間軸的面板 ----
  const width = 860;
  const height = 408;
  const padL = 60;
  const padR = 14;
  const top = { y0: 30, y1: 236 }; // 市值面板
  const bot = { y0: 274, y1: 362 }; // 每日損益面板
  const xAxisY = 388;
  const plotW = width - padL - padR;
  const n = snapshots.length;
  const xOf = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);

  // 市值與投入成本同單位，共用左軸；範圍貼齊資料（不強制從 0 起算，變化才看得清楚）
  const series = [];
  for (const s of snapshots) {
    series.push(s.totalValue);
    if (s.totalInvested != null) series.push(s.totalInvested);
    if (showBench && s.bench != null) series.push(s.bench);
  }
  let vLo = Math.min(...series);
  let vHi = Math.max(...series);
  const vPad = (vHi - vLo || vHi || 1) * 0.08;
  vLo = Math.max(0, vLo - vPad);
  vHi += vPad;
  const yVal = (v) => top.y1 - ((v - vLo) / (vHi - vLo || 1)) * (top.y1 - top.y0);
  const vTicks = niceTicks(vLo, vHi, 4);

  // 每日損益面板：0 基線置中、上下對稱
  const pnlAbs = Math.max(1, ...daily.filter(Boolean).map((d) => Math.abs(d.dPnl)));
  const pLim = pnlAbs * 1.12;
  const yPnl = (v) => {
    const mid = (bot.y0 + bot.y1) / 2;
    return mid - (v / pLim) * ((bot.y1 - bot.y0) / 2);
  };
  const zeroY = yPnl(0);

  const valuePath = snapshots
    .map((s, i) => `${i ? 'L' : 'M'} ${xOf(i).toFixed(1)} ${yVal(s.totalValue).toFixed(1)}`)
    .join(' ');
  const areaPath =
    n > 1 ? `${valuePath} L ${xOf(n - 1).toFixed(1)} ${top.y1} L ${xOf(0).toFixed(1)} ${top.y1} Z` : '';
  const investedPath = snapshots
    .map((s, i) => (s.totalInvested == null ? null : `${xOf(i).toFixed(1)} ${yVal(s.totalInvested).toFixed(1)}`))
    .filter(Boolean)
    .map((p, i) => (i ? 'L ' : 'M ') + p)
    .join(' ');
  const benchPath = !showBench
    ? ''
    : snapshots
        .map((s, i) => (s.bench == null ? null : `${xOf(i).toFixed(1)} ${yVal(s.bench).toFixed(1)}`))
        .filter(Boolean)
        .map((p, i) => (i ? 'L ' : 'M ') + p)
        .join(' ');

  const barW = Math.max(3, Math.min(16, (plotW / Math.max(n, 2)) * 0.55));
  const bars = daily
    .map((d, i) => {
      if (!d) return '';
      const y = yPnl(d.dPnl);
      const h = Math.max(1.5, Math.abs(y - zeroY));
      const topY = d.dPnl >= 0 ? y : zeroY;
      return `<rect class="pnl-bar ${d.dPnl >= 0 ? 'up' : 'down'}" x="${(xOf(i) - barW / 2).toFixed(1)}" y="${topY.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"></rect>`;
    })
    .join('');

  const vGrid = vTicks
    .map(
      (t) =>
        `<line x1="${padL}" y1="${yVal(t).toFixed(1)}" x2="${padL + plotW}" y2="${yVal(t).toFixed(1)}" class="grid-line"></line>` +
        `<text x="${padL - 8}" y="${(yVal(t) + 4).toFixed(1)}" text-anchor="end" class="axis-text">${fmtCompactTWD(t)}</text>`
    )
    .join('');
  const pGrid = [-pnlAbs, 0, pnlAbs]
    .map(
      (t) =>
        `<line x1="${padL}" y1="${yPnl(t).toFixed(1)}" x2="${padL + plotW}" y2="${yPnl(t).toFixed(1)}" class="${t === 0 ? 'zero-line' : 'grid-line'}"></line>` +
        `<text x="${padL - 8}" y="${(yPnl(t) + 4).toFixed(1)}" text-anchor="end" class="axis-text">${t > 0 ? '+' : ''}${fmtCompactTWD(t)}</text>`
    )
    .join('');

  const tickCount = Math.min(n, 6);
  const tickIdxs = [...new Set(Array.from({ length: tickCount }, (_, k) => Math.round((k * (n - 1)) / Math.max(tickCount - 1, 1))))];
  const xTicks = tickIdxs
    .map(
      (i) =>
        `<text x="${xOf(i).toFixed(1)}" y="${xAxisY}" text-anchor="middle" class="axis-text">${esc(
          snapshots[i].date.slice(5).replace('-', '/')
        )}</text>`
    )
    .join('');

  const latest = snapshots[n - 1];
  const lastDaily = [...daily].reverse().find(Boolean) || null;

  el.innerHTML = `
    <div class="snapshot-summary">
      <span>最新市值 <strong>${fmtTWD(latest.totalValue)}</strong></span>
      <span class="${pnlClass(latest.pnl ?? 0)}">累計損益 <strong>${latest.pnl != null ? signed(latest.pnl, (n) => fmtTWD(n)) : '—'}</strong></span>
      <span class="${pnlClass(lastDaily?.dPnl ?? 0)}">當日損益 <strong>${
        lastDaily ? `${signed(lastDaily.dPnl, (n) => fmtTWD(n))}${lastDaily.dPct != null ? `（${signed(lastDaily.dPct, (v) => fmtPct(v, 2))}）` : ''}` : '至少需 2 筆'
      }</strong></span>
      <span class="${pnlClass(xirr ?? 0)}" title="以每筆現金流計算的年化報酬率（XIRR），需至少 30 天">年化報酬率 <strong>${
        xirr != null ? signed(xirr, (v) => fmtPct(v, 1)) : '—'
      }</strong></span>
    </div>
    <div class="snapshot-plot">
      <svg viewBox="0 0 ${width} ${height}" class="snapshot-svg" id="snapshot-svg" role="img" aria-label="市值曲線與每日損益直方圖">
        <text x="${padL}" y="18" class="panel-caption">總市值（台幣）</text>
        <text x="${padL}" y="264" class="panel-caption">每日損益（台幣）</text>
        ${vGrid}
        ${areaPath ? `<path d="${areaPath}" class="value-area"></path>` : ''}
        ${investedPath ? `<path d="${investedPath}" class="invested-line"></path>` : ''}
        ${benchPath ? `<path d="${benchPath}" class="bench-line"></path>` : ''}
        <path d="${valuePath}" class="value-line"></path>
        ${n === 1 ? `<circle class="snapshot-point" cx="${xOf(0).toFixed(1)}" cy="${yVal(latest.totalValue).toFixed(1)}" r="4"></circle>` : ''}
        ${pGrid}
        ${bars}
        ${xTicks}
        <line id="snap-cross" class="cross-line" y1="${top.y0}" y2="${bot.y1}" x1="0" x2="0" hidden></line>
        <circle id="snap-dot" class="snapshot-point" r="4" hidden></circle>
        <rect id="snap-overlay" x="${padL}" y="${top.y0}" width="${plotW}" height="${bot.y1 - top.y0}" fill="transparent"></rect>
      </svg>
      <div class="chart-tooltip" id="snap-tooltip" hidden></div>
    </div>
    <div class="snapshot-legend">
      <span><i class="legend-line value"></i>總市值</span>
      ${investedPath ? '<span><i class="legend-line invested"></i>投入成本</span>' : ''}
      ${benchPath ? '<span><i class="legend-line bench"></i>同額投入 0050</span>' : ''}
      <span><i class="legend-bar up"></i>單日獲利</span>
      <span><i class="legend-bar down"></i>單日虧損</span>
    </div>`;

  bindSnapshotHover(snapshots, daily, { xOf, yVal, padL, plotW, viewW: width, showBench });
}

function bindSnapshotHover(snapshots, daily, geo) {
  const svg = $('snapshot-svg');
  const overlay = $('snap-overlay');
  const cross = $('snap-cross');
  const dot = $('snap-dot');
  const tip = $('snap-tooltip');
  if (!svg || !overlay) return;
  const wrap = svg.parentElement;
  const n = snapshots.length;

  overlay.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * geo.viewW;
    let i = n === 1 ? 0 : Math.round(((sx - geo.padL) / geo.plotW) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    const s = snapshots[i];
    const d = daily[i];
    const x = geo.xOf(i);

    cross.setAttribute('x1', x);
    cross.setAttribute('x2', x);
    cross.hidden = false;
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', geo.yVal(s.totalValue));
    dot.hidden = false;

    tip.innerHTML = `
      <strong>${esc(s.date)}</strong><br>
      市值 ${fmtTWD(s.totalValue)}<br>
      ${s.totalInvested != null ? `投入 ${fmtTWD(s.totalInvested)}<br>` : ''}
      ${geo.showBench && s.bench != null ? `0050 對比 ${fmtTWD(s.bench)}<br>` : ''}
      <span class="${pnlClass(d?.dPnl ?? 0)}">當日損益 ${
        d ? `${signed(d.dPnl, (v) => fmtTWD(v))}${d.dPct != null ? `（${signed(d.dPct, (v) => fmtPct(v, 2))}）` : ''}` : '—'
      }</span><br>
      <span class="${pnlClass(s.pnl ?? 0)}">累計損益 ${s.pnl != null ? signed(s.pnl, (v) => fmtTWD(v)) : '—'}</span>`;
    tip.hidden = false;

    const wrect = wrap.getBoundingClientRect();
    const estW = 190;
    let lx = e.clientX - wrect.left + 14;
    if (lx + estW > wrect.width) lx = e.clientX - wrect.left - estW - 10;
    tip.style.left = Math.max(0, lx) + 'px';
    tip.style.top = e.clientY - wrect.top + 12 + 'px';
  });
  overlay.addEventListener('mouseleave', () => {
    cross.hidden = true;
    dot.hidden = true;
    tip.hidden = true;
  });
}

function renderHoldings(rows, totalInvested, totalValue, totalPnl) {
  const body = $('holdings-body');
  body.innerHTML = '';
  if (!rows.length) {
    body.innerHTML = `
      <tr class="holdings-empty-row">
        <td colspan="9">這個計畫目前還沒有持股；新增交易後才會出現在這裡。</td>
      </tr>`;
  }
  for (const r of rows) {
    const { stock } = r;
    const tr = document.createElement('tr');
    const priceDigits = stock.currency === 'KRW' || stock.currency === 'JPY' ? 0 : 2;
    tr.innerHTML = `
      <td class="holding-main" data-label="標的">
        <a class="stock-name stock-link" href="${quoteUrlOf(stock.symbol)}" target="_blank" rel="noopener noreferrer">${esc(stock.name)}</a>
        <div class="stock-meta"><span>${esc(tickerOf(stock.symbol))}</span><span class="chip">${esc(stock.market)}</span></div>
      </td>
      <td class="num" data-label="目標配置">${fmtNum(stock.percent, 1)}%<span class="cell-sub">${fmtTWD(r.targetTWD)}</span></td>
      <td class="num" data-label="持有股數">${r.shares ? fmtNum(r.shares, 4) : '—'}</td>
      <td class="num" data-label="平均成本">${r.avgCost != null ? fmtNum(r.avgCost, priceDigits) : '—'}</td>
      <td class="num" data-label="投入成本">${fmtTWD(r.invested)}</td>
      <td data-label="投入進度">
        <div class="progress-cell">
          <div class="bar-track"><div class="bar-fill ${r.progress > 1 ? 'over' : ''}" style="width:${Math.min((r.progress ?? 0) * 100, 100)}%"></div></div>
          <span class="pct">${fmtPct(r.progress)}${r.invested != null ? '，還差 ' + fmtTWD(Math.max(r.targetTWD - r.invested, 0)) : ''}</span>
        </div>
      </td>
      <td class="num" data-label="現價">${r.price != null ? fmtNum(r.price, priceDigits) : '—'}${
        r.dayChange != null
          ? `<span class="cell-sub ${pnlClass(r.dayChange)}">${signed(r.dayChange, (n) => fmtPct(n, 2))}</span>`
          : ''
      }</td>
      <td class="num" data-label="市值">${fmtTWD(r.valueTWD)}</td>
      <td class="num ${pnlClass(r.pnl ?? 0)}" data-label="未實現損益">${r.pnl != null ? signed(r.pnl, (n) => fmtTWD(n)) : '—'}${
        r.pnl != null && r.invested > 0
          ? `<span class="cell-sub ${pnlClass(r.pnl)}">${signed(r.pnl / r.invested, fmtPct)}</span>`
          : ''
      }${(() => {
        const realizedTotal = (r.realized ?? 0) + (r.dividends ?? 0);
        return realizedTotal !== 0
          ? `<span class="cell-sub ${pnlClass(realizedTotal)}">已實現 ${signed(realizedTotal, (n) => fmtTWD(n))}</span>`
          : '';
      })()}</td>`;
    body.appendChild(tr);
  }

  const totalPercent = state.stocks.reduce((s, x) => s + planPercentOf(x.id), 0);
  $('holdings-foot').innerHTML = `
    <tr>
      <td>合計</td>
      <td class="num">${hasTarget() ? `${fmtNum(totalPercent, 1)}%<span class="cell-sub">${fmtTWD(planBudget())}</span>` : '—'}</td>
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
    paths += `<path class="donut-slice" d="${d}"${rule} fill="${s.color}" data-cat="${esc(s.cat)}" data-label="${esc(label)}">`;
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

  const centerNum = chartBasis === 'target' ? fmtTWD(planBudget() ?? 0) : fmtTWD(total);
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
    const members = ordered
      .filter((r) => (r.stock.category || '未分類') === cat)
      .filter((r) => basis.valueOf(r) > 0);
    const catValue = members.reduce((s, r) => s + basis.valueOf(r), 0);
    if (catValue <= 0) continue;
    const catPct = total > 0 ? catValue / total : 0;
    const legendValue = chartBasis === 'target' ? fmtTWD(((planBudget() ?? 0) * catValue) / 100) : basis.fmtVal(catValue);
    const memberHtml = members
      .map((r) => {
        const v = basis.valueOf(r);
        const p = total > 0 ? v / total : 0;
        return `<span class="legend-member"><span>${esc(r.stock.name)}</span><span>${fmtPct(p)}</span></span>`;
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
  const sorted = [...planTxs()].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const t of sorted) {
    const stock = state.stocks.find((s) => s.id === t.stockId);
    const isDiv = t.kind === 'dividend';
    const isSplit = t.kind === 'split';
    const kindChip = isSplit
      ? '<span class="chip chip-kind split">割</span>'
      : isDiv
        ? '<span class="chip chip-kind div">息</span>'
        : t.shares < 0
          ? '<span class="chip chip-kind sell">賣</span>'
          : '<span class="chip chip-kind buy">買</span>';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(t.date)}</td>
      <td>${esc(stock ? stock.name : t.stockId)} ${kindChip}</td>
      <td class="num ${!isDiv && !isSplit && t.shares < 0 ? 'down' : ''}">${isDiv || isSplit ? '—' : fmtNum(t.shares, 4)}</td>
      <td class="num">${isSplit ? '分割 1→' + fmtNum(t.ratio, 4) : (isDiv ? fmtNum(t.amount, 2) : fmtNum(t.price, 4)) + ' ' + (stock ? esc(stock.currency) : '')}</td>
      <td class="num">${isSplit ? '—' : t.twdCost != null ? fmtTWD(t.twdCost) : '（依匯率）'}</td>
      <td class="tx-actions">
        ${isSplit ? '' : `<button class="tx-edit" data-id="${esc(t.id)}" title="編輯">✎</button>`}
        <button class="tx-del" data-id="${esc(t.id)}" title="刪除">✕</button>
      </td>`;
    body.appendChild(tr);
  }
  $('tx-empty').hidden = sorted.length > 0;
}

// ---------- 月報 ----------
function renderMonthlyReport() {
  const card = $('monthly-card');
  const series = computeDailySeries();
  if (!series || !series.length) {
    card.hidden = true;
    return;
  }
  const months = PortfolioMath.computeMonthlyReport({
    series,
    benchCloses: state.history?.series?.[BENCH_SYMBOL] || [],
  });
  if (!months.length) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const body = $('monthly-body');
  body.innerHTML = '';
  for (const m of [...months].reverse()) {
    const tr = document.createElement('tr');
    tr.className = 'monthly-row';
    const beatsBenchmark = m.twr != null && m.benchPct != null && m.twr >= m.benchPct;
    tr.innerHTML = `
      <td>${esc(m.month)}</td>
      <td class="num">${m.flow ? fmtTWD(m.flow) : '—'}</td>
      <td class="num">${m.dividends ? fmtTWD(m.dividends) : '—'}</td>
      <td class="num ${pnlClass(m.pnl)}">${signed(m.pnl, (n) => fmtTWD(n))}</td>
      <td class="num ${pnlClass(m.twr ?? 0)}">${m.twr == null ? '—' : signed(m.twr, (n) => fmtPct(n, 2))}</td>
      <td class="num">${m.benchPct == null ? '—' : signed(m.benchPct, (n) => fmtPct(n, 2)) + (beatsBenchmark ? ' ✓' : '')}</td>`;
    tr.addEventListener('click', () => toggleMonthlyDetail(tr, m.month));
    body.appendChild(tr);
  }
}

function toggleMonthlyDetail(row, month) {
  const existing = row.nextElementSibling;
  if (existing && existing.classList.contains('monthly-detail')) {
    existing.remove();
    return;
  }
  document.querySelectorAll('.monthly-detail').forEach((el) => el.remove());
  const days = (computeDailySeries() || [])
    .filter((p) => String(p.date).slice(0, 7) === month)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const tr = document.createElement('tr');
  tr.className = 'monthly-detail';
  const items = days
    .filter((d) => d.dPnl != null)
    .map(
      (d) => `
        <div class="monthly-daily-row">
          <span>${esc(d.date)}</span>
          <span class="${pnlClass(d.dPnl)}">${signed(d.dPnl, (n) => fmtTWD(n))}</span>
          <span class="${pnlClass(d.dPct ?? 0)}">${d.dPct == null ? '—' : signed(d.dPct, (n) => fmtPct(n, 2))}</span>
          <span>${fmtTWD(d.value)}</span>
        </div>`
    )
    .join('');
  tr.innerHTML = `
    <td colspan="6" class="monthly-detail-cell">
      <div class="monthly-daily-table">
        <div class="monthly-daily-head">
          <span>日期</span>
          <span>當日損益</span>
          <span>當日報酬率</span>
          <span>市值</span>
        </div>
        ${items || '<div class="monthly-daily-empty">本月每日損益資料不足。</div>'}
      </div>
    </td>`;
  row.after(tr);
}

// ---------- 交易表單（新增／編輯）----------
let editingTxId = null;

function updateTxKindUI() {
  const isDiv = $('tx-kind').value === 'dividend';
  $('tx-shares-label').hidden = isDiv;
  $('tx-price-label').hidden = isDiv;
  $('tx-amount-label').hidden = !isDiv;
  $('tx-shares').required = !isDiv;
  $('tx-price').required = !isDiv;
  $('tx-twd-caption').textContent = isDiv ? '台幣入帳金額（選填）' : '台幣總成本（選填）';
}

// 交易表單的計畫多選：預設勾選目前計畫，編輯既有交易時帶出它原本的歸屬
function renderTxPlans(selected) {
  const wrap = $('tx-plans');
  txPlansSignature = state.plans.map((p) => p.id + ':' + p.name).join(',') + '|' + (activePlan()?.id || '');
  const checked = new Set(selected && selected.length ? selected : [activePlan()?.id].filter(Boolean));
  wrap.innerHTML = '';
  for (const p of state.plans) {
    const label = document.createElement('label');
    label.className = 'tx-plan-option';
    label.innerHTML = `<input type="checkbox" value="${esc(p.id)}"${checked.has(p.id) ? ' checked' : ''}> ${esc(p.name)}`;
    wrap.appendChild(label);
  }
  // 只有一個計畫時勾選框沒有意義，整欄收起來
  $('tx-plans-field').hidden = state.plans.length < 2;
  updateTxPlansHint();
}

function selectedTxPlans() {
  return [...document.querySelectorAll('#tx-plans input:checked')].map((el) => el.value);
}

// 計畫清單或目前計畫變了才重建勾選框，並保留使用者已勾的選擇——
// 否則每次 render（更新報價、切圖表範圍…）都會把勾好的計畫沖掉。
let txPlansSignature = '';
function syncTxPlansOptions() {
  const signature = state.plans.map((p) => p.id + ':' + p.name).join(',') + '|' + (activePlan()?.id || '');
  if (signature === txPlansSignature) return;
  txPlansSignature = signature;
  const kept = selectedTxPlans().filter((id) => state.plans.some((p) => p.id === id));
  renderTxPlans(kept);
}

function updateTxPlansHint() {
  $('tx-plans-hint').hidden = selectedTxPlans().length < 2;
}

function resetTxForm() {
  editingTxId = null;
  renderTxPlans(null);
  $('tx-shares').value = '';
  $('tx-price').value = '';
  $('tx-amount').value = '';
  $('tx-twd').value = '';
  $('tx-submit').textContent = '新增交易';
  $('tx-cancel-edit').hidden = true;
  $('tx-form-title').textContent = '新增交易';
}

function startEditTx(id) {
  const t = state.transactions.find((x) => x.id === id);
  if (!t) return;
  editingTxId = id;
  $('tx-kind').value = t.kind === 'dividend' ? 'dividend' : 'trade';
  updateTxKindUI();
  $('tx-stock').value = t.stockId;
  $('tx-date').value = t.date;
  $('tx-shares').value = t.kind === 'dividend' ? '' : t.shares;
  $('tx-price').value = t.kind === 'dividend' ? '' : t.price;
  $('tx-amount').value = t.kind === 'dividend' ? (t.amount ?? '') : '';
  $('tx-twd').value = t.twdCost ?? '';
  renderTxPlans(t.plans);
  $('tx-submit').textContent = '更新交易';
  $('tx-cancel-edit').hidden = false;
  $('tx-form-title').textContent = '編輯交易';
  $('tx-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------- CSV 匯入 ----------
// 支援引號包裹的欄位；欄位順序 date, stock, shares, price, twd, kind（可有標題列）
function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

const CSV_HEADERS = {
  date: ['date', '日期'],
  stock: ['stock', 'symbol', 'ticker', '標的', '代號', '股票', '股名'],
  shares: ['shares', 'qty', '股數', '成交股數'],
  price: ['price', '價格', '每股價格', '成交價', '成交單價'],
  twd: ['twd', 'twdcost', '台幣', '台幣成本', '台幣總成本', '淨收付'],
  net: ['淨收付'],
  kind: ['kind', 'type', '類型'],
};

function findStockByText(text) {
  const q = String(text).trim().toLowerCase();
  return state.stocks.find(
    (s) =>
      s.id.toLowerCase() === q ||
      s.symbol.toLowerCase() === q ||
      tickerOf(s.symbol).toLowerCase() === q ||
      s.name.toLowerCase() === q
  );
}

function parseCsvNumber(value) {
  const normalized = String(value ?? '').trim().replace(/,/g, '');
  return normalized === '' ? NaN : parseFloat(normalized);
}

function normalizeCsvDate(value) {
  const parts = String(value ?? '').trim().replace(/\//g, '-').split('-');
  if (parts.length !== 3) return '';
  const [y, m, d] = parts;
  return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

async function importCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) throw new Error('CSV 是空的');

  let rows = lines.map(parseCsvLine);
  // 有標題列 → 依標題對應欄位；否則用預設順序
  let col = { date: 0, stock: 1, shares: 2, price: 3, twd: 4, kind: 5, net: null };
  const first = rows[0].map((c) => c.toLowerCase());
  const hasHeader = Object.values(CSV_HEADERS).some((names) => names.some((n) => first.includes(n)));
  if (hasHeader) {
    for (const [key, names] of Object.entries(CSV_HEADERS)) {
      const idx = first.findIndex((c) => names.includes(c));
      if (idx >= 0) col[key] = idx;
    }
    rows = rows.slice(1);
  }

  const imported = [];
  const failed = [];
  for (const [i, cells] of rows.entries()) {
    const rowNo = i + 1 + (hasHeader ? 1 : 0);
    const dateRaw = normalizeCsvDate(cells[col.date]);
    const stock = findStockByText(cells[col.stock] || '');
    const kindRaw = (cells[col.kind] || '').toLowerCase();
    const isDiv = ['dividend', 'div', '息', '配息', '股利'].includes(kindRaw);
    const priceVal = parseCsvNumber(cells[col.price]);
    const rawShares = parseCsvNumber(cells[col.shares]);
    const netVal = col.net == null ? NaN : parseCsvNumber(cells[col.net]);
    const sharesVal = !Number.isNaN(netVal) && netVal > 0 ? -Math.abs(rawShares) : rawShares;
    const twdRaw = cells[col.twd] || '';
    const twdCost = twdRaw === '' ? null : Math.abs(parseCsvNumber(twdRaw)) || null;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw) || !stock) {
      failed.push(`第 ${rowNo} 列（${cells.join(',').slice(0, 40)}）`);
      continue;
    }
    if (isDiv) {
      if ((Number.isNaN(priceVal) || priceVal <= 0) && twdCost == null) {
        failed.push(`第 ${rowNo} 列（配息缺金額）`);
        continue;
      }
      imported.push({ kind: 'dividend', stockId: stock.id, date: dateRaw, amount: Number.isNaN(priceVal) ? 0 : priceVal, twdCost });
    } else {
      if (!sharesVal || Number.isNaN(priceVal)) {
        failed.push(`第 ${rowNo} 列（股數或價格無效）`);
        continue;
      }
      imported.push({ stockId: stock.id, date: dateRaw, shares: sharesVal, price: priceVal, twdCost });
    }
  }

  if (!imported.length) throw new Error('沒有可匯入的資料列。' + (failed.length ? `\n無法解析：\n${failed.join('\n')}` : ''));
  const msg =
    `將匯入 ${imported.length} 筆交易` +
    (failed.length ? `，另有 ${failed.length} 列無法解析將略過：\n${failed.slice(0, 5).join('\n')}${failed.length > 5 ? '\n…' : ''}` : '') +
    '\n確定嗎？';
  if (!confirm(msg)) return;

  for (const rec of imported) {
    state.transactions.push({ ...rec, plans: [activePlan().id], id: newTxId() });
  }
  await savePortfolio();
  render();
  loadHistory();
}

// ---------- 再平衡建議 ----------
let rebalanceBase = localStorage.getItem('rebalance-base') || 'budget';

function renderRebalance(rows, totalValue) {
  document.querySelectorAll('#rebalance-base-control button').forEach((b) => {
    b.classList.toggle('active', b.dataset.base === rebalanceBase);
  });

  const useValue = rebalanceBase === 'value' && totalValue != null && totalValue > 0;
  const anchor = useValue ? totalValue : planBudget() ?? 0;
  $('rebalance-note').textContent =
    rebalanceBase === 'value' && !useValue ? '（目前市值不可用，暫以總預算計算）' : '';

  const threshold = anchor * 0.01;
  const items = [];
  let balancedCount = 0;
  for (const r of rows) {
    const target = (anchor * (Number(r.stock.percent) || 0)) / 100;
    const current = r.valueTWD ?? 0;
    const deficit = target - current;
    if (Math.abs(deficit) < threshold) {
      balancedCount++;
      continue;
    }
    const fx = fxRate(r.stock.currency);
    const priceTWD = r.price != null && fx != null && r.price > 0 ? r.price * fx : null;
    // 買進位到整股（無條件捨去，避免超買）；賣出同樣取整
    const suggShares = priceTWD ? Math.trunc(deficit / priceTWD) : null;
    items.push({ r, target, current, deficit, priceTWD, suggShares });
  }
  items.sort((a, b) => Math.abs(b.deficit) - Math.abs(a.deficit));

  const body = $('rebalance-body');
  body.innerHTML = items
    .map(({ r, current, deficit, priceTWD, suggShares }) => {
      const buy = deficit > 0;
      const action =
        suggShares != null && suggShares !== 0
          ? `<span class="${buy ? 'action-buy' : 'action-sell'}">${buy ? '買入' : '減碼'} ${fmtNum(Math.abs(suggShares), 0)} 股</span>` +
            `<span class="cell-sub">約 ${fmtTWD(Math.abs(suggShares) * priceTWD)}</span>`
          : `<span class="${buy ? 'action-buy' : 'action-sell'}">${buy ? '加碼' : '減碼'}約 ${fmtTWD(Math.abs(deficit))}</span>` +
            (priceTWD == null ? '<span class="cell-sub">（無現價，僅列金額）</span>' : '');
      return `
        <tr>
          <td>
            <div class="stock-name">${esc(r.stock.name)}</div>
            <div class="stock-meta"><span>${esc(tickerOf(r.stock.symbol))}</span></div>
          </td>
          <td class="num">${fmtPct(current / anchor)} → ${fmtNum(r.stock.percent, 1)}%</td>
          <td class="num ${buy ? '' : 'down'}">${signed(deficit, (n) => fmtTWD(n))}</td>
          <td>${action}</td>
        </tr>`;
    })
    .join('');

  const balancedEl = $('rebalance-balanced');
  if (!items.length) {
    balancedEl.textContent = '所有標的都在目標比例 ±1% 內，目前不需要調整。';
    balancedEl.hidden = false;
  } else if (balancedCount > 0) {
    balancedEl.textContent = `另有 ${balancedCount} 檔已在目標 ±1% 內，未列出。`;
    balancedEl.hidden = false;
  } else {
    balancedEl.hidden = true;
  }
}

function rebuildStockSelect() {
  const select = $('tx-stock');
  const prev = select.value;
  select.innerHTML = '';
  for (const s of sortedByTargetPercent(state.stocks)) {
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
    <td>
      <div class="symbol-field">
        <input class="e-symbol" value="${esc(s.symbol)}" placeholder="如 2330.TW">
        <button type="button" class="btn btn-ghost symbol-search" title="查 Yahoo 代號">查</button>
      </div>
      <div class="symbol-results" hidden></div>
    </td>
    <td><input class="e-market" value="${esc(s.market)}" placeholder="台股"></td>
    <td><input class="e-category" list="category-list" value="${esc(s.category || '')}" placeholder="如 記憶體"></td>
    <td><select class="e-currency">${currencyOptions}</select></td>
    <td class="num e-percent-cell"><input class="e-percent" type="text" inputmode="decimal" value="${Number(s.percent) || 0}"></td>
    <td><button type="button" class="tx-del e-del" title="刪除標的">✕</button></td>`;
  return tr;
}

async function searchSymbolForRow(tr) {
  const name = tr.querySelector('.e-name').value.trim();
  const symbol = tr.querySelector('.e-symbol').value.trim();
  const query = name || symbol;
  const resultsEl = tr.querySelector('.symbol-results');
  if (query.length < 2) {
    resultsEl.textContent = '請先輸入名稱或代號關鍵字';
    resultsEl.hidden = false;
    return;
  }

  const btn = tr.querySelector('.symbol-search');
  btn.disabled = true;
  btn.textContent = '查詢中';
  resultsEl.textContent = '';
  resultsEl.hidden = true;
  try {
    const res = await fetch('/api/symbol-search?q=' + encodeURIComponent(query));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '查詢失敗');
    const results = data.results || [];
    if (!results.length) {
      resultsEl.textContent = '找不到符合的 Yahoo 代號';
    } else {
      resultsEl.innerHTML = results
        .map(
          (r) => `
            <button type="button" class="symbol-result" data-symbol="${esc(r.symbol)}" data-name="${esc(r.name)}" data-market="${esc(r.market)}" data-currency="${esc(r.currency)}">
              <strong>${esc(r.symbol)}</strong>
              <span>${esc(r.name)}</span>
              <small>${esc(r.market)}・${esc(r.currency)}</small>
            </button>`
        )
        .join('');
    }
    resultsEl.hidden = false;
  } catch (err) {
    resultsEl.textContent = err.message || '查詢失敗，請稍後再試';
    resultsEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = '查';
  }
}

function applySymbolResult(btn) {
  const tr = btn.closest('tr');
  tr.querySelector('.e-symbol').value = btn.dataset.symbol || '';
  tr.querySelector('.e-name').value = btn.dataset.name || btn.dataset.symbol || '';
  tr.querySelector('.e-market').value = btn.dataset.market || '—';
  const currency = btn.dataset.currency;
  if (CURRENCIES.includes(currency)) tr.querySelector('.e-currency').value = currency;
  tr.querySelector('.symbol-results').hidden = true;
}

function refreshCategoryDatalist() {
  const dl = $('category-list');
  if (!dl) return;
  const cats = [...new Set(state.stocks.map((s) => s.category).filter(Boolean))];
  dl.innerHTML = cats.map((c) => `<option value="${esc(c)}"></option>`).join('');
}

function updateEditorTotal() {
  const total = [...document.querySelectorAll('#editor-body .e-percent')].reduce(
    (s, el) => s + (parseDecimalInput(el.value) || 0),
    0
  );
  const el = $('editor-total');
  el.textContent = '比例合計 ' + fmtNum(total, 1) + '%';
  el.className = Math.abs(total - 100) < 0.01 ? 'editor-total ok' : 'editor-total warn';
}

function setPercentInput(input, value) {
  input.value = (Math.round(value * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
}

function rebalanceEditorPercents() {
  const inputs = [...document.querySelectorAll('#editor-body .e-percent')];
  if (!inputs.length) return;

  const manualInputs = inputs.filter((input) => input.dataset.manual === '1');
  const flexibleInputs = inputs.filter((input) => input.dataset.manual !== '1');
  const manualTotal = manualInputs.reduce((sum, input) => sum + Math.max(0, parseDecimalInput(input.value) || 0), 0);
  if (manualTotal > 100) {
    alert(`手動設定的比例合計已經是 ${fmtNum(manualTotal, 1)}%，超過 100%。請先調低部分比例。`);
    return;
  }

  const targets = flexibleInputs.length ? flexibleInputs : inputs;
  const targetTotal = flexibleInputs.length ? 100 - manualTotal : 100;
  const currentTotal = targets.reduce((sum, input) => sum + Math.max(0, parseDecimalInput(input.value) || 0), 0);
  if (currentTotal <= 0) return;

  let assigned = 0;
  targets.forEach((input, index) => {
    const next =
      index === targets.length - 1
        ? Math.max(0, targetTotal - assigned)
        : (Math.max(0, parseDecimalInput(input.value) || 0) / currentTotal) * targetTotal;
    setPercentInput(input, next);
    assigned += parseDecimalInput(input.value) || 0;
  });

  updateEditorTotal();
}

function openEditor() {
  // 標的基本資料全帳號共用，比例只改目前計畫的目標配置 — 欄位標題標明是哪個計畫
  $('editor-percent-head').textContent = `目標％（${activePlan()?.name || ''}）`;
  $('editor-card').classList.toggle('no-target', !hasTarget());
  $('edit-budget-field').hidden = !hasTarget();
  $('edit-budget').value = planBudget() ?? '';
  refreshCategoryDatalist();
  const body = $('editor-body');
  body.innerHTML = '';
  for (const s of sortedByTargetPercent(planStocks())) body.appendChild(editorRow(s));
  updateEditorTotal();
  $('editor-card').hidden = false;
  $('edit-stocks-btn').hidden = true;
}

function closeEditor() {
  $('editor-card').hidden = true;
  $('edit-stocks-btn').hidden = false;
}

async function saveEditor() {
  // 純記錄型計畫沒有總預算欄，只有有目標的計畫才驗證它
  const budget = parseDecimalInput($('edit-budget').value);
  if (hasTarget() && !(budget > 0)) {
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
      percent: parseDecimalInput(q('.e-percent').value) || 0,
    });
  }

  const ids = stocks.map((s) => s.id);
  if (new Set(ids).size !== ids.length) {
    alert('標的代號重複了，請確認每檔代號都不同');
    return;
  }

  const prevStocks = state.stocks;
  const prevPlans = state.plans.map((p) => ({ ...p, allocations: { ...(p.allocations || {}) } }));
  const plan = activePlan();
  if (hasTarget()) {
    const total = stocks.reduce((s, x) => s + x.percent, 0);
    if (Math.abs(total - 100) > 0.01 && !confirm(`比例合計是 ${fmtNum(total, 1)}%（不是 100%），仍要儲存嗎？`)) {
      return;
    }
    plan.budget = budget;
    plan.allocations = {};
    for (const s of stocks) if (s.percent > 0) plan.allocations[s.id] = s.percent;
  }
  state.stocks = sortedByTargetPercent(stocks).map(({ percent, ...rest }) => rest);
  const saved = await savePortfolio();
  if (!saved) {
    state.stocks = prevStocks;
    state.plans = prevPlans;
    return;
  }
  rebuildStockSelect();
  closeEditor();
  render();
  loadQuotes().then(render); // 新標的需要抓報價
  loadHistory();
}

function initEditor() {
  $('edit-stocks-btn').addEventListener('click', openEditor);
  $('editor-cancel').addEventListener('click', closeEditor);
  $('editor-save').addEventListener('click', saveEditor);
  $('editor-rebalance').addEventListener('click', rebalanceEditorPercents);
  $('editor-add').addEventListener('click', () => {
    const row = editorRow();
    $('editor-body').appendChild(row);
    row.querySelector('.e-percent').focus();
    updateEditorTotal();
  });
  $('editor-body').addEventListener('input', (e) => {
    if (e.target.classList.contains('e-percent')) {
      e.target.dataset.manual = '1';
      updateEditorTotal();
    }
  });
  $('editor-body').addEventListener('click', (e) => {
    const searchBtn = e.target.closest('.symbol-search');
    if (searchBtn) {
      searchSymbolForRow(searchBtn.closest('tr'));
      return;
    }
    const resultBtn = e.target.closest('.symbol-result');
    if (resultBtn) {
      applySymbolResult(resultBtn);
      return;
    }
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

  $('tx-kind').addEventListener('change', updateTxKindUI);

  $('tx-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const kind = $('tx-kind').value;
    const twdRaw = $('tx-twd').value.trim();
    const twdCost = twdRaw === '' ? null : Math.abs(parseDecimalInput(twdRaw));
    const base = { stockId: $('tx-stock').value, date: $('tx-date').value };

    let record;
    if (kind === 'dividend') {
      const amount = parseDecimalInput($('tx-amount').value);
      if ((Number.isNaN(amount) || amount <= 0) && twdCost == null) {
        alert('請填配息金額（原幣）或台幣入帳金額');
        return;
      }
      record = { ...base, kind: 'dividend', amount: Number.isNaN(amount) ? 0 : amount, twdCost };
    } else {
      const shares = parseDecimalInput($('tx-shares').value);
      const price = parseDecimalInput($('tx-price').value);
      if (!shares || Number.isNaN(price)) return;
      record = { ...base, shares, price, twdCost };
    }

    const plans = state.plans.length < 2 ? [activePlan().id] : selectedTxPlans();
    if (!plans.length) {
      alert('請至少勾選一個計畫');
      return;
    }
    const prevTransactions = state.transactions;
    if (editingTxId) {
      const idx = state.transactions.findIndex((t) => t.id === editingTxId);
      if (idx >= 0) state.transactions = state.transactions.map((t, i) => (i === idx ? { ...t, ...record, plans, id: editingTxId } : t));
    } else {
      state.transactions = [...state.transactions, { ...record, plans, id: newTxId() }];
    }
    const saved = await savePortfolio();
    if (!saved) {
      state.transactions = prevTransactions;
      return;
    }
    resetTxForm();
    render();
    loadHistory(); // 交易變動可能引入新標的或改變回推結果
    loadEvents(); // 新交易可能讓提醒出現/消失
  });

  $('tx-cancel-edit').addEventListener('click', resetTxForm);

  $('tx-body').addEventListener('click', async (e) => {
    const editBtn = e.target.closest('.tx-edit');
    if (editBtn) {
      startEditTx(editBtn.dataset.id);
      return;
    }
    const btn = e.target.closest('.tx-del');
    if (!btn) return;
    if (!confirm('確定要刪除這筆交易嗎？')) return;
    state.transactions = state.transactions.filter((t) => t.id !== btn.dataset.id);
    if (editingTxId && !state.transactions.some((t) => t.id === editingTxId)) resetTxForm();
    await savePortfolio();
    render();
    loadHistory();
    renderAlerts();
  });

  $('csv-btn').addEventListener('click', () => $('csv-file').click());
  $('csv-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await importCsv(await file.text());
    } catch (err) {
      alert(err.message || 'CSV 解析失敗');
    } finally {
      e.target.value = '';
    }
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

  $('page-reload-btn').addEventListener('click', () => {
    location.reload();
  });

  $('snapshot-btn').addEventListener('click', async () => {
    const btn = $('snapshot-btn');
    btn.disabled = true;
    btn.textContent = '記錄中…';
    try {
      if (isGuest()) {
        await loadQuotes();
        for (const plan of state.plans) {
          const rows = state.stocks.map((stock) => computeStockFor(plan, stock));
          upsertLocalSnapshot(snapshotFromRows(rows, 'manual', plan.id));
        }
        await savePortfolio({ includeSnapshots: true });
      } else {
        const res = await fetch('/api/snapshots/today', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '記錄失敗');
        for (const snap of data.snapshots || []) upsertLocalSnapshot(snap);
        if (data.rev !== undefined) state.rev = Number(data.rev) || state.rev; // 伺服器已寫入，同步版本號
        localStorage.setItem(backupKey(), JSON.stringify({
          plans: state.plans,
          stocks: state.stocks,
          transactions: state.transactions,
          snapshots: state.snapshots,
        }));
      }
      render();
    } catch (err) {
      showNotice(err.message || '記錄今日市值失敗，請稍後再試。');
    } finally {
      btn.disabled = false;
      btn.textContent = '記錄今日市值';
    }
  });

  $('basis-control').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-basis]');
    if (!btn) return;
    chartBasis = btn.dataset.basis;
    basisLocked = true;
    render();
  });

  $('rebalance-base-control').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-base]');
    if (!btn) return;
    rebalanceBase = btn.dataset.base;
    localStorage.setItem('rebalance-base', rebalanceBase);
    render();
  });

  $('hist-range-control').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-range]');
    if (!btn) return;
    histDisplayRange = btn.dataset.range;
    localStorage.setItem('hist-range', histDisplayRange);
    render();
  });

  $('bench-toggle').addEventListener('change', (e) => {
    benchmarkOn = e.target.checked;
    localStorage.setItem('benchmark-on', benchmarkOn ? '1' : '0');
    render();
  });

  // 深色/淺色切換時重畫圓餅圖以套用對應配色
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  }

  $('export-btn').addEventListener('click', () => {
    const doc = { plans: state.plans, stocks: state.stocks, transactions: state.transactions, snapshots: state.snapshots };
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
      delete data.rev; // 備份檔的版本號不適用於目前帳號
      applyDoc(data);
      await savePortfolio({ includeSnapshots: true });
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
    state.plans = [];
    state.activePlanId = null;
    state.stocks = DEFAULT_STOCKS;
    state.transactions = [];
    state.snapshots = [];
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
  loadHistory(); // 歷史價格較大，背景載入，完成後自動重畫圖表
  loadEvents(); // 分割與配息事件，背景載入，完成後顯示提醒橫幅
}

// ---------- PWA ----------
// service worker 在 https（正式站）與 localhost（本機驗證）註冊；
// 端對端測試走 127.0.0.1，維持純網路，行為可預期。
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  navigator.serviceWorker.register('sw.js').catch(() => {
    /* 註冊失敗不影響使用 */
  });
}

function watchOnlineStatus() {
  const update = () => {
    if (navigator.onLine) hideNotice();
    else showNotice('目前離線，顯示的是最後一次載入的資料。');
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  if (!navigator.onLine) update();
}

// ---------- 啟動 ----------
(async function main() {
  registerServiceWorker();
  watchOnlineStatus();
  initCollapsibleSections();
  initForm();
  initEditor();
  initPlans();
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
