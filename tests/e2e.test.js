'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { startServer } = require('./helpers');

// CHROMIUM_PATH 可指定瀏覽器執行檔；否則優先用 Claude Code 沙箱的預裝路徑，再退回 Playwright 預設解析
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium';
const chromiumPath = process.env.CHROMIUM_PATH || (fs.existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined);

// ---- 測試資料：平日日期序列與決定性的價格 ----
function weekdays(n) {
  const out = [];
  let d = new Date();
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() - 86400_000);
  }
  return out;
}

const DATES = weekdays(80);
const priceOf = {
  '2330.TW': (i) => 1000 + i,
  'TSM': (i) => 230 + 0.2 * i,
  '2308.TW': (i) => 400 + 0.5 * i,
  'TWD=X': () => 29,
  '0050.TW': (i) => 190 + 0.3 * i,
};

function mockHistory(symbols) {
  const series = {};
  for (const sym of symbols) {
    const fn = priceOf[sym];
    if (!fn) continue;
    series[sym] = DATES.map((d, i) => [Date.parse(d), fn(i)]);
  }
  return { series, errors: {}, fetchedAt: Date.now() };
}

function mockQuotes() {
  const quotes = {};
  const last = DATES.length - 1;
  for (const [sym, fn] of Object.entries(priceOf)) {
    quotes[sym] = { symbol: sym, price: fn(last), previousClose: fn(last - 1), currency: sym === 'TSM' ? 'USD' : 'TWD' };
  }
  return { quotes, errors: {}, fetchedAt: Date.now() };
}

// 交易：60 個平日前買 2330、40 前買 TSM（指定台幣成本）、10 前賣 2330 200 股、5 前配息
const TXS = [
  { id: 'b1', stockId: '2330', date: DATES[DATES.length - 60], shares: 1000, price: 1000, twdCost: null },
  { id: 'b2', stockId: 'TSM', date: DATES[DATES.length - 40], shares: 100, price: 230, twdCost: 700000 },
  { id: 's1', stockId: '2330', date: DATES[DATES.length - 10], shares: -200, price: 1080, twdCost: null },
  { id: 'd1', stockId: '2330', date: DATES[DATES.length - 5], kind: 'dividend', amount: 10000, twdCost: null },
];

