const express = require('express');
const PortfolioMath = require('./public/portfolio-math.js');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Google 登入設定 ----
// 設定 GOOGLE_CLIENT_ID 後啟用多人模式（每個 Google 帳號各自儲存自己的計畫）；
// 未設定則維持單人模式（所有人共用同一份資料，適合個人使用或本機開發）。
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const AUTH_ENABLED = !!GOOGLE_CLIENT_ID;
const SESSION_DAYS = 30;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

if (AUTH_ENABLED && !process.env.SESSION_SECRET) {
  console.warn('警告：未設定 SESSION_SECRET，已隨機產生 — 每次重新部署所有使用者都需重新登入。');
}

app.set('trust proxy', 1); // Railway 走反向代理，讓 secure cookie 與 req.secure 正確
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Session（HMAC 簽章的無狀態 token，存在 httpOnly cookie）----
function signSession(user) {
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.sub,
      email: user.email,
      name: user.name,
      picture: user.picture,
      exp: Date.now() + SESSION_DAYS * 86400_000,
    })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function verifySession(token) {
  try {
    const [payload, sig] = String(token).split('.');
    if (!payload || !sig) return null;
    const expect = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const user = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!user.sub || user.exp < Date.now()) return null;
    return user;
  } catch {
    return null;
  }
}

function getUser(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)session=([^;]+)/);
  return m ? verifySession(decodeURIComponent(m[1])) : null;
}

// 單人模式一律以 'legacy' 為 key；多人模式以 Google 帳號的 sub 為 key
function requireUser(req, res) {
  if (!AUTH_ENABLED) return { sub: 'legacy' };
  const user = getUser(req);
  if (!user) {
    res.status(401).json({ error: '請先登入' });
    return null;
  }
  return user;
}

// ---- Google ID token 驗證 ----
let verifyGoogleCredential = null;
if (AUTH_ENABLED) {
  const { OAuth2Client } = require('google-auth-library');
  const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);
  verifyGoogleCredential = async (credential) => {
    const ticket = await oauthClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    return ticket.getPayload();
  };
}

app.get('/api/config', (req, res) => {
  res.json({ authEnabled: AUTH_ENABLED, googleClientId: GOOGLE_CLIENT_ID });
});

app.get('/api/me', (req, res) => {
  res.json({ user: AUTH_ENABLED ? getUser(req) : null });
});

