const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Railway 的檔案系統重啟後會清空；掛載 Volume 時把 DATA_DIR 指到掛載點即可保留資料
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'portfolio.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { transactions: [] };
  }
}

function writeData(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

app.get('/api/portfolio', (req, res) => {
  res.json(readData());
});

app.put('/api/portfolio', (req, res) => {
  const body = req.body;
  if (!body || !Array.isArray(body.transactions)) {
    return res.status(400).json({ error: 'transactions 必須是陣列' });
  }
  writeData({ transactions: body.transactions });
  res.json({ ok: true });
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
