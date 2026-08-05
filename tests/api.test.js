'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, signSession } = require('./helpers');

test('單人模式：portfolio 讀寫與樂觀鎖', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());

  // 初始為空、rev 0
  let res = await fetch(srv.url + '/api/portfolio');
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.deepEqual(body.transactions, []);
  assert.equal(body.rev, 0);

  // rev 0 寫入成功 → rev 1
  res = await fetch(srv.url + '/api/portfolio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rev: 0, budget: 8_000_000, transactions: [{ id: 't1', stockId: '2330', date: '2026-01-05', shares: 100, price: 1000 }] }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).rev, 1);

  // 過期的 rev 0 再寫 → 409 並附最新資料
  res = await fetch(srv.url + '/api/portfolio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rev: 0, transactions: [] }),
  });
  assert.equal(res.status, 409);
  body = await res.json();
  assert.equal(body.current.rev, 1);
  assert.equal(body.current.transactions.length, 1);
  assert.equal(body.current.budget, 8_000_000);

  // 正確的 rev 1 → 成功；不帶 rev（舊客戶端）也成功
  res = await fetch(srv.url + '/api/portfolio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rev: 1, transactions: [] }),
  });
  assert.equal(res.status, 200);
  res = await fetch(srv.url + '/api/portfolio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions: [] }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).rev, 3);
});

test('PUT 驗證：不合法輸入回 400', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());

  // ignoredEvents：合法（字串陣列）可寫入並讀回
  let res = await fetch(srv.url + '/api/portfolio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions: [], ignoredEvents: ['split:NVDA:2024-06-10'] }),
  });
  assert.equal(res.status, 200);
  res = await fetch(srv.url + '/api/portfolio');
  assert.deepEqual((await res.json()).ignoredEvents, ['split:NVDA:2024-06-10']);

  for (const bad of [
    {},
    { transactions: 'x' },
    { transactions: [], budget: -1 },
    { transactions: [], stocks: 'x' },
    { transactions: [], ignoredEvents: 'x' },
    { transactions: [], ignoredEvents: [1, 2] },
  ]) {
    const res = await fetch(srv.url + '/api/portfolio', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bad),
    });
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
});

test('多人模式：未登入 401、帳號資料隔離、偽簽章被拒', async (t) => {
  const SECRET = 'test-secret';
  const srv = await startServer({ GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', SESSION_SECRET: SECRET });
  t.after(() => srv.stop());

  // 未登入 → 401
  let res = await fetch(srv.url + '/api/portfolio');
  assert.equal(res.status, 401);

  const cookieA = 'session=' + signSession({ sub: 'userA', email: 'a@t.co', name: 'A', picture: '' }, SECRET);
  const cookieB = 'session=' + signSession({ sub: 'userB', email: 'b@t.co', name: 'B', picture: '' }, SECRET);

  // userA 寫入
  res = await fetch(srv.url + '/api/portfolio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({ rev: 0, transactions: [{ id: 'a1', stockId: 'NVDA', date: '2026-02-01', shares: 10, price: 180 }] }),
  });
  assert.equal(res.status, 200);

  // userB 看不到 userA 的資料
  res = await fetch(srv.url + '/api/portfolio', { headers: { Cookie: cookieB } });
  assert.deepEqual((await res.json()).transactions, []);

  // userA 讀回自己的
  res = await fetch(srv.url + '/api/portfolio', { headers: { Cookie: cookieA } });
  assert.equal((await res.json()).transactions.length, 1);

  // 錯誤密鑰簽的 cookie → 401
  const forged = 'session=' + signSession({ sub: 'userA', email: 'a@t.co', name: 'A', picture: '' }, 'wrong-secret');
  res = await fetch(srv.url + '/api/portfolio', { headers: { Cookie: forged } });
  assert.equal(res.status, 401);

  // /api/me 未登入回 null、登入回使用者
  res = await fetch(srv.url + '/api/me');
  assert.equal((await res.json()).user, null);
  res = await fetch(srv.url + '/api/me', { headers: { Cookie: cookieA } });
  assert.equal((await res.json()).user.sub, 'userA');
});

test('報價與歷史端點：缺參數回 400', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());

  assert.equal((await fetch(srv.url + '/api/quotes')).status, 400);
  assert.equal((await fetch(srv.url + '/api/history?symbols=2330.TW&range=bogus')).status, 400);
  assert.equal((await fetch(srv.url + '/api/history?range=3mo')).status, 400);
});

test('PWA：manifest 與 service worker 可取得且欄位齊全', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());

  const res = await fetch(srv.url + '/manifest.json');
  assert.equal(res.status, 200);
  const manifest = await res.json();
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.name && manifest.short_name);
  assert.ok(manifest.theme_color && manifest.background_color);
  for (const size of ['192x192', '512x512']) {
    assert.ok(manifest.icons.some((i) => i.sizes === size && i.type === 'image/png'), size + ' 圖示');
  }
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'), 'maskable 圖示');

  for (const icon of manifest.icons) {
    assert.equal((await fetch(srv.url + '/' + icon.src)).status, 200, icon.src);
  }
  assert.equal((await fetch(srv.url + '/sw.js')).status, 200);
});

