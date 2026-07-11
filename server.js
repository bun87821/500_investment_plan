const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- 資料儲存：有 DATABASE_URL（Railway Postgres 自動注入）就用 Postgres，
//      否則存本機 JSON 檔（Railway 檔案系統重新部署會清空，僅適合本機開發）----
let readData;
let writeData;

if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL;
  // Railway 內部網址（railway.internal）與本機不走 SSL；對外網址需要 SSL
  const needSSL = !/railway\.internal|localhost|127\.0\.0\.1/.test(url);
  const pool = new Pool({
    connectionString: url,
    ssl: needSSL ? { rejectUnauthorized: false } : false,
  });
  const ready = pool
    .query('CREATE TABLE IF NOT EXISTS portfolio (id INTEGER PRIMARY KEY, data JSONB NOT NULL)')
    .then(() => console.log('儲存後端：Postgres'));

  readData = async () => {
    await ready;
    const r = await pool.query('SELECT data FROM portfolio WHERE id = 1');
    return r.rows[0]?.data ?? { transactions: [] };
  };
  writeData = async (data) => {
    await ready;
    await pool.query(
      'INSERT INTO portfolio (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
      [JSON.stringify(data)]
    );
  };
} else {
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
  const DATA_FILE = path.join(DATA_DIR, 'portfolio.json');
  console.log('儲存後端：JSON 檔案（未設定 DATABASE_URL）');

  readData = async () => {
    try {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
      return { transactions: [] };
    }
  };
  writeData = async (data) => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  };
}

app.get('/api/portfolio', async (req, res) => {
  try {
    res.json(await readData());
  } catch (err) {
    console.error('讀取失敗：', err.message);
    res.status(500).json({ error: '讀取資料失敗' });
  }
});

app.put('/api/portfolio', async (req, res) => {
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
  try {
    await writeData(doc);
    res.json({ ok: true });
  } catch (err) {
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

app.get('/api/quotes', async (req, res) => {
  const symbols = String(req.query.symbols || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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

app.listen(PORT, () => {
  console.log(`Portfolio tracker listening on port ${PORT}`);
});