app.post('/api/auth/google', async (req, res) => {
  if (!AUTH_ENABLED) return res.status(400).json({ error: '此站未啟用 Google 登入' });
  try {
    const p = await verifyGoogleCredential(req.body?.credential);
    const user = { sub: p.sub, email: p.email || '', name: p.name || p.email || '使用者', picture: p.picture || '' };
    res.cookie('session', signSession(user), {
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
      maxAge: SESSION_DAYS * 86400_000,
    });
    res.json({ user });
  } catch (err) {
    console.error('Google 登入驗證失敗：', err.message);
    res.status(401).json({ error: 'Google 登入驗證失敗' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

// ---- 資料儲存：有 DATABASE_URL（Railway Postgres 自動注入）就用 Postgres，
//      否則存本機 JSON 檔（Railway 檔案系統重新部署會清空，僅適合本機開發）----
// readDoc(userId) → { doc, rev }
// writeDoc(userId, doc, expectedRev) → 新的 rev；expectedRev 不符時丟 ConflictError（樂觀鎖，
// 防止同帳號多裝置同時操作互相覆蓋）。expectedRev 傳 null 表示無條件覆寫（僅限相容舊客戶端）。
class ConflictError extends Error {}
let readDoc;
let writeDoc;
let listUserIds;

if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL;
  // Railway 內部網址（railway.internal）與本機不走 SSL；對外網址需要 SSL
  const needSSL = !/railway\.internal|localhost|127\.0\.0\.1/.test(url);
  const pool = new Pool({
    connectionString: url,
    ssl: needSSL ? { rejectUnauthorized: false } : false,
  });
  const ready = (async () => {
    await pool.query(
      'CREATE TABLE IF NOT EXISTS portfolios (user_id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())'
    );
    await pool.query('ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS rev BIGINT NOT NULL DEFAULT 0');
    // 從舊版單列 portfolio 資料表搬移既有資料到 'legacy'（只在第一次執行時發生）
    try {
      await pool.query(
        "INSERT INTO portfolios (user_id, data) SELECT 'legacy', data FROM portfolio WHERE id = 1 ON CONFLICT (user_id) DO NOTHING"
      );
    } catch {
      /* 舊資料表不存在就略過 */
    }
    console.log(`儲存後端：Postgres（${AUTH_ENABLED ? '多人模式' : '單人模式'}）`);
  })();

  readDoc = async (userId) => {
    await ready;
    const r = await pool.query('SELECT data, rev FROM portfolios WHERE user_id = $1', [userId]);
    return { doc: r.rows[0]?.data ?? { transactions: [] }, rev: Number(r.rows[0]?.rev ?? 0) };
  };
  writeDoc = async (userId, doc, expectedRev = null) => {
    await ready;
    const condition = expectedRev == null ? '' : 'WHERE portfolios.rev = $3';
    const params = expectedRev == null ? [userId, JSON.stringify(doc)] : [userId, JSON.stringify(doc), expectedRev];
    const r = await pool.query(
      `INSERT INTO portfolios (user_id, data, rev) VALUES ($1, $2, 1)
       ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, rev = portfolios.rev + 1, updated_at = now()
       ${condition}
       RETURNING rev`,
      params
    );
    if (!r.rowCount) throw new ConflictError('版本衝突');
    return Number(r.rows[0].rev);
  };
  listUserIds = async () => {
    await ready;
    const r = await pool.query('SELECT user_id FROM portfolios');
    return r.rows.map((row) => row.user_id);
  };
} else {
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
  console.log(`儲存後端：JSON 檔案（未設定 DATABASE_URL，${AUTH_ENABLED ? '多人模式' : '單人模式'}）`);

  const fileOf = (userId) =>
    userId === 'legacy'
      ? path.join(DATA_DIR, 'portfolio.json')
      : path.join(DATA_DIR, 'users', encodeURIComponent(userId) + '.json');

  readDoc = async (userId) => {
    try {
      const raw = JSON.parse(fs.readFileSync(fileOf(userId), 'utf8'));
      const { rev, ...doc } = raw;
      return { doc, rev: Number(rev) || 0 };
    } catch {
      return { doc: { transactions: [] }, rev: 0 };
    }
  };
  writeDoc = async (userId, doc, expectedRev = null) => {
    const { rev: currentRev } = await readDoc(userId);
    if (expectedRev != null && expectedRev !== currentRev) throw new ConflictError('版本衝突');
    const nextRev = currentRev + 1;
    const file = fileOf(userId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ ...doc, rev: nextRev }, null, 2));
    fs.renameSync(tmp, file);
    return nextRev;
  };
  listUserIds = async () => {
    const ids = [];
    if (fs.existsSync(fileOf('legacy'))) ids.push('legacy');
    const usersDir = path.join(DATA_DIR, 'users');
    try {
      for (const name of fs.readdirSync(usersDir)) {
        if (name.endsWith('.json')) ids.push(decodeURIComponent(name.slice(0, -5)));
      }
    } catch {
      /* 沒有使用者資料夾就略過 */
    }
    return ids;
  };
}

app.get('/api/portfolio', async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const { doc, rev } = await readDoc(user.sub);
    res.json({ ...doc, rev });
  } catch (err) {
    console.error('讀取失敗：', err.message);
    res.status(500).json({ error: '讀取資料失敗' });
  }
});