test('事件端點：缺 symbols 回 400', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());

  assert.equal((await fetch(srv.url + '/api/events')).status, 400);
  assert.equal((await fetch(srv.url + '/api/events?symbols=')).status, 400);
});

test('事件端點：解析分割與配息、第二次請求走快取不重打上游', async (t) => {
  // 以測試替身取代 Yahoo，並計算上游被打了幾次
  let upstreamHits = 0;
  const upstream = http.createServer((req, res) => {
    upstreamHits++;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        chart: {
          result: [
            {
              events: {
                dividends: { '1': { date: 1772064000, amount: 4.5 } },
                splits: { '2': { date: 1772668800, numerator: 10, denominator: 1 } },
              },
            },
          ],
        },
      })
    );
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  t.after(() => upstream.close());

  const srv = await startServer({ YAHOO_CHART_BASE: `http://127.0.0.1:${upstream.address().port}` });
  t.after(() => srv.stop());

  const first = await (await fetch(srv.url + '/api/events?symbols=AAA.TW')).json();
  assert.deepEqual(first.events['AAA.TW'].dividends, [[1772064000 * 1000, 4.5]]);
  assert.deepEqual(first.events['AAA.TW'].splits, [[1772668800 * 1000, 10, 1]]);
  assert.equal(upstreamHits, 1);

  const second = await (await fetch(srv.url + '/api/events?symbols=AAA.TW')).json();
  assert.deepEqual(second.events, first.events);
  assert.equal(upstreamHits, 1, '第二次應命中快取，不重打上游');
});

test('PUT 驗證：plans 與交易歸屬', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());

  // 合法的 plans 可寫入並讀回
  let res = await fetch(srv.url + '/api/portfolio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transactions: [{ id: 't1', stockId: '2330', date: '2026-01-05', shares: 100, price: 1000, plans: ['p1'] }],
      plans: [
        { id: 'p1', name: '信貸', budget: 1_500_000, allocations: { '2330': 40 } },
        { id: 'p2', name: '退休', budget: 5_000_000, allocations: {} },
      ],
      snapshots: [{ date: '2026-01-05', planId: 'p2', totalValue: 100_000 }],
    }),
  });
  assert.equal(res.status, 200);

  const body = await (await fetch(srv.url + '/api/portfolio')).json();
  assert.equal(body.plans.length, 2);
  assert.equal(body.plans[0].name, '信貸');
  assert.deepEqual(body.plans[0].allocations, { '2330': 40 });
  assert.deepEqual(body.transactions[0].plans, ['p1']);
  assert.equal(body.snapshots[0].planId, 'p2');

  for (const bad of [
    { transactions: [], plans: 'x' },
    { transactions: [], plans: [{ name: '沒有 id', budget: 1 }] },
    { transactions: [], plans: [{ id: 'p1', budget: 1 }] },
    { transactions: [], plans: [{ id: 'p1', name: '預算為零', budget: 0 }] },
    { transactions: [], plans: [{ id: 'p1', name: 'A', budget: 1 }, { id: 'p1', name: 'B', budget: 1 }] },
    { transactions: [], plans: [{ id: 'p1', name: 'A', budget: 1, allocations: 'x' }] },
    { transactions: [{ id: 't1', plans: 'x' }] },
    { transactions: [{ id: 't1', plans: [] }] },
    { transactions: [{ id: 't1', plans: [1] }] },
  ]) {
    const res = await fetch(srv.url + '/api/portfolio', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bad),
    });
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
});

test('舊格式帳號資料寫入後回讀，帶有遷移結果', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());

  const res = await fetch(srv.url + '/api/portfolio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      budget: 8_000_000,
      stocks: [{ id: '2330', name: '台積電', symbol: '2330.TW', currency: 'TWD', percent: 25 }],
      transactions: [{ id: 't1', stockId: '2330', date: '2026-01-05', shares: 100, price: 1000 }],
      snapshots: [{ date: '2026-01-05', totalValue: 100_000 }],
    }),
  });
  assert.equal(res.status, 200);

  const body = await (await fetch(srv.url + '/api/portfolio')).json();
  assert.equal(body.plans.length, 1);
  assert.equal(body.plans[0].name, '主要計畫');
  assert.equal(body.plans[0].budget, 8_000_000);
  assert.deepEqual(body.plans[0].allocations, { '2330': 25 });
  assert.deepEqual(body.transactions[0].plans, [body.plans[0].id]);
  assert.equal(body.snapshots[0].planId, body.plans[0].id);
});
