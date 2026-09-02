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

test('computeStock：賣出股數超過既有股數（現行為：股數可為負、只移除既有成本）', () => {
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

test('computeStock：股數為零且無報價 → 市值 0；股數大於零但無報價 → 市值 null', () => {
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

// ---------- kind:'split' 分割重放 ----------

test('computeStock：分割後股數×比例、成本不變、均價÷比例（手算）', () => {
  // 買 10@1,000＝10,000；分割 1→10 → 100 股、成本仍 10,000、原幣均價 100
  // 再賣 50@120：入帳 6,000，移除成本 100×50（台幣均價 10,000/100）＝5,000 → 已實現 +1,000
  const txs = [
    { stockId: 'aaa', date: '2026-01-05', shares: 10, price: 1000 },
    { stockId: 'aaa', date: '2026-02-01', kind: 'split', ratio: 10 },
    { stockId: 'aaa', date: '2026-02-10', shares: -50, price: 120 },
  ];
  const r = PM.computeStock(TW_STOCK, txs, { 'AAA.TW': { price: 120 } }, 0);
  assert.equal(r.shares, 50);
  assert.equal(r.invested, 5_000);
  assert.equal(r.avgCost, 100);
  assert.equal(r.realized, 1_000);
  assert.equal(r.valueTWD, 6_000);
});

test('computeXirr：split 交易不產生現金流（結果與無 split 相同）', () => {
  const txs = [
    { stockId: 'aaa', date: '2021-01-01', shares: 100, price: 10 },
    { stockId: 'aaa', date: '2021-06-01', kind: 'split', ratio: 2 },
  ];
  const r = PM.computeXirr({
    rows: [{ valueTWD: 1100 }],
    stocks: [TW_STOCK],
    transactions: txs,
    quotes: { 'AAA.TW': { price: 1 } },
    today: '2022-01-01',
  });
  assert.ok(Math.abs(r - 0.1) < 1e-6, `expect 0.1, got ${r}`);
});

test('computeDailySeries：分割期間市值連續（Yahoo 調整後收盤×調整後股數，手算）', () => {
  // Yahoo 收盤為分割調整後：01-05→50、01-06→55、01-07→55（實際 01-05 收 100、01-06 收 110、01-07 分割 2:1 收 55）
  // 買 10@100（入金 1,000）於 01-05；split 2:1 於 01-07
  // 調整後股數＝10×2＝20：01-05 值 1,000、01-06 值 1,100、01-07 值 1,100（分割日不得出現假損益）
  const txs = [
    { stockId: 'aaa', date: '2026-01-05', shares: 10, price: 100 },
    { stockId: 'aaa', date: '2026-01-07', kind: 'split', ratio: 2 },
  ];
  const hist = {
    series: {
      'AAA.TW': [
        [D(2026, 1, 5), 50],
        [D(2026, 1, 6), 55],
        [D(2026, 1, 7), 55],
      ],
    },
  };
  const out = PM.computeDailySeries({
    history: hist,
    stocks: [TW_STOCK],
    transactions: txs,
    quotes: {},
    budget: 0,
    benchSymbol: '0050.TW',
    today: '2026-02-01',
  });
  assert.deepEqual(
    out.map((p) => [p.date, p.value, p.flow]),
    [
      ['2026-01-05', 1000, 1000],
      ['2026-01-06', 1100, 0],
      ['2026-01-07', 1100, 0],
    ]
  );
  assert.equal(out[2].dPnl, 0); // 分割日無假損益
});

// ---------- 分割與配息偵測 ----------

test('detectUnappliedSplits：未套用→回報；已套用/已忽略/早於首買→不回報', () => {
  const buy = { stockId: 'aaa', date: '2026-01-05', shares: 10, price: 1000 };
  const splitEvent = [D(2026, 2, 1), 10, 1]; // 2026-02-01 分割 10:1

  // 未套用 → 回報 ratio 10
  const found = PM.detectUnappliedSplits({ stock: TW_STOCK, transactions: [buy], splits: [splitEvent], ignored: [] });
  assert.equal(found.length, 1);
  assert.equal(found[0].date, '2026-02-01');
  assert.equal(found[0].ratio, 10);

  // 已有 7 天內的 split 交易 → 視為已套用
  const applied = { stockId: 'aaa', date: '2026-02-03', kind: 'split', ratio: 10 };
  assert.equal(
    PM.detectUnappliedSplits({ stock: TW_STOCK, transactions: [buy, applied], splits: [splitEvent], ignored: [] }).length,
    0
  );

  // 已忽略 → 不回報
  assert.equal(
    PM.detectUnappliedSplits({
      stock: TW_STOCK,
      transactions: [buy],
      splits: [splitEvent],
      ignored: ['split:AAA.TW:2026-02-01'],
    }).length,
    0
  );

  // 分割日早於第一筆買入 → 當天沒有股數，與這個計畫無關
  assert.equal(
    PM.detectUnappliedSplits({ stock: TW_STOCK, transactions: [buy], splits: [[D(2025, 6, 1), 2, 1]], ignored: [] }).length,
    0
  );
});

test('detectUnappliedSplits：分割前已全數賣出→不提醒；比例不符的分割紀錄→仍提醒', () => {
  const buy = { stockId: 'aaa', date: '2026-01-05', shares: 10, price: 1000 };
  const splitEvent = [D(2026, 2, 1), 10, 1];

  // 分割前已全數賣出 → 當天股數 0，不該再提醒
  const sellAll = { stockId: 'aaa', date: '2026-01-20', shares: -10, price: 1100 };
  assert.equal(
    PM.detectUnappliedSplits({ stock: TW_STOCK, transactions: [buy, sellAll], splits: [splitEvent], ignored: [] }).length,
    0
  );

  // 已有一筆 2:1 紀錄（比例不符）→ 那是另一次分割，10:1 仍要提醒
  const wrongRatio = { stockId: 'aaa', date: '2026-02-02', kind: 'split', ratio: 2 };
  const found = PM.detectUnappliedSplits({
    stock: TW_STOCK,
    transactions: [buy, wrongRatio],
    splits: [splitEvent],
    ignored: [],
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].ratio, 10);
});

test('detectUnrecordedDividends：未記帳→回報估算；30 天內已記/無股數/已忽略→不回報', () => {
  const buy = { stockId: 'aaa', date: '2026-01-05', shares: 100, price: 500 };
  const divEvent = [D(2026, 3, 10), 4.5]; // 2026-03-10 除息，每股 4.5

  // 未記帳 → 估算 = 4.5 × 100 = 450（原幣）
  const found = PM.detectUnrecordedDividends({ stock: TW_STOCK, transactions: [buy], dividends: [divEvent], ignored: [] });
  assert.equal(found.length, 1);
  assert.equal(found[0].date, '2026-03-10');
  assert.equal(found[0].perShare, 4.5);
  assert.equal(found[0].estimatedAmount, 450);

  // 除息日後 30 天內已有配息交易 → 視為已記帳
  const recorded = { stockId: 'aaa', date: '2026-03-25', kind: 'dividend', twdCost: 450 };
  assert.equal(
    PM.detectUnrecordedDividends({ stock: TW_STOCK, transactions: [buy, recorded], dividends: [divEvent], ignored: [] }).length,
    0
  );

  // 除息日已無股數 → 不回報
  const sellAll = { stockId: 'aaa', date: '2026-02-01', shares: -100, price: 550 };
  assert.equal(
    PM.detectUnrecordedDividends({ stock: TW_STOCK, transactions: [buy, sellAll], dividends: [divEvent], ignored: [] }).length,
    0
  );

  // 已忽略 → 不回報
  assert.equal(
    PM.detectUnrecordedDividends({
      stock: TW_STOCK,
      transactions: [buy],
      dividends: [divEvent],
      ignored: ['div:AAA.TW:2026-03-10'],
    }).length,
    0
  );
});

test('detectUnrecordedDividends：估算股數採分割調整後（每股金額為調整後口徑）', () => {
  // 買 10 股，除息在後、分割（2:1）更在除息之後：
  // Yahoo 的每股配息為調整後口徑 → 估算應用調整後股數 10×2＝20；每股 2.25 → 估 45
  const txs = [{ stockId: 'aaa', date: '2026-01-05', shares: 10, price: 1000 }];
  const found = PM.detectUnrecordedDividends({
    stock: TW_STOCK,
    transactions: txs,
    dividends: [[D(2026, 2, 10), 2.25]],
    splits: [[D(2026, 3, 1), 2, 1]],
    ignored: [],
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].estimatedAmount, 45); // 2.25 × 20
});

// ---------- computeXirr（年化報酬率）----------
// 期望值來自獨立來源：Microsoft Excel XIRR 函數文件範例，以及可解析驗證的精確構造案例。

const xirrArgs = (transactions, rows, today) => ({
  rows,
  stocks: [TW_STOCK],
  transactions,
  quotes: { 'AAA.TW': { price: 1 } },
  today,
});

test('computeXirr：整年 +10%（-1000 → 一年後 1100）＝ 0.1', () => {
  // 2021-01-01 買入 1,000；2022-01-01（相隔 365 天）市值 1,100 → (1+r)^1 = 1.1
  const txs = [{ stockId: 'aaa', date: '2021-01-01', shares: 100, price: 10 }];
  const r = PM.computeXirr(xirrArgs(txs, [{ valueTWD: 1100 }], '2022-01-01'));
  assert.ok(Math.abs(r - 0.1) < 1e-6, `expect 0.1, got ${r}`);
});

test('computeXirr：Microsoft XIRR 文件範例 ≈ 0.373362535', () => {
  // https://support.microsoft.com/en-us/office/xirr-function
  // 金流：-10,000（2008-01-01）、+2,750（2008-03-01）、+4,250（2008-10-30）、
  //       +3,250（2009-02-15）、+2,750（2009-04-01）→ XIRR = 0.373362535
  const txs = [
    { stockId: 'aaa', date: '2008-01-01', shares: 1000, price: 10, twdCost: 10_000 },
    { stockId: 'aaa', date: '2008-03-01', shares: -100, price: 27.5, twdCost: 2_750 },
    { stockId: 'aaa', date: '2008-10-30', shares: -100, price: 42.5, twdCost: 4_250 },
    { stockId: 'aaa', date: '2009-02-15', shares: -100, price: 32.5, twdCost: 3_250 },
  ];
  const r = PM.computeXirr(xirrArgs(txs, [{ valueTWD: 2_750 }], '2009-04-01'));
  assert.ok(Math.abs(r - 0.373362535) < 1e-6, `expect 0.373362535, got ${r}`);
});

test('computeXirr：配息為正現金流（精確構造 r=0.1）', () => {
  // -1,000（2021-01-01）＋ 股利 550（2022-01-01）＋ 期末市值 605（2023-01-01）
  // NPV(0.1) = -1000 + 550/1.1 + 605/1.21 = -1000 + 500 + 500 = 0（各段恰為 365 天）
  const txs = [
    { stockId: 'aaa', date: '2021-01-01', shares: 100, price: 10 },
    { stockId: 'aaa', date: '2022-01-01', kind: 'dividend', twdCost: 550 },
  ];
  const r = PM.computeXirr(xirrArgs(txs, [{ valueTWD: 605 }], '2023-01-01'));
  assert.ok(Math.abs(r - 0.1) < 1e-6, `expect 0.1, got ${r}`);
});

// ---------- computeDailySeries（歷史回推）----------
// 期望值皆為手算。日期以 UTC ms 表示（與 Yahoo 歷史序列一致）。

const D = (y, m, d) => Date.UTC(y, m - 1, d);
const HIST_AAA = [
  [D(2026, 1, 5), 100],
  [D(2026, 1, 6), 110],
  [D(2026, 1, 7), 105],
];

const seriesArgs = (transactions, extra = {}) => ({
  history: { series: { 'AAA.TW': HIST_AAA, ...(extra.series || {}) } },
  stocks: [TW_STOCK],
  transactions,
  quotes: extra.quotes || {},
  budget: 0,
  benchSymbol: '0050.TW',
  today: extra.today || '2026-02-01',
});

test('computeDailySeries：買入當日入金不產生假損益（手算）', () => {
  // 01-05 買 10@100（入金 1,000）；01-06 加碼 10@110（入金 1,100）
  // 01-06 市值 2,200：當日損益 = 2,200 − 1,000 − 1,100 = +100（只有舊持股的漲幅）
  const txs = [
    { stockId: 'aaa', date: '2026-01-05', shares: 10, price: 100 },
    { stockId: 'aaa', date: '2026-01-06', shares: 10, price: 110 },
  ];
  const out = PM.computeDailySeries(seriesArgs(txs));
  assert.equal(out.length, 3);
  assert.deepEqual(
    out.map((p) => [p.date, p.value, p.invested, p.flow]),
    [
      ['2026-01-05', 1000, 1000, 1000],
      ['2026-01-06', 2200, 2100, 1100],
      ['2026-01-07', 2100, 2100, 0],
    ]
  );
  assert.equal(out[0].dPnl, null);
  assert.equal(out[1].dPnl, 100);
  assert.ok(Math.abs(out[1].dPct - 0.1) < 1e-12);
  assert.equal(out[2].dPnl, -100);
});

test('computeDailySeries：賣出當日金流不誤算成損益（手算）', () => {
  // 01-07 賣 5@105（入帳 525）：市值 15×105=1,575
  // 當日損益 = 1,575 − 2,200 − (−525) = −100（真跌價，賣出入帳不算獲利）
  const txs = [
    { stockId: 'aaa', date: '2026-01-05', shares: 10, price: 100 },
    { stockId: 'aaa', date: '2026-01-06', shares: 10, price: 110 },
    { stockId: 'aaa', date: '2026-01-07', shares: -5, price: 105 },
  ];
  const out = PM.computeDailySeries(seriesArgs(txs));
  const last = out[out.length - 1];
  assert.equal(last.value, 1575);
  assert.equal(last.flow, -525);
  assert.equal(last.dPnl, -100);
});

test('computeDailySeries：配息當日計入當日損益、不動市值與成本', () => {
  // 01-07 配息 50：當日損益 = 2,100 − 2,200 − 0 + 50 = −50
  const txs = [
    { stockId: 'aaa', date: '2026-01-05', shares: 10, price: 100 },
    { stockId: 'aaa', date: '2026-01-06', shares: 10, price: 110 },
    { stockId: 'aaa', date: '2026-01-07', kind: 'dividend', twdCost: 50 },
  ];
  const out = PM.computeDailySeries(seriesArgs(txs));
  const last = out[out.length - 1];
  assert.equal(last.invested, 2100);
  assert.equal(last.dividendToday, 50);
  assert.equal(last.dPnl, -50);
});

test('computeDailySeries：0050 對比線＝同日同額投入（手算）', () => {
  // 0050 收盤 50/55/52.5；01-05 投入 1,000 → 20 單位；01-06 投入 1,100 → +20 單位
  const txs = [
    { stockId: 'aaa', date: '2026-01-05', shares: 10, price: 100 },
    { stockId: 'aaa', date: '2026-01-06', shares: 10, price: 110 },
  ];
  const bench = [
    [D(2026, 1, 5), 50],
    [D(2026, 1, 6), 55],
    [D(2026, 1, 7), 52.5],
  ];
  const out = PM.computeDailySeries(seriesArgs(txs, { series: { '0050.TW': bench } }));
  assert.deepEqual(
    out.map((p) => [p.date, p.bench]),
    [
      ['2026-01-05', 1000], // 20 × 50
      ['2026-01-06', 2200], // 40 × 55
      ['2026-01-07', 2100], // 40 × 52.5
    ]
  );
});

test('computeDailySeries：歷史沒有今天但有即時報價 → 補上今日點', () => {
  const txs = [
    { stockId: 'aaa', date: '2026-01-05', shares: 10, price: 100 },
    { stockId: 'aaa', date: '2026-01-06', shares: 10, price: 110 },
  ];
  const out = PM.computeDailySeries(
    seriesArgs(txs, { quotes: { 'AAA.TW': { price: 120 } }, today: '2026-01-08' })
  );
  const last = out[out.length - 1];
  assert.equal(last.date, '2026-01-08');
  assert.equal(last.value, 2400); // 20 × 120
  assert.equal(last.invested, 2100);
  assert.equal(last.dPnl, 300); // 2400 − 2100 − 0
});

test('computeDailySeries：無歷史收盤價或無交易 → null', () => {
  assert.equal(PM.computeDailySeries(seriesArgs([])), null);
  assert.equal(
    PM.computeDailySeries({ ...seriesArgs([{ stockId: 'aaa', date: '2026-01-05', shares: 1, price: 1 }]), history: null }),
    null
  );
});

// ---------- computeMonthlyReport（月報）----------
// 期望值手算：TWR＝當月 (1+dPct) 連乘 −1；0050 當月＝月末收盤 vs 月初前最後收盤。

test('computeMonthlyReport：兩個月手算案例（投入、配息、損益、TWR、0050 對比）', () => {
  const series = [
    { date: '2026-01-30', value: 1000, invested: 1000, flow: 1000, dividendToday: 0, dPnl: null, dPct: null },
    { date: '2026-01-31', value: 1020, invested: 1000, flow: 0, dividendToday: 0, dPnl: 20, dPct: 0.02 },
    { date: '2026-02-01', value: 2120, invested: 2100, flow: 1100, dividendToday: 0, dPnl: 0, dPct: 0 },
    { date: '2026-02-02', value: 2226, invested: 2100, flow: 0, dividendToday: 50, dPnl: 156, dPct: 156 / 2120 },
  ];
  const benchCloses = [
    [D(2026, 1, 30), 100],
    [D(2026, 1, 31), 102],
    [D(2026, 2, 1), 104],
    [D(2026, 2, 2), 107.1],
  ];
  const rows = PM.computeMonthlyReport({ series, benchCloses });
  assert.equal(rows.length, 2);

  const jan = rows[0];
  assert.equal(jan.month, '2026-01');
  assert.equal(jan.flow, 1000);
  assert.equal(jan.dividends, 0);
  assert.equal(jan.pnl, 20);
  assert.ok(Math.abs(jan.twr - 0.02) < 1e-12); // 唯一有 dPct 的一天 +2%
  assert.ok(Math.abs(jan.benchPct - 0.02) < 1e-12); // 100 → 102（首月以月內第一筆為基準）

  const feb = rows[1];
  assert.equal(feb.month, '2026-02');
  assert.equal(feb.flow, 1100);
  assert.equal(feb.dividends, 50);
  assert.equal(feb.pnl, 156);
  assert.ok(Math.abs(feb.twr - 156 / 2120) < 1e-12); // (1+0)(1+156/2120)−1
  assert.ok(Math.abs(feb.benchPct - 0.05) < 1e-12); // 102 → 107.1，5.1/102
});

test('computeMonthlyReport：當月無交易時投入與配息為 0，仍計算 TWR', () => {
  const series = [
    { date: '2026-01-05', value: 1000, invested: 1000, flow: 1000, dividendToday: 0, dPnl: null, dPct: null },
    { date: '2026-02-10', value: 1100, invested: 1000, flow: 0, dividendToday: 0, dPnl: 100, dPct: 0.1 },
    { date: '2026-02-20', value: 1210, invested: 1000, flow: 0, dividendToday: 0, dPnl: 110, dPct: 0.1 },
  ];
  const rows = PM.computeMonthlyReport({ series, benchCloses: [] });
  const feb = rows[1];
  assert.equal(feb.month, '2026-02');
  assert.equal(feb.flow, 0);
  assert.equal(feb.dividends, 0);
  assert.equal(feb.pnl, 210);
  assert.ok(Math.abs(feb.twr - 0.21) < 1e-12); // 1.1 × 1.1 − 1
});

test('computeDailySeries：配息記在休市日，仍計入下一個交易日的當日損益（回歸）', () => {
  // 歷史序列只有 01-05 與 01-07（01-06 休市）；配息 100 記在 01-06
  const txs = [
    { stockId: 'aaa', date: '2026-01-05', shares: 10, price: 100 },
    { stockId: 'aaa', date: '2026-01-06', kind: 'dividend', twdCost: 100 },
  ];
  const hist = {
    series: {
      'AAA.TW': [
        [D(2026, 1, 5), 100],
        [D(2026, 1, 7), 100],
      ],
    },
  };
  const out = PM.computeDailySeries({
    history: hist,
    stocks: [TW_STOCK],
    transactions: txs,
    quotes: {},
    budget: 0,
    benchSymbol: '0050.TW',
    today: '2026-02-01',
  });
  const last = out[out.length - 1];
  assert.equal(last.date, '2026-01-07');
  assert.equal(last.dividendToday, 100); // 不得因為 01-06 沒有資料點而被丟棄
  assert.equal(last.dPnl, 100); // 市值持平（1000→1000），損益全來自配息
});

test('computeMonthlyReport：無序列 → 空陣列；無 0050 資料 → benchPct null', () => {
  assert.deepEqual(PM.computeMonthlyReport({ series: null, benchCloses: [] }), []);
  const rows = PM.computeMonthlyReport({
    series: [{ date: '2026-01-05', value: 100, invested: 100, flow: 100, dividendToday: 0, dPnl: null, dPct: null }],
    benchCloses: [],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].benchPct, null);
  assert.equal(rows[0].twr, null); // 沒有任何 dPct
});

test('computeXirr：期間不足 30 天、市值缺漏、無交易 → null', () => {
  const txs = [{ stockId: 'aaa', date: '2026-01-01', shares: 100, price: 10 }];
  assert.equal(PM.computeXirr(xirrArgs(txs, [{ valueTWD: 1100 }], '2026-01-15')), null); // < 30 天
  assert.equal(PM.computeXirr(xirrArgs(txs, [{ valueTWD: null }], '2027-01-01')), null); // 市值未知
  assert.equal(PM.computeXirr(xirrArgs([], [{ valueTWD: 1100 }], '2027-01-01')), null); // 無金流
});

// ---------- 多計畫：交易篩選 ----------

test('transactionsInPlan：只留下掛在該計畫的交易，同時掛多個計畫的兩邊都算', () => {
  const txs = [
    { id: 'a', plans: ['p1'] },
    { id: 'b', plans: ['p2'] },
    { id: 'c', plans: ['p1', 'p2'] },
  ];
  assert.deepEqual(
    PM.transactionsInPlan(txs, 'p1').map((t) => t.id),
    ['a', 'c']
  );
  assert.deepEqual(
    PM.transactionsInPlan(txs, 'p2').map((t) => t.id),
    ['b', 'c']
  );
  assert.deepEqual(PM.transactionsInPlan(txs, 'p3'), []);
});

test('transactionsInPlan：沒有計畫標籤的交易在每個計畫都看得到（不會憑空消失）', () => {
  // 遷移會補上標籤；萬一有漏網之魚，寧可到處都看得到讓使用者發現，也不要整筆從畫面上消失
  const txs = [{ id: 'x' }, { id: 'y', plans: [] }, { id: 'z', plans: ['p1'] }];
  assert.deepEqual(
    PM.transactionsInPlan(txs, 'p1').map((t) => t.id),
    ['x', 'y', 'z']
  );
  assert.deepEqual(
    PM.transactionsInPlan(txs, 'p2').map((t) => t.id),
    ['x', 'y']
  );
});

// ---------- 多計畫：帳號資料遷移 ----------

test('migratePortfolio：舊格式長出「主要計畫」，交易與快照補上歸屬', () => {
  const legacy = {
    budget: 5_000_000,
    stocks: [
      { id: '2330', percent: 25 },
      { id: 'NVDA', percent: 7 },
      { id: 'IDLE', percent: 0 },
    ],
    transactions: [{ id: 't1', stockId: '2330', date: '2026-01-05', shares: 100, price: 1000 }],
    snapshots: [{ date: '2026-01-05', totalValue: 100_000 }],
  };
  const out = PM.migratePortfolio(legacy);

  assert.equal(out.plans.length, 1);
  const plan = out.plans[0];
  assert.equal(plan.name, '主要計畫');
  assert.equal(plan.budget, 5_000_000);
  assert.deepEqual(plan.allocations, { '2330': 25, NVDA: 7 }); // 比例 0 的標的不排進來
  assert.deepEqual(out.transactions[0].plans, [plan.id]);
  assert.equal(out.snapshots[0].planId, plan.id);

  // 不就地修改輸入
  assert.equal(legacy.transactions[0].plans, undefined);
  assert.equal(legacy.snapshots[0].planId, undefined);
});

test('migratePortfolio：無 budget 用預設 500 萬；再跑一次完全不變（幂等）', () => {
  const once = PM.migratePortfolio({
    stocks: [{ id: '2330', percent: 100 }],
    transactions: [{ id: 't1', stockId: '2330', date: '2026-01-05', shares: 1, price: 1 }],
  });
  assert.equal(once.plans[0].budget, 5_000_000);

  const twice = PM.migratePortfolio(once);
  assert.deepEqual(twice, once);
});

test('migratePortfolio：已有計畫時不再建新計畫，只補齊缺歸屬的交易與快照', () => {
  const doc = {
    plans: [
      { id: 'p1', name: '信貸', budget: 1_500_000, allocations: { '2330': 40 } },
      { id: 'p2', name: '退休', budget: 5_000_000, allocations: {} },
    ],
    transactions: [
      { id: 'a', plans: ['p2'] },
      { id: 'b' }, // 漏網之魚 → 補第一個計畫
    ],
    snapshots: [{ date: '2026-01-05', planId: 'p2' }, { date: '2026-01-06' }],
  };
  const out = PM.migratePortfolio(doc);
  assert.equal(out.plans.length, 2);
  assert.equal(out.plans[0].name, '信貸');
  assert.deepEqual(out.transactions[0].plans, ['p2']);
  assert.deepEqual(out.transactions[1].plans, ['p1']);
  assert.equal(out.snapshots[0].planId, 'p2');
  assert.equal(out.snapshots[1].planId, 'p1');
});

test('同一檔標的分屬兩個計畫：各自的平均成本與已實現損益互不干擾（手算）', () => {
  // 信貸：買 100@500=50,000；共用那筆再買 20@500=10,000 → 120 股、成本 60,000
  // 退休：買 200@600=120,000；賣 50@700 入帳 35,000、移除均價 600×50=30,000 → 已實現 +5,000、餘 150 股成本 90,000
  //       共用那筆再買 20@500=10,000 → 170 股、成本 100,000
  // 現價 650 → 信貸市值 120×650=78,000、未實現 +18,000；退休市值 170×650=110,500、未實現 +10,500
  const txs = [
    { id: 'a1', stockId: 'aaa', date: '2026-01-05', shares: 100, price: 500, plans: ['credit'] },
    { id: 'b1', stockId: 'aaa', date: '2026-01-05', shares: 200, price: 600, plans: ['retire'] },
    { id: 'b2', stockId: 'aaa', date: '2026-01-06', shares: -50, price: 700, plans: ['retire'] },
    { id: 'both', stockId: 'aaa', date: '2026-01-07', shares: 20, price: 500, plans: ['credit', 'retire'] },
  ];
  const quotes = { 'AAA.TW': { price: 650 } };

  const credit = PM.computeStock(TW_STOCK, PM.transactionsInPlan(txs, 'credit'), quotes, 0);
  assert.equal(credit.shares, 120);
  assert.equal(credit.invested, 60_000);
  assert.equal(credit.avgCost, 500);
  assert.equal(credit.realized, 0);
  assert.equal(credit.valueTWD, 78_000);
  assert.equal(credit.pnl, 18_000);

  const retire = PM.computeStock(TW_STOCK, PM.transactionsInPlan(txs, 'retire'), quotes, 0);
  assert.equal(retire.shares, 170);
  assert.equal(retire.invested, 100_000);
  assert.equal(retire.realized, 5_000);
  assert.equal(retire.valueTWD, 110_500);
  assert.equal(retire.pnl, 10_500);
});

test('單一計畫的 XIRR：另一計畫的雜訊交易不得影響結果（沿用 Microsoft 文件範例）', () => {
  // 與上面的 Microsoft XIRR 文件範例同一組金流，但額外混入一批屬於別的計畫的交易。
  // 篩選後結果必須與原案例一模一樣：0.373362535
  const txs = [
    { stockId: 'aaa', date: '2008-01-01', shares: 1000, price: 10, twdCost: 10_000, plans: ['retire'] },
    { stockId: 'aaa', date: '2008-03-01', shares: -100, price: 27.5, twdCost: 2_750, plans: ['retire'] },
    { stockId: 'aaa', date: '2008-10-30', shares: -100, price: 42.5, twdCost: 4_250, plans: ['retire'] },
    { stockId: 'aaa', date: '2009-02-15', shares: -100, price: 32.5, twdCost: 3_250, plans: ['retire'] },
    // 雜訊：信貸計畫的交易
    { stockId: 'aaa', date: '2008-06-01', shares: 500, price: 20, twdCost: 10_000, plans: ['credit'] },
    { stockId: 'aaa', date: '2009-01-01', shares: -200, price: 50, twdCost: 10_000, plans: ['credit'] },
  ];
  const r = PM.computeXirr(xirrArgs(PM.transactionsInPlan(txs, 'retire'), [{ valueTWD: 2_750 }], '2009-04-01'));
  assert.ok(Math.abs(r - 0.373362535) < 1e-6, `expect 0.373362535, got ${r}`);
});

// ---------- 多計畫：刪除計畫 ----------

test('transactionsOnlyInPlan：只有「唯一標籤就是這個計畫」的交易才算孤兒', () => {
  const txs = [
    { id: 'only', plans: ['credit'] },
    { id: 'both', plans: ['credit', 'retire'] },
    { id: 'other', plans: ['retire'] },
    { id: 'untagged' }, // 沒有標籤 = 每個計畫都看得到，不算孤兒
  ];
  assert.deepEqual(
    PM.transactionsOnlyInPlan(txs, 'credit').map((t) => t.id),
    ['only']
  );
});

test('removePlan：孤兒交易一併刪除，共用的交易只移除這個標籤', () => {
  const doc = {
    plans: [
      { id: 'credit', name: '信貸', budget: 1_500_000, allocations: {} },
      { id: 'retire', name: '退休', budget: 5_000_000, allocations: {} },
    ],
    transactions: [
      { id: 'only', plans: ['credit'] },
      { id: 'both', plans: ['credit', 'retire'] },
      { id: 'other', plans: ['retire'] },
    ],
    snapshots: [
      { date: '2026-01-05', planId: 'credit' },
      { date: '2026-01-05', planId: 'retire' },
    ],
  };
  const out = PM.removePlan(doc, 'credit');

  assert.deepEqual(out.plans.map((p) => p.id), ['retire']);
  assert.deepEqual(out.transactions.map((t) => t.id), ['both', 'other']);
  assert.deepEqual(out.transactions[0].plans, ['retire']); // 共用的只掉標籤
  assert.deepEqual(out.snapshots.map((s) => s.planId), ['retire']);

  // 不就地修改輸入
  assert.equal(doc.transactions.length, 3);
  assert.deepEqual(doc.transactions[1].plans, ['credit', 'retire']);
});

// ---------- 多計畫：從既有計畫複製 ----------

test('copyTransactionsToPlan：複製為獨立副本（新 id、只掛新計畫），來源不受影響', () => {
  const txs = [
    { id: 'a', stockId: '2330', date: '2026-01-05', shares: 100, price: 1000, plans: ['credit'] },
    { id: 'b', stockId: 'NVDA', date: '2026-02-01', shares: 10, price: 180, plans: ['credit', 'retire'] },
    { id: 'c', stockId: 'MU', date: '2026-03-01', shares: 5, price: 100, plans: ['retire'] },
  ];
  let n = 0;
  const copies = PM.copyTransactionsToPlan(txs, 'credit', 'fresh', () => 'copy-' + ++n);

  assert.deepEqual(copies.map((t) => t.id), ['copy-1', 'copy-2']); // 只複製看得到 credit 的那兩筆
  assert.deepEqual(copies.map((t) => t.stockId), ['2330', 'NVDA']);
  assert.equal(copies[0].shares, 100);
  assert.equal(copies[0].price, 1000);
  for (const c of copies) assert.deepEqual(c.plans, ['fresh']); // 副本只掛新計畫

  // 來源完全不受影響
  assert.equal(txs.length, 3);
  assert.deepEqual(txs[0].plans, ['credit']);
  assert.deepEqual(txs[1].plans, ['credit', 'retire']);
});

// ---------- 多計畫：某日持有該標的的計畫 ----------

test('plansHoldingOn：分割日／除息日當天持有該標的的計畫才需要處理', () => {
  const plans = [{ id: 'credit' }, { id: 'retire' }, { id: 'empty' }];
  const txs = [
    { stockId: 'aaa', date: '2026-01-01', shares: 100, price: 10, plans: ['credit'] },
    { stockId: 'aaa', date: '2026-02-15', shares: -100, price: 12, plans: ['credit'] }, // 信貸在 2/15 出清
    { stockId: 'aaa', date: '2026-03-01', shares: 50, price: 11, plans: ['retire'] },
    { stockId: 'bbb', date: '2026-01-01', shares: 10, price: 5, plans: ['empty'] }, // 別檔標的不算
  ];
  assert.deepEqual(PM.plansHoldingOn(plans, txs, 'aaa', '2026-02-01'), ['credit']);
  assert.deepEqual(PM.plansHoldingOn(plans, txs, '2026-02-20' && 'aaa', '2026-02-20'), []); // 信貸已出清、退休還沒買
  assert.deepEqual(PM.plansHoldingOn(plans, txs, 'aaa', '2026-03-01'), ['retire']);
  assert.deepEqual(PM.plansHoldingOn(plans, txs, 'bbb', '2026-01-01'), ['empty']);
});

test('單一計畫的月報：另一計畫的雜訊交易不得影響結果（手算）', () => {
  // 收盤：01-05 = 100、01-06 = 110、02-02 = 121
  // 退休計畫 01-05 買 10@100 → 投入 1,000、市值 1,000
  //   01-06 市值 1,100，當日損益 +100、dPct = 100/1,000 = 10%
  //   02-02 市值 1,210，當日損益 +110、dPct = 110/1,100 = 10%
  // 月報：2026-01 投入 1,000、損益 +100、TWR 10%；2026-02 投入 0、損益 +110、TWR 10%
  const history = {
    series: {
      'AAA.TW': [
        [D(2026, 1, 5), 100],
        [D(2026, 1, 6), 110],
        [D(2026, 2, 2), 121],
      ],
    },
  };
  const txs = [
    { stockId: 'aaa', date: '2026-01-05', shares: 10, price: 100, plans: ['retire'] },
    // 雜訊：信貸計畫在同一天買了五倍的量
    { stockId: 'aaa', date: '2026-01-05', shares: 50, price: 100, plans: ['credit'] },
  ];
  const series = PM.computeDailySeries({
    history,
    stocks: [TW_STOCK],
    transactions: PM.transactionsInPlan(txs, 'retire'),
    quotes: {},
    budget: 0,
    benchSymbol: '0050.TW',
    today: '2026-02-02',
  });
  const rows = PM.computeMonthlyReport({ series, benchCloses: [] });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].month, '2026-01');
  assert.equal(rows[0].flow, 1000);
  assert.equal(rows[0].pnl, 100);
  assert.ok(Math.abs(rows[0].twr - 0.1) < 1e-12);
  assert.equal(rows[1].month, '2026-02');
  assert.equal(rows[1].flow, 0);
  assert.equal(rows[1].pnl, 110);
  assert.ok(Math.abs(rows[1].twr - 0.1) < 1e-12);
});

test('computeStock：純記錄型計畫（無總預算）沒有目標金額與達成率', () => {
  // 買 100@500 = 50,000；無總預算 → 目標金額 0、達成率 null（不是 0，也不是 Infinity）
  const txs = [{ stockId: 'aaa', date: '2026-01-05', shares: 100, price: 500 }];
  const r = PM.computeStock(TW_STOCK, txs, { 'AAA.TW': { price: 600 } }, 0);
  assert.equal(r.invested, 50_000);
  assert.equal(r.valueTWD, 60_000);
  assert.equal(r.pnl, 10_000); // 損益照算
  assert.equal(r.targetTWD, 0);
  assert.equal(r.progress, null);
});

// ---------- 交易紀錄的時間區間篩選（只影響列表顯示，不影響任何計算）----------

test('transactionDateWindow：本月／今年為日曆區間（含頭含尾），近3月為滾動起算', () => {
  const today = '2026-09-02';
  assert.deepEqual(PM.transactionDateWindow({ preset: 'all', today }), { from: null, to: null });
  assert.deepEqual(PM.transactionDateWindow({ preset: 'month', today }), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(PM.transactionDateWindow({ preset: 'year', today }), { from: '2026-01-01', to: '2026-12-31' });
  // 近3月：往前推三個日曆月的同一天
  assert.deepEqual(PM.transactionDateWindow({ preset: '3mo', today }), { from: '2026-06-02', to: null });
});

test('transactionDateWindow：跨年與月底日的邊界', () => {
  // 跨年：2026-02-10 往前三個月 → 2025-11-10
  assert.deepEqual(PM.transactionDateWindow({ preset: '3mo', today: '2026-02-10' }), { from: '2025-11-10', to: null });
  // 月底夾擠：5/31 往前三個月是 2/31（不存在）→ 取該月最後一天 2/28
  assert.deepEqual(PM.transactionDateWindow({ preset: '3mo', today: '2026-05-31' }), { from: '2026-02-28', to: null });
  // 閏年 2028/2 有 29 天
  assert.deepEqual(PM.transactionDateWindow({ preset: '3mo', today: '2028-05-31' }), { from: '2028-02-29', to: null });
  // 二月的「本月」尾巴要落在 28/29
  assert.deepEqual(PM.transactionDateWindow({ preset: 'month', today: '2026-02-15' }), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(PM.transactionDateWindow({ preset: 'month', today: '2028-02-15' }), { from: '2028-02-01', to: '2028-02-29' });
});

test('transactionDateWindow：自訂區間可只給單邊，未知 preset 視為全部', () => {
  const today = '2026-09-02';
  assert.deepEqual(PM.transactionDateWindow({ preset: 'custom', from: '2026-03-01', to: '2026-03-31', today }), {
    from: '2026-03-01',
    to: '2026-03-31',
  });
  assert.deepEqual(PM.transactionDateWindow({ preset: 'custom', from: '2026-03-01', today }), { from: '2026-03-01', to: null });
  assert.deepEqual(PM.transactionDateWindow({ preset: 'custom', to: '2026-03-31', today }), { from: null, to: '2026-03-31' });
  assert.deepEqual(PM.transactionDateWindow({ preset: 'custom', today }), { from: null, to: null });
  assert.deepEqual(PM.transactionDateWindow({ preset: 'bogus', today }), { from: null, to: null });
});

test('filterTransactionsByDate：兩端皆含，開放端不設限', () => {
  const txs = [
    { id: 'a', date: '2026-02-28' },
    { id: 'b', date: '2026-03-01' },
    { id: 'c', date: '2026-03-31' },
    { id: 'd', date: '2026-04-01' },
  ];
  const ids = (w) => PM.filterTransactionsByDate(txs, w).map((t) => t.id);
  assert.deepEqual(ids({ from: '2026-03-01', to: '2026-03-31' }), ['b', 'c'], '起訖日本身要包含在內');
  assert.deepEqual(ids({ from: '2026-03-01', to: null }), ['b', 'c', 'd']);
  assert.deepEqual(ids({ from: null, to: '2026-03-01' }), ['a', 'b']);
  assert.deepEqual(ids({ from: null, to: null }), ['a', 'b', 'c', 'd']);
});