app.put('/api/portfolio', async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const body = req.body;
  if (!body || !Array.isArray(body.transactions)) {
    return res.status(400).json({ error: 'transactions 必須是陣列' });
  }
  const doc = { transactions: body.transactions };
  if (body.stocks !== undefined) {
    if (!Array.isArray(body.stocks)) {
      return res.status(400).json({ error: 'stocks 必須是陣列' });
    }
    doc.stocks = body.stocks;
  }
  if (body.budget !== undefined) {
    const budget = Number(body.budget);
    if (!(budget > 0)) {
      return res.status(400).json({ error: 'budget 必須是正數' });
    }
    doc.budget = budget;
  }
  if (body.snapshots !== undefined) {
    if (!Array.isArray(body.snapshots)) {
      return res.status(400).json({ error: 'snapshots 必須是陣列' });
    }
    doc.snapshots = body.snapshots;
  }
  try {
    // 樂觀鎖：客戶端帶上讀取時的 rev，不符表示其他裝置已改過 → 409 附最新資料
    const expectedRev = body.rev === undefined ? null : Number(body.rev);
    const rev = await writeDoc(user.sub, doc, Number.isNaN(expectedRev) ? null : expectedRev);
    res.json({ ok: true, rev });
  } catch (err) {
    if (err instanceof ConflictError) {
      const { doc: current, rev } = await readDoc(user.sub).catch(() => ({ doc: null, rev: null }));
      return res.status(409).json({ error: '資料已在其他裝置更新', current: current ? { ...current, rev } : null });
    }
    console.error('寫入失敗：', err.message);
    res.status(500).json({ error: '寫入資料失敗' });
  }
});

// ---- 報價代理（Yahoo Finance）----
const quoteCache = new Map(); // symbol -> { at, data }
const CACHE_MS = 60 * 1000;

async function fetchQuote(symbol) {
  const cached = quoteCache.get(symbol);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.data;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (portfolio-tracker)' },
  });
  if (!resp.ok) throw new Error(`Yahoo 回應 ${resp.status}`);
  const json = await resp.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta || meta.regularMarketPrice == null) throw new Error('無報價資料');
  const data = {
    symbol,
    price: meta.regularMarketPrice,
    previousClose: meta.chartPreviousClose ?? null,
    currency: meta.currency,
    marketTime: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
  };
  quoteCache.set(symbol, { at: Date.now(), data });
  return data;
}

const fxSymbolOf = PortfolioMath.fxSymbolOf;

function taipeiDateString(at = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

function nextTaipeiTwoPmDelayMs(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  })
    .formatToParts(now)
    .reduce((acc, p) => ((acc[p.type] = Number(p.value)), acc), {});
  const taipeiAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let targetTaipeiAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, 14, 0, 0);
  if (taipeiAsUtc >= targetTaipeiAsUtc) targetTaipeiAsUtc += 86400_000;
  return targetTaipeiAsUtc - taipeiAsUtc;
}

// 快照持股列：與前端共用 portfolio-math 的平均成本重放，只挑快照需要的欄位
function computeSnapshotRows(doc, quotes) {
  const stocks = Array.isArray(doc.stocks) ? doc.stocks : [];
  const txs = Array.isArray(doc.transactions) ? doc.transactions : [];
  return stocks.map((stock) => {
    const r = PortfolioMath.computeStock(stock, txs, quotes, 0);
    return {
      id: stock.id,
      name: stock.name,
      symbol: stock.symbol,
      currency: stock.currency,
      shares: r.shares,
      price: r.price,
      fx: r.fx,
      invested: r.invested,
      valueTWD: r.valueTWD,
      pnl: r.pnl,
    };
  });
}

async function createSnapshotForDoc(doc, source = 'manual') {
  const stocks = Array.isArray(doc.stocks) ? doc.stocks : [];
  const fxSyms = [...new Set(stocks.map((s) => fxSymbolOf(s.currency)).filter(Boolean))];
  const symbols = [...new Set([...stocks.map((s) => s.symbol), ...fxSyms].filter(Boolean))];
  const results = await Promise.allSettled(symbols.map(fetchQuote));
  const quotes = {};
  const errors = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') quotes[symbols[i]] = r.value;
    else errors[symbols[i]] = r.reason.message;
  });

  const holdings = computeSnapshotRows(doc, quotes);
  const totalInvested = holdings.reduce((s, r) => s + (r.invested ?? 0), 0);
  const anyValueMissing = holdings.some((r) => r.valueTWD == null);
  const totalValue = anyValueMissing ? null : holdings.reduce((s, r) => s + r.valueTWD, 0);
  const pnl = totalValue != null ? totalValue - totalInvested : null;
  const pnlPct = pnl != null && totalInvested > 0 ? pnl / totalInvested : null;

  return {
    date: taipeiDateString(),
    at: Date.now(),
    source,
    totalInvested,
    totalValue,
    pnl,
    pnlPct,
    holdings,
    quoteErrors: errors,
  };
}

