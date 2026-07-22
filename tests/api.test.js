'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
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

  for (const bad of [{}, { transactions: 'x' }, { transactions: [], budget: -1 }, { transactions: [], stocks: 'x' }]) {
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