test('端對端：已實現損益、歷史回推圖、XIRR、編輯與 CSV 匯入', { timeout: 120_000 }, async (t) => {
  const srv = await startServer();
  const browser = await chromium.launch({ executablePath: chromiumPath, timeout: 30_000 });
  t.after(async () => {
    await browser.close();
    srv.stop();
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.route('**/api/quotes*', (r) => r.fulfill({ json: mockQuotes() }));
  await page.route('**/api/history*', (r) => {
    const u = new URL(r.request().url());
    r.fulfill({ json: mockHistory(u.searchParams.get('symbols').split(',')) });
  });

  // 種入交易
  const put = await fetch(srv.url + '/api/portfolio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rev: 0, transactions: TXS }),
  });
  assert.equal(put.status, 200);

  await page.goto(srv.url);
  await page.waitForFunction(() => document.querySelectorAll('.pnl-bar').length > 0, { timeout: 15000 });

  // --- 已實現損益：賣出 200 股 @1080（平均成本 1000）＋ 股利 10,000 = +26,000 ---
  assert.equal(await page.textContent('#kpi-realized'), '+NT$26,000');
  assert.ok((await page.textContent('#kpi-realized-sub')).includes('NT$10,000'));

  // --- 歷史回推：圖表來源為歷史價格 ---
  assert.ok((await page.textContent('#snapshot-subtitle')).includes('回推'));
  const seriesData = await page.evaluate(() => computeDailySeries());
  assert.ok(seriesData.length > 50, '應回推出 50 個以上交易日');

  // 買入 TSM 當天（投入 70 萬）的當日損益不應把入金算成獲利
  const buyDay = seriesData.find((p) => p.date === TXS[1].date);
  assert.ok(buyDay, '應包含 TSM 買入日');
  assert.equal(buyDay.flow, 700000);
  assert.ok(Math.abs(buyDay.dPnl) < 50000, `當日損益 ${buyDay.dPnl} 不應包含 70 萬入金`);

  // 配息日的當日損益應含 +10,000
  const divDay = seriesData.find((p) => p.date === TXS[3].date);
  assert.ok(divDay && divDay.dividendToday === 10000);

  // 賣出日：已實現獲利日，當日損益不應出現 -21.6 萬（賣出金流誤算）
  const sellDay = seriesData.find((p) => p.date === TXS[2].date);
  assert.ok(sellDay && Math.abs(sellDay.dPnl) < 50000, `賣出日損益 ${sellDay.dPnl} 異常`);

  // --- XIRR 有值 ---
  const summary = await page.textContent('.snapshot-summary');
  assert.ok(summary.includes('年化報酬率'));
  assert.ok(!/年化報酬率\s*—/.test(summary.replace(/\s+/g, ' ')), 'XIRR 應有數值');

  // --- 0050 對比線 ---
  await page.check('#bench-toggle');
  await page.waitForTimeout(300);
  assert.ok(await page.locator('.bench-line').count(), '開啟後應畫出 0050 對比線');
  assert.ok((await page.textContent('.snapshot-legend')).includes('0050'));

  // --- 顯示範圍切換 ---
  await page.click('#hist-range-control button[data-range="1mo"]');
  await page.waitForTimeout(300);
  const bars1mo = await page.locator('.pnl-bar').count();
  await page.click('#hist-range-control button[data-range="all"]');
  await page.waitForTimeout(300);
  const barsAll = await page.locator('.pnl-bar').count();
  assert.ok(barsAll > bars1mo, `全部(${barsAll}) 應多於 1月(${bars1mo})`);

  // --- 交易列表：類型 chip 與配息列 ---
  const txText = await page.textContent('#tx-body');
  assert.ok(txText.includes('息') && txText.includes('賣') && txText.includes('買'));

  // --- 編輯交易：把賣出 200 股改成 300 股 ---
  await page.locator('#tx-body tr', { hasText: '賣' }).first().locator('.tx-edit').click();
  assert.equal(await page.textContent('#tx-form-title'), '編輯交易');
  await page.fill('#tx-shares', '-300');
  await page.click('#tx-submit');
  await page.waitForTimeout(400);
  assert.equal(await page.textContent('#tx-form-title'), '新增交易'); // 表單已重置
  // 已實現變為 300×80 + 10000 = 34,000
  assert.equal(await page.textContent('#kpi-realized'), '+NT$34,000');

  // --- 新增配息（表單）---
  await page.selectOption('#tx-kind', 'dividend');
  assert.ok(await page.locator('#tx-amount-label').isVisible());
  assert.ok(await page.locator('#tx-shares-label').isHidden());
  await page.selectOption('#tx-stock', '2330');
  await page.fill('#tx-amount', '5000');
  await page.click('#tx-submit');
  await page.waitForTimeout(400);
  assert.equal(await page.textContent('#kpi-realized'), '+NT$39,000');

  // --- CSV 匯入 ---
  const csv = [
    'date,stock,shares,price,twd,kind',
    `${DATES[DATES.length - 20]},2330,100,995,,`,
    `${DATES[DATES.length - 19]},台達電,50,400,,`,
    `${DATES[DATES.length - 18]},TSM,,120,,息`,
  ].join('\n');
  const txCountBefore = await page.locator('#tx-body tr').count();
  await page.setInputFiles('#csv-file', { name: 'txs.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.waitForTimeout(600);
  assert.equal(await page.locator('#tx-body tr').count(), txCountBefore + 3);

  // --- 資料有存進伺服器且 rev 有跟上（沒有出現 409 蓋資料）---
  const saved = await (await fetch(srv.url + '/api/portfolio')).json();
  assert.equal(saved.transactions.length, txCountBefore + 3);
  assert.ok(saved.rev >= 4);
  assert.ok(await page.locator('#notice').isHidden(), '不應出現錯誤提示');

  assert.deepEqual(jsErrors, [], 'JS errors: ' + jsErrors.join('; '));
});