function upsertSnapshot(doc, snapshot) {
  const snapshots = Array.isArray(doc.snapshots) ? doc.snapshots : [];
  return {
    ...doc,
    snapshots: [...snapshots.filter((s) => s.date !== snapshot.date), snapshot].sort((a, b) =>
      String(a.date).localeCompare(String(b.date))
    ),
  };
}

async function recordSnapshotForUser(userId, source = 'manual') {
  // 帶樂觀鎖的讀-改-寫；撞到其他寫入就重讀重試一次
  for (let attempt = 0; attempt < 2; attempt++) {
    const { doc, rev } = await readDoc(userId);
    const snapshot = await createSnapshotForDoc(doc, source);
    try {
      const newRev = await writeDoc(userId, upsertSnapshot(doc, snapshot), rev);
      return { snapshot, rev: newRev };
    } catch (err) {
      if (!(err instanceof ConflictError) || attempt === 1) throw err;
    }
  }
}

function inferCurrency(symbol, currency) {
  if (currency) return currency;
  if (symbol.endsWith('.TW') || symbol.endsWith('.TWO')) return 'TWD';
  if (symbol.endsWith('.KS')) return 'KRW';
  if (symbol.endsWith('.T')) return 'JPY';
  if (symbol.endsWith('.HK')) return 'HKD';
  return 'USD';
}

function normalizeSymbolResult(x) {
  return {
    symbol: x.symbol,
    name: x.shortname || x.longname || x.name || x.symbol,
    market: x.exchDisp || x.exchange || x.exch || x.typeDisp || '—',
    currency: inferCurrency(x.symbol, x.currency),
  };
}

app.get('/api/symbol-search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (q.length < 2) return res.status(400).json({ error: '請輸入至少 2 個字' });

  try {
    const urls = [
      'https://tw.stock.yahoo.com/_td-stock/api/resource/AutocompleteService;query=' + encodeURIComponent(q),
      'https://query2.finance.yahoo.com/v1/finance/search?quotesCount=8&newsCount=0&listsCount=0&q=' +
        encodeURIComponent(q),
    ];
    const responses = await Promise.allSettled(
      urls.map(async (url) => {
        const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (portfolio-tracker)' } });
        if (!resp.ok) throw new Error(`Yahoo 回應 ${resp.status}`);
        return resp.json();
      })
    );

    const twResults = responses[0].status === 'fulfilled' ? responses[0].value?.ResultSet?.Result || [] : [];
    const globalResults = responses[1].status === 'fulfilled' ? responses[1].value?.quotes || [] : [];
    const seen = new Set();
    const results = [...twResults, ...globalResults]
      .filter((x) => {
        if (!x.symbol || seen.has(x.symbol)) return false;
        seen.add(x.symbol);
        return true;
      })
      .filter((x) => !x.quoteType || x.quoteType === 'EQUITY' || x.quoteType === 'ETF')
      .filter((x) => x.exchange !== 'OPR' && x.exch !== 'OPR' && x.type !== 'O')
      .filter((x) => !/[A-Z]{1,6}\d{6}[CP]\d{8}/.test(x.symbol))
      .filter((x) => !/[購售牛熊]/.test(x.name || x.shortname || x.longname || ''))
      .map(normalizeSymbolResult)
      .slice(0, 8);
    res.json({ results });
  } catch (err) {
    console.error('Yahoo 代號搜尋失敗：', err.message);
    res.status(502).json({ error: 'Yahoo 代號搜尋失敗' });
  }
});

app.get('/api/quotes', async (req, res) => {
  const symbols = String(req.query.symbols || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60);
  if (!symbols.length) return res.status(400).json({ error: '缺少 symbols 參數' });

  const results = await Promise.allSettled(symbols.map(fetchQuote));
  const quotes = {};
  const errors = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') quotes[symbols[i]] = r.value;
    else errors[symbols[i]] = r.reason.message;
  });
  res.json({ quotes, errors, fetchedAt: Date.now() });
});

// ---- 歷史日線代理（回推每日市值用）----
const histCache = new Map(); // symbol|range -> { at, data }
const HIST_CACHE_MS = 15 * 60 * 1000;
const HIST_RANGES = new Set(['1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max']);

