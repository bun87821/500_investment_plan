'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PM = require('../public/portfolio-math.js');

// ---------- fxSymbolOf ----------

test('fxSymbolOf：TWD 免換匯、USD 用 TWD=X、其他幣別用 <幣別>TWD=X', () => {
  assert.equal(PM.fxSymbolOf('TWD'), null);
  assert.equal(PM.fxSymbolOf('USD'), 'TWD=X');
  assert.equal(PM.fxSymbolOf('KRW'), 'KRWTWD=X');
  assert.equal(PM.fxSymbolOf('JPY'), 'JPYTWD=X');
});

// ---------- computeStock（平均成本重放）----------
// 期望值皆為手算：見各案例內的算式註記。

const TW_STOCK = { id: 'aaa', name: '測試', symbol: 'AAA.TW', currency: 'TWD', percent: 10 };
const US_STOCK = { id: 'usa', name: '美股', symbol: 'USA', currency: 'USD', percent: 10 };

test('computeStock：買入→加碼→部分賣出的平均成本與已實現損益（手算）', () => {
  // 買 100@500=50,000；加碼 100@600=60,000 → 200 股、成本 110,000、均價 550
  // 賣 50@700：入帳 35,000，移除成本 550×50=27,500 → 已實現 +7,500，餘 150 股、成本 82,500
  // 現價 650 → 市值 97,500，未實現 = 97,500 − 82,500 = 15,000
  const txs = [
    { stockId: 'aaa', date: '2026-01-05', shares: 100, price: 500 },
    { stockId: 'aaa', date: '2026-01-06', shares: 100, price: 600 },
    { stockId: 'aaa', date: '2026-01-07', shares: -50, price: 700 },
  ];
  const quotes = { 'AAA.TW': { price: 650, previousClose: 640 } };
  const r = PM.computeStock(TW_STOCK, txs, quotes, 1_000_000);
  assert.equal(r.shares, 150);
  assert.equal(r.invested, 82_500);
  assert.equal(r.avgCost, 550);
  assert.equal(r.realized, 7_500);
  assert.equal(r.valueTWD, 97_500);
  assert.equal(r.pnl, 15_000);
  assert.equal(r.fx, 1);
  assert.equal(r.targetTWD, 100_000); // 1,000,000 × 10%
  assert.equal(r.progress, 0.825); // 82,500 / 100,000
});

test('computeStock：交易順序依日期重放（亂序輸入結果相同）', () => {
  const txs = [
    { stockId: 'aaa', date: '2026-01-07', shares: -50, price: 700 },
    { stockId: 'aaa', date: '2026-01-05', shares: 100, price: 500 },
    { stockId: 'aaa', date: '2026-01-06', shares: 100, price: 600 },
  ];
  const r = PM.computeStock(TW_STOCK, txs, { 'AAA.TW': { price: 650 } }, 0);
  assert.equal(r.invested, 82_500);
  assert.equal(r.realized, 7_500);
});

test('computeStock：賣超過持股（現行為：股數可為負、只移除既有成本）', () => {
  // 買 100@10=1,000；賣 150@12：入帳 1,800，僅移除 100 股成本 1,000 → 已實現 +800、餘 -50 股、成本 0
  const txs = [
    { stockId: 'aaa', date: '2026-01-05', shares: 100, price: 10 },
    { stockId: 'aaa', date: '2026-01-06', shares: -150, price: 12 },
  ];
  const r = PM.computeStock(TW_STOCK, txs, { 'AAA.TW': { price: 12 } }, 0);
  assert.equal(r.shares, -50);
  assert.equal(r.invested, 0);
  assert.equal(r.realized, 800);
});

test('computeStock：現金股利計入 dividends、不影響股數與成本', () => {
  // 股利 twdCost 500；另一筆美股股利 amount 10、匯率 30 → 300
  const txs = [
    { stockId: 'aaa', date: '2026-01-05', shares: 100, price: 500 },
    { stockId: 'aaa', date: '2026-02-01', kind: 'dividend', twdCost: 500 },
  ];
  const r = PM.computeStock(TW_STOCK, txs, { 'AAA.TW': { price: 500 } }, 0);
  assert.equal(r.dividends, 500);
  assert.equal(r.shares, 100);
  assert.equal(r.invested, 50_000);

  const usTxs = [
    { stockId: 'usa', date: '2026-01-05', shares: 10, price: 100 },
    { stockId: 'usa', date: '2026-02-01', kind: 'dividend', amount: 10 },
  ];
  const usQuotes = { USA: { price: 100 }, 'TWD=X': { price: 30 } };
  const us = PM.computeStock(US_STOCK, usTxs, usQuotes, 0);
  assert.equal(us.dividends, 300); // 10 × 30
  assert.equal(us.invested, 30_000); // 10 × 100 × 30
});

test('computeStock：twdCost 覆寫優先於 股數×價格×匯率', () => {
  // 買 10@100 USD、實際台幣成本 31,000（非 30,000）
  const txs = [{ stockId: 'usa', date: '2026-01-05', shares: 10, price: 100, twdCost: 31_000 }];
  const quotes = { USA: { price: 100 }, 'TWD=X': { price: 30 } };
  const r = PM.computeStock(US_STOCK, txs, quotes, 0);
  assert.equal(r.invested, 31_000);
  assert.equal(r.valueTWD, 30_000); // 市值仍用現價×匯率
});

test('computeStock：外幣缺匯率且無 twdCost → invested/realized/dividends 為 null', () => {
  const txs = [{ stockId: 'usa', date: '2026-01-05', shares: 10, price: 100 }];
  const r = PM.computeStock(US_STOCK, txs, { USA: { price: 100 } }, 0);
  assert.equal(r.invested, null);
  assert.equal(r.realized, null);
  assert.equal(r.dividends, null);
  assert.equal(r.valueTWD, null); // 有持股但無匯率 → 市值未知
  assert.equal(r.fx, null);
});

test('computeStock：無持股且無報價 → 市值 0；有持股無報價 → 市值 null', () => {
  const none = PM.computeStock(TW_STOCK, [], {}, 0);
  assert.equal(none.shares, 0);
  assert.equal(none.valueTWD, 0);
  assert.equal(none.invested, 0);

  const held = PM.computeStock(TW_STOCK, [{ stockId: 'aaa', date: '2026-01-05', shares: 100, price: 500 }], {}, 0);
  assert.equal(held.valueTWD, null);
  assert.equal(held.pnl, null);
});

test('computeStock：日漲跌 dayChange = (現價−昨收)/昨收', () => {
  const r = PM.computeStock(TW_STOCK, [], { 'AAA.TW': { price: 110, previousClose: 100 } }, 0);
  assert.ok(Math.abs(r.dayChange - 0.1) < 1e-12);
});