async function fetchHistory(symbol, range) {
  const key = symbol + '|' + range;
  const cached = histCache.get(key);
  if (cached && Date.now() - cached.at < HIST_CACHE_MS) return cached.data;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (portfolio-tracker)' } });
  if (!resp.ok) throw new Error(`Yahoo 回應 ${resp.status}`);
  const json = await resp.json();
  const result = json?.chart?.result?.[0];
  const ts = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const points = [];
  for (let i = 0; i < ts.length; i++) {
    if (closes[i] != null) points.push([ts[i] * 1000, closes[i]]);
  }
  if (!points.length) throw new Error('無歷史資料');
  histCache.set(key, { at: Date.now(), data: points });
  return points;
}

app.get('/api/history', async (req, res) => {
  const range = String(req.query.range || '3mo');
  if (!HIST_RANGES.has(range)) return res.status(400).json({ error: 'range 無效' });
  const symbols = String(req.query.symbols || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60);
  if (!symbols.length) return res.status(400).json({ error: '缺少 symbols 參數' });

  const results = await Promise.allSettled(symbols.map((s) => fetchHistory(s, range)));
  const series = {};
  const errors = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') series[symbols[i]] = r.value;
    else errors[symbols[i]] = r.reason.message;
  });
  res.json({ series, errors, fetchedAt: Date.now() });
});

// ---- 分割與配息事件代理（分割偵測、未記帳配息提醒用）----
const eventsCache = new Map(); // symbol -> { at, data }
const EVENTS_CACHE_MS = 6 * 60 * 60 * 1000;

async function fetchEvents(symbol) {
  const cached = eventsCache.get(symbol);
  if (cached && Date.now() - cached.at < EVENTS_CACHE_MS) return cached.data;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=max&interval=1d&events=div%2Csplit`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (portfolio-tracker)' } });
  if (!resp.ok) throw new Error(`Yahoo 回應 ${resp.status}`);
  const json = await resp.json();
  const events = json?.chart?.result?.[0]?.events || {};
  const dividends = Object.values(events.dividends || {})
    .filter((d) => d.date != null && d.amount != null)
    .map((d) => [d.date * 1000, d.amount])
    .sort((a, b) => a[0] - b[0]);
  const splits = Object.values(events.splits || {})
    .filter((s) => s.date != null && s.numerator != null && s.denominator != null)
    .map((s) => [s.date * 1000, s.numerator, s.denominator])
    .sort((a, b) => a[0] - b[0]);
  const data = { dividends, splits };
  eventsCache.set(symbol, { at: Date.now(), data });
  return data;
}

app.get('/api/events', async (req, res) => {
  const symbols = String(req.query.symbols || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60);
  if (!symbols.length) return res.status(400).json({ error: '缺少 symbols 參數' });

  const results = await Promise.allSettled(symbols.map(fetchEvents));
  const events = {};
  const errors = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') events[symbols[i]] = r.value;
    else errors[symbols[i]] = r.reason.message;
  });
  res.json({ events, errors, fetchedAt: Date.now() });
});

app.post('/api/snapshots/today', async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const { snapshot, rev } = await recordSnapshotForUser(user.sub, 'manual');
    res.json({ snapshot, rev });
  } catch (err) {
    console.error('記錄市值快照失敗：', err.message);
    res.status(500).json({ error: '記錄市值快照失敗' });
  }
});

async function recordScheduledSnapshots() {
  try {
    const userIds = await listUserIds();
    for (const userId of userIds) {
      const { doc } = await readDoc(userId);
      if (!Array.isArray(doc.transactions) || !doc.transactions.length) continue;
      await recordSnapshotForUser(userId, 'scheduled');
    }
    console.log(`每日市值快照完成：${taipeiDateString()}，${userIds.length} 個使用者`);
  } catch (err) {
    console.error('每日市值快照失敗：', err.message);
  }
}

function scheduleDailySnapshots() {
  const delay = nextTaipeiTwoPmDelayMs();
  setTimeout(async () => {
    await recordScheduledSnapshots();
    scheduleDailySnapshots();
  }, delay);
  console.log(`下一次每日市值快照排程：${Math.round(delay / 60_000)} 分鐘後（台北 14:00）`);
}

app.listen(PORT, () => {
  console.log(`Portfolio tracker listening on port ${PORT}`);
  scheduleDailySnapshots();
});
