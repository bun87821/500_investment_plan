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

  // --- 再平衡建議 ---
  // 依總預算（預設）：台達電目標 7%×500萬＝35 萬、現價 439.5 → 建議買入 796 股
  let rebalanceText = await page.textContent('#rebalance-body');
  assert.ok(rebalanceText.includes('台達電'), '未持有的台達電應出現加碼建議');
  assert.ok(rebalanceText.includes('買入') && rebalanceText.includes('796'), `應建議買入 796 股：${rebalanceText.slice(0, 200)}`);
  // 依目前市值：2330 佔比遠超 25% → 應出現減碼建議
  await page.click('#rebalance-base-control button[data-base="value"]');
  await page.waitForTimeout(300);
  rebalanceText = await page.textContent('#rebalance-body');
  assert.ok(rebalanceText.includes('減碼'), '依市值再平衡應出現減碼建議');
  await page.click('#rebalance-base-control button[data-base="budget"]');
  await page.waitForTimeout(200);

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

test('端對端：計畫分頁切換後數字跟著換，重新載入回到上次的分頁', { timeout: 120_000 }, async (t) => {
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

  // 舊格式資料（沒有 plans）→ 遷移成單一「主要計畫」，總預算預設 500 萬
  await fetch(srv.url + '/api/portfolio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rev: 0, transactions: TXS }),
  });

  await page.goto(srv.url);
  await page.waitForFunction(() => document.querySelectorAll('.plan-tab').length > 0, { timeout: 15000 });

  assert.deepEqual(await page.locator('.plan-tab').allTextContents(), ['主要計畫']);
  assert.ok((await page.textContent('#subtitle')).includes('NT$5,000,000'));
  const investedMain = await page.textContent('#kpi-invested');
  assert.notEqual(investedMain, 'NT$0', '主要計畫應有已投入成本');

  // 新增「信貸」計畫（總預算 150 萬）
  await page.click('#plan-manage-btn');
  await page.fill('#plan-name', '信貸');
  await page.fill('#plan-budget', '1500000');
  await page.click('#plan-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll('.plan-tab').length === 2, { timeout: 10000 });

  // 自動切到新分頁：總預算換成 150 萬、已投入成本歸零（新計畫還沒有交易）
  assert.equal(await page.textContent('.plan-tab.active'), '信貸');
  assert.ok((await page.textContent('#subtitle')).includes('NT$1,500,000'));
  assert.equal(await page.textContent('#kpi-invested'), 'NT$0');
  assert.equal(await page.locator('#tx-body tr').count(), 0, '信貸分頁不應看到主要計畫的交易');

  // 切回主要計畫：數字回來
  await page.click('.plan-tab:has-text("主要計畫")');
  await page.waitForTimeout(400);
  assert.ok((await page.textContent('#subtitle')).includes('NT$5,000,000'));
  assert.equal(await page.textContent('#kpi-invested'), investedMain);

  // 重新載入回到上次看的分頁
  await page.click('.plan-tab:has-text("信貸")');
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.plan-tab').length === 2, { timeout: 15000 });
  assert.equal(await page.textContent('.plan-tab.active'), '信貸');

  // 在信貸分頁新增的交易只屬於信貸
  await page.selectOption('#tx-stock', '2330');
  await page.fill('#tx-shares', '50');
  await page.fill('#tx-price', '1000');
  await page.click('#tx-submit');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#tx-body tr').count(), 1);

  // --- 一筆交易掛多個計畫：兩個分頁都看得到 ---
  const mainTxCount = await (async () => {
    await page.click('.plan-tab:has-text("主要計畫")');
    await page.waitForTimeout(300);
    const n = await page.locator('#tx-body tr').count();
    await page.click('.plan-tab:has-text("信貸")');
    await page.waitForTimeout(300);
    return n;
  })();

  await page.selectOption('#tx-stock', 'TSM');
  await page.fill('#tx-shares', '10');
  await page.fill('#tx-price', '230');
  await page.locator('#tx-plans input').first().check(); // 也勾主要計畫
  assert.ok(await page.locator('#tx-plans-hint').isVisible(), '勾選兩個計畫時應出現重複計入的提示');
  // 回歸：畫面重繪（切圖表範圍、更新報價…）不得把已勾好的計畫沖掉
  await page.click('#hist-range-control button[data-range="1mo"]');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#tx-plans input:checked').count(), 2, '重繪後勾選應保留');
  await page.click('#hist-range-control button[data-range="all"]');
  await page.waitForTimeout(300);
  await page.click('#tx-submit');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#tx-body tr').count(), 2, '信貸應看到這筆');

  await page.click('.plan-tab:has-text("主要計畫")');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#tx-body tr').count(), mainTxCount + 1, '主要計畫也應看到同一筆');
  await page.click('.plan-tab:has-text("信貸")');
  await page.waitForTimeout(300);

  // --- 目標配置比例跟著計畫走 ---
  await page.click('#edit-stocks-btn');
  assert.ok((await page.textContent('#editor-percent-head')).includes('信貸'), '比例欄標題應標明目前計畫');
  // 信貸只排台積電 40%，其餘留 0
  const percentInputs = page.locator('#editor-body .e-percent');
  const rowCount = await percentInputs.count();
  for (let i = 0; i < rowCount; i++) await percentInputs.nth(i).fill(i === 0 ? '40' : '0');
  await page.click('#editor-save');
  await page.waitForTimeout(500);
  const creditFoot = await page.textContent('#holdings-foot');
  assert.ok(creditFoot.includes('40%'), '信貸的目標比例合計應是 40%，實際：' + creditFoot);

  // 切回主要計畫：比例是它自己那一套（預設合計 100%）
  await page.click('.plan-tab:has-text("主要計畫")');
  await page.waitForTimeout(400);
  assert.ok((await page.textContent('#holdings-foot')).includes('100%'), '主要計畫的比例不應被信貸的修改影響');

  const saved = await (await fetch(srv.url + '/api/portfolio')).json();
  assert.equal(saved.plans.length, 2);
  assert.deepEqual(saved.plans[1].allocations, { '2330': 40 });
  assert.equal(Object.keys(saved.plans[0].allocations).length, 12, '主要計畫仍有自己的 12 檔目標配置');
  assert.equal(saved.plans[1].name, '信貸');
  assert.equal(saved.plans[1].budget, 1_500_000);
  const creditPlanId = saved.plans[1].id;
  const added = saved.transactions.find((x) => x.shares === 50);
  assert.deepEqual(added.plans, [creditPlanId]);
  const shared = saved.transactions.find((x) => x.shares === 10 && x.stockId === 'TSM');
  assert.deepEqual([...shared.plans].sort(), ['plan-1', creditPlanId].sort());

  // --- 管理計畫：改名、改總預算、調順序、刪除 ---
  await page.click('#plan-manage-btn');
  const creditRow = page.locator(`.plan-row[data-plan-id="${creditPlanId}"]`);
  await creditRow.locator('.plan-row-name').fill('信貸操作');
  await creditRow.locator('.plan-row-name').blur();
  await creditRow.locator('.plan-row-budget').fill('2000000');
  await creditRow.locator('.plan-row-budget').blur();
  await page.waitForTimeout(400);
  assert.deepEqual(await page.locator('.plan-tab').allTextContents(), ['主要計畫', '信貸操作']);

  // 上移 → 分頁順序對調
  await page.locator(`.plan-row[data-plan-id="${creditPlanId}"] .plan-move[data-dir="-1"]`).click();
  await page.waitForTimeout(400);
  assert.deepEqual(await page.locator('.plan-tab').allTextContents(), ['信貸操作', '主要計畫']);

  // 改後的總預算生效
  await page.click('.plan-tab:has-text("信貸操作")');
  await page.waitForTimeout(400);
  assert.ok((await page.textContent('#subtitle')).includes('NT$2,000,000'));

  // 刪除：先看到會連帶刪幾筆，名稱打對才能按
  await page.click('#plan-manage-btn');
  await page.locator(`.plan-row[data-plan-id="${creditPlanId}"] .plan-delete`).click();
  const confirmText = await page.textContent('.plan-confirm');
  assert.ok(confirmText.includes('1'), '應顯示只屬於這個計畫的交易筆數：' + confirmText);
  assert.ok(await page.locator('#plan-confirm-btn').isDisabled(), '名稱還沒打對前不能刪');
  await page.fill('#plan-confirm-input', '信貸');
  assert.ok(await page.locator('#plan-confirm-btn').isDisabled(), '名稱不完全相符仍不能刪');
  await page.fill('#plan-confirm-input', '信貸操作');
  assert.ok(await page.locator('#plan-confirm-btn').isEnabled());
  await page.click('#plan-confirm-btn');
  await page.waitForTimeout(600);

  assert.deepEqual(await page.locator('.plan-tab').allTextContents(), ['主要計畫']);
  const after = await (await fetch(srv.url + '/api/portfolio')).json();
  assert.equal(after.plans.length, 1);
  assert.equal(after.transactions.some((x) => x.shares === 50), false, '只屬於它的交易應一併刪除');
  const stillShared = after.transactions.find((x) => x.shares === 10 && x.stockId === 'TSM');
  assert.deepEqual(stillShared.plans, ['plan-1'], '共用的交易保留，只掉標籤');

  // --- 純記錄型計畫：總預算留空 ---
  await page.click('#plan-manage-btn');
  await page.fill('#plan-name', '總投資');
  await page.fill('#plan-budget', ''); // 留空＝不設目標
  await page.click('#plan-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll('.plan-tab').length === 2, { timeout: 10000 });

  assert.equal(await page.textContent('.plan-tab.active'), '總投資');
  assert.ok((await page.textContent('#subtitle')).includes('純記錄型'));
  assert.ok(await page.locator('#kpi-progress-card').isHidden(), '達成率 KPI 應收起來');
  assert.ok(await page.locator('#overall-progress-card').isHidden(), '資金投入進度條應收起來');
  assert.ok(await page.locator('#rebalance-card').isHidden(), '再平衡建議應收起來');
  assert.ok(await page.locator('#basis-target-btn').isHidden(), '圓餅圖不應提供目標配置基準');

  // 交易照常記，已投入與損益照算
  await page.selectOption('#tx-stock', '2330');
  await page.fill('#tx-shares', '100');
  await page.fill('#tx-price', '1000');
  await page.click('#tx-submit');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#tx-body tr').count(), 1);
  assert.notEqual(await page.textContent('#kpi-invested'), 'NT$0');

  // 純記錄型計畫也要能新增標的：編輯標的存得起來，交易表單的下拉才長得出新選項
  const optionsBefore = await page.locator('#tx-stock option').count();
  await page.click('#edit-stocks-btn');
  assert.ok(await page.locator('#edit-budget-field').isHidden(), '純記錄型不顯示總預算欄');
  assert.ok(await page.locator('#editor-percent-head').isHidden(), '純記錄型不顯示目標比例欄');
  await page.click('#editor-add');
  const newRow = page.locator('#editor-body tr').last();
  await newRow.locator('.e-symbol').fill('2454.TW');
  await newRow.locator('.e-name').fill('聯發科');
  await page.click('#editor-save');
  await page.waitForTimeout(600);
  assert.ok(await page.locator('#editor-card').isHidden(), '儲存後對話框應關閉（沒有被總預算檢查擋下）');
  assert.equal(await page.locator('#tx-stock option').count(), optionsBefore + 1, '新標的應出現在交易表單');
  assert.ok((await page.textContent('#tx-stock')).includes('聯發科'));

  // 選得到新標的並記得起來
  await page.selectOption('#tx-stock', '2454.TW');
  await page.fill('#tx-shares', '20');
  await page.fill('#tx-price', '1200');
  await page.click('#tx-submit');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#tx-body tr').count(), 2);

  // 在管理計畫填回總預算 → 目標相關區塊回來
  await page.click('#plan-manage-btn');
  const recordRow = page.locator('.plan-row').last();
  await recordRow.locator('.plan-row-budget').fill('3000000');
  await recordRow.locator('.plan-row-budget').blur();
  await page.waitForTimeout(400);
  assert.ok(await page.locator('#kpi-progress-card').isVisible(), '填回總預算後達成率應回來');
  assert.ok(await page.locator('#rebalance-card').isVisible());
  assert.ok((await page.textContent('#subtitle')).includes('NT$3,000,000'));

  // 清回空白 → 又變成純記錄型，並確認存進伺服器
  await recordRow.locator('.plan-row-budget').fill('');
  await recordRow.locator('.plan-row-budget').blur();
  await page.waitForTimeout(500);
  assert.ok(await page.locator('#kpi-progress-card').isHidden());
  const recordDoc = await (await fetch(srv.url + '/api/portfolio')).json();
  assert.equal(recordDoc.plans.find((p) => p.name === '總投資').budget, null);

  // 收拾：刪掉純記錄型計畫，後面的複製情境從單一計畫開始
  await page.locator(`.plan-row[data-plan-id="${recordDoc.plans[1].id}"] .plan-delete`).click();
  await page.fill('#plan-confirm-input', '總投資');
  await page.click('#plan-confirm-btn');
  await page.waitForTimeout(600);
  assert.deepEqual(await page.locator('.plan-tab').allTextContents(), ['主要計畫']);

  // --- 從既有計畫複製 ---
  const mainRows = await page.locator('#tx-body tr').count();
  const mainInvested = await page.textContent('#kpi-invested');
  const mainTxTotal = after.transactions.length;

  await page.click('#plan-manage-btn');
  await page.fill('#plan-name', '退休');
  await page.selectOption('#plan-copy-from', 'plan-1');
  await page.check('#plan-copy-txs');
  assert.ok(await page.locator('#plan-copy-hint').isVisible(), '複製交易時應提示投入金額會重複出現');
  await page.click('#plan-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll('.plan-tab').length === 2, { timeout: 10000 });

  // 新計畫沿用來源的總預算與配置，且有一份一模一樣的交易副本
  assert.equal(await page.textContent('.plan-tab.active'), '退休');
  assert.ok((await page.textContent('#subtitle')).includes('NT$5,000,000'));
  assert.equal(await page.locator('#tx-body tr').count(), mainRows);
  assert.equal(await page.textContent('#kpi-invested'), mainInvested);

  const copied = await (await fetch(srv.url + '/api/portfolio')).json();
  assert.equal(copied.transactions.length, mainTxTotal * 2, '交易應被複製一份');
  assert.deepEqual(copied.plans[1].allocations, copied.plans[0].allocations);
  const sourceIds = new Set(after.transactions.map((t) => t.id));
  const copies = copied.transactions.filter((t) => !sourceIds.has(t.id));
  assert.equal(copies.length, mainTxTotal);
  const newPlanId = copied.plans[1].id;
  for (const c of copies) assert.deepEqual(c.plans, [newPlanId], '副本只掛新計畫');
  // 來源計畫的交易完全沒被動到
  for (const src of after.transactions) {
    assert.deepEqual(copied.transactions.find((t) => t.id === src.id).plans, src.plans);
  }

  assert.deepEqual(jsErrors, [], 'JS errors: ' + jsErrors.join('; '));
});

test('端對端：交易紀錄的時間區間篩選只影響列表，計算不受影響', { timeout: 120_000 }, async (t) => {
  const srv = await startServer();
  const browser = await chromium.launch({ executablePath: chromiumPath, timeout: 30_000 });
  t.after(async () => {
    await browser.close();
    srv.stop();
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));
  await page.route('**/api/quotes*', (r) => r.fulfill({ json: mockQuotes() }));
  await page.route('**/api/events*', (r) => r.fulfill({ json: { events: {}, errors: {}, fetchedAt: Date.now() } }));
  await page.route('**/api/history*', (r) => {
    const u = new URL(r.request().url());
    r.fulfill({ json: mockHistory(u.searchParams.get('symbols').split(',')) });
  });

  // 交易分散在四個不同月份（相對今天：本月、上個月、約 3 個月前、超過半年前）
  const iso = (d) => d.toISOString().slice(0, 10);
  const today = new Date();
  const thisMonth = iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
  const monthsAgo = (n) => iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - n, 15)));
  const dates = [monthsAgo(8), monthsAgo(5), monthsAgo(1), thisMonth];
  await fetch(srv.url + '/api/portfolio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rev: 0,
      transactions: dates.map((date, i) => ({ id: 'x' + i, stockId: '2330', date, shares: 100, price: 1000 })),
    }),
  });

  await page.goto(srv.url);
  await page.waitForSelector('#tx-body tr');

  const rows = () => page.locator('#tx-body tr').count();
  assert.equal(await rows(), 4, '預設顯示全部');
  const investedAll = await page.textContent('#kpi-invested');

  // 本月：只剩月初那筆
  await page.click('#tx-range-control button[data-range="month"]');
  await page.waitForTimeout(150);
  assert.equal(await rows(), 1);
  assert.ok((await page.textContent('#tx-count')).includes('1 / 4'));
  assert.equal(await page.textContent('#kpi-invested'), investedAll, '篩選不得影響已投入成本');

  // 自訂區間：只框住最舊的那一筆（端點皆含）
  await page.fill('#tx-from', dates[0]);
  await page.fill('#tx-to', dates[0]);
  await page.dispatchEvent('#tx-to', 'change');
  await page.waitForTimeout(200);
  assert.equal(await rows(), 1);
  assert.equal(await page.locator('#tx-range-control button.active').count(), 0, '自訂區間時預設鈕不應是選取狀態');

  // 篩到空區間時要說清楚是區間的關係，而不是「尚無交易紀錄」
  await page.fill('#tx-from', '1990-01-01');
  await page.fill('#tx-to', '1990-01-31');
  await page.dispatchEvent('#tx-to', 'change');
  await page.waitForTimeout(200);
  assert.equal(await rows(), 0);
  assert.ok((await page.textContent('#tx-empty')).includes('這個時間區間'));

  // 區間記在 localStorage，重新載入後還在
  await page.reload();
  await page.waitForTimeout(800);
  assert.equal(await page.inputValue('#tx-from'), '1990-01-01', '重新載入應記得區間');
  assert.equal(await rows(), 0);

  // 清除後回到全部
  await page.click('#tx-range-clear');
  await page.waitForTimeout(200);
  assert.equal(await rows(), 4);
  assert.equal(await page.textContent('#kpi-invested'), investedAll);

  assert.deepEqual(jsErrors, [], 'JS errors: ' + jsErrors.join('; '));
});

test('端對端：月報的時間區間篩選，與交易紀錄的篩選互不干擾', { timeout: 120_000 }, async (t) => {
  const srv = await startServer();
  const browser = await chromium.launch({ executablePath: chromiumPath, timeout: 30_000 });
  t.after(async () => {
    await browser.close();
    srv.stop();
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));
  await page.route('**/api/quotes*', (r) => r.fulfill({ json: mockQuotes() }));
  await page.route('**/api/events*', (r) => r.fulfill({ json: { events: {}, errors: {}, fetchedAt: Date.now() } }));
  await page.route('**/api/history*', (r) => {
    const u = new URL(r.request().url());
    r.fulfill({ json: mockHistory(u.searchParams.get('symbols').split(',')) });
  });

  await fetch(srv.url + '/api/portfolio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rev: 0, transactions: TXS }),
  });

  await page.goto(srv.url);
  await page.waitForFunction(() => document.querySelectorAll('#monthly-body tr.monthly-row').length > 0, { timeout: 20000 });

  const rows = () => page.locator('#monthly-body tr.monthly-row').count();
  const investedAll = await page.textContent('#kpi-invested');
  const total = await rows();
  assert.ok(total >= 2, `月報應有多個月可篩（實際 ${total}）`);
  assert.ok((await page.textContent('#monthly-count')).includes(`共 ${total} 個月`));

  // 本月：只剩一列，且計算不受影響
  await page.click('#monthly-range-control button[data-range="month"]');
  await page.waitForTimeout(200);
  assert.equal(await rows(), 1);
  assert.ok((await page.textContent('#monthly-count')).includes(`1 / ${total} 個月`));
  assert.equal(await page.textContent('#kpi-invested'), investedAll, '篩選不得影響已投入成本');

  // 自訂區間以「月」為粒度：用月中的日期仍應顯示整個月
  const months = (
    await page.evaluate(() => [...document.querySelectorAll('#monthly-body tr.monthly-row td:first-child')].map((td) => td.textContent))
  );
  const thisMonth = months[0];
  await page.fill('#monthly-from', `${thisMonth}-10`);
  await page.fill('#monthly-to', `${thisMonth}-20`);
  await page.dispatchEvent('#monthly-to', 'change');
  await page.waitForTimeout(200);
  assert.equal(await rows(), 1, '月中的區間仍應顯示整個月');
  assert.ok((await page.textContent('#monthly-count')).includes(`${thisMonth} ~ ${thisMonth}`), '標籤應以月份呈現');
  assert.equal(await page.locator('#monthly-range-control button.active').count(), 0);

  // 空區間有專屬提示
  await page.fill('#monthly-from', '1990-01-01');
  await page.fill('#monthly-to', '1990-12-31');
  await page.dispatchEvent('#monthly-to', 'change');
  await page.waitForTimeout(200);
  assert.equal(await rows(), 0);
  assert.ok(!(await page.locator('#monthly-empty').isHidden()));

  // 重新載入後記得區間
  await page.reload();
  await page.waitForTimeout(1000);
  assert.equal(await page.inputValue('#monthly-from'), '1990-01-01');

  // 兩個篩選器各自獨立：改交易紀錄的區間不影響月報
  await page.click('#monthly-range-control button[data-range="all"]');
  await page.waitForTimeout(200);
  await page.click('#tx-range-control button[data-range="month"]');
  await page.waitForTimeout(200);
  assert.equal(await rows(), total, '交易紀錄的篩選不應改動月報');
  assert.ok((await page.textContent('#monthly-count')).includes(`共 ${total} 個月`));

  await page.click('#monthly-range-clear').catch(() => {});
  assert.deepEqual(jsErrors, [], 'JS errors: ' + jsErrors.join('; '));
});

// 沒填台幣金額的外幣交易，成本會跟著即時匯率浮動 —— 「今天沒交易，成本卻下降」的成因。
// 「釘住歷史匯率」要能把它改成交易當天的匯率並存回去。
test('端對端：釘住歷史匯率讓外幣成本不再隨匯率浮動', { timeout: 120_000 }, async (t) => {
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

  // 買入日的匯率 28，今天的匯率 29 —— 沒釘住的話成本會是今天的 29
  const buyDate = DATES[DATES.length - 40];
  const buyIndex = DATES.indexOf(buyDate);
  await page.route('**/api/quotes*', (r) => r.fulfill({ json: mockQuotes() }));
  await page.route('**/api/history*', (r) => {
    const u = new URL(r.request().url());
    const data = mockHistory(u.searchParams.get('symbols').split(','));
    if (data.series['TWD=X']) data.series['TWD=X'] = DATES.map((d, i) => [Date.parse(d), i < buyIndex + 1 ? 28 : 29]);
    r.fulfill({ json: data });
  });

  const put = await fetch(srv.url + '/api/portfolio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rev: 0,
      transactions: [{ id: 'usd1', stockId: 'TSM', date: buyDate, shares: 100, price: 230, twdCost: null }],
    }),
  });
  assert.equal(put.status, 200);

  await page.goto(srv.url);
  await page.waitForFunction(() => document.querySelectorAll('.pnl-bar').length > 0, { timeout: 15000 });

  // 釘住前：台幣成本欄顯示「（依匯率）」，按鈕露出且標明筆數
  assert.equal(await page.locator('.tx-unpinned').count(), 1);
  const btn = page.locator('#pin-fx-btn');
  assert.ok(await btn.isVisible(), '有浮動成本的交易時應顯示按鈕');
  assert.ok((await btn.textContent()).includes('1'));
  // 目前成本＝100 × 230 × 29（今天的匯率）
  assert.equal(await page.evaluate(() => computeStock(state.stocks.find((s) => s.id === 'TSM')).invested), 667000);

  await btn.click();
  await page.waitForFunction(() => document.querySelector('#pin-fx-btn').hidden, { timeout: 15000 });

  // 釘住後：成本改用買入當天的 28，且已寫進交易紀錄
  assert.equal(await page.evaluate(() => computeStock(state.stocks.find((s) => s.id === 'TSM')).invested), 644000);
  assert.equal(await page.evaluate(() => state.transactions[0].twdCost), 644000);
  assert.equal(await page.locator('.tx-unpinned').count(), 0);

  // 存回伺服器，重整後不會退回浮動狀態
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.pnl-bar').length > 0, { timeout: 15000 });
  assert.equal(await page.evaluate(() => state.transactions[0].twdCost), 644000);
  assert.ok(await page.locator('#pin-fx-btn').isHidden());

  // 新增的外幣交易留空台幣金額時，存檔當下就用即時匯率釘死，不會再留下浮動的紀錄
  await page.selectOption('#tx-stock', 'TSM');
  await page.fill('#tx-shares', '10');
  await page.fill('#tx-price', '200');
  await page.fill('#tx-twd', '');
  await page.click('#tx-submit');
  await page.waitForFunction(() => state.transactions.length === 2, { timeout: 15000 });
  assert.equal(await page.evaluate(() => state.transactions[1].twdCost), 58_000); // 10 × 200 × 29
  assert.ok(await page.locator('#pin-fx-btn').isHidden(), '新交易已釘死，不應再出現按鈕');

  assert.deepEqual(jsErrors, [], 'JS errors: ' + jsErrors.join('; '));
});

// 把既有交易掛進另一個計畫，本來要一筆一筆進編輯畫面重勾。這裡驗證列表可以多選後一次加入。
test('端對端：多選過去的交易，一次加入另一個計畫', { timeout: 120_000 }, async (t) => {
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

  // 三筆交易全掛在「信貸」，「總投資」是空的
  const put = await fetch(srv.url + '/api/portfolio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rev: 0,
      plans: [
        { id: 'credit', name: '信貸', budget: 3_000_000, allocations: {} },
        { id: 'total', name: '總投資', budget: 5_000_000, allocations: {} },
      ],
      transactions: TXS.slice(0, 3).map((x) => ({ ...x, plans: ['credit'] })),
    }),
  });
  assert.equal(put.status, 200);

  await page.goto(srv.url);
  await page.waitForFunction(() => document.querySelectorAll('#tx-body tr').length === 3, { timeout: 15000 });

  // 沒選任何東西時，批次列不出現
  assert.ok(await page.locator('#tx-bulk-row').isHidden());

  // 勾兩筆 → 批次列出現並顯示筆數
  const boxes = page.locator('#tx-body .tx-pick');
  assert.equal(await boxes.count(), 3);
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  assert.equal(await page.textContent('#tx-bulk-count'), '已選 2 筆');
  // 下拉只列出「別的計畫」，不會讓人加到自己身上
  assert.deepEqual(await page.locator('#tx-bulk-plan option').allTextContents(), ['總投資']);

  await page.click('#tx-bulk-apply');
  await page.waitForFunction(() => document.querySelector('#tx-bulk-row').hidden, { timeout: 15000 });

  // 勾的是畫面上最新的兩筆（列表由新到舊）：s1、b2；最舊的 b1 沒被動到
  const plansById = await page.evaluate(() => Object.fromEntries(state.transactions.map((t) => [t.id, t.plans])));
  assert.deepEqual(plansById.s1, ['credit', 'total']);
  assert.deepEqual(plansById.b2, ['credit', 'total']);
  assert.deepEqual(plansById.b1, ['credit'], '沒勾到的交易不該被動到');

  // 切到「總投資」分頁看得到那兩筆；選取狀態不會跟著跑過來
  await page.click('.plan-tab:has-text("總投資")');
  await page.waitForFunction(() => document.querySelectorAll('#tx-body tr').length === 2, { timeout: 15000 });
  assert.ok(await page.locator('#tx-bulk-row').isHidden());
  assert.deepEqual(await page.locator('#tx-bulk-plan option').count(), 1);

  // 全選框作用在目前看得到的交易上
  await page.check('#tx-pick-all');
  assert.equal(await page.textContent('#tx-bulk-count'), '已選 2 筆');
  await page.click('#tx-bulk-clear');
  assert.ok(await page.locator('#tx-bulk-row').isHidden());

  // 重整後標籤有存回伺服器
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#tx-body tr').length > 0, { timeout: 15000 });
  assert.equal(await page.evaluate(() => PortfolioMath.transactionsInPlan(state.transactions, 'total').length), 2);

  // --- 批次移出：同時掛兩個計畫的，只拿掉這個計畫的標籤，資料留著 ---
  await page.click('.plan-tab:has-text("總投資")');
  await page.waitForFunction(() => document.querySelectorAll('#tx-body tr').length === 2, { timeout: 15000 });
  await page.check('#tx-pick-all');
  await page.click('#tx-bulk-remove');
  await page.waitForFunction(() => document.querySelectorAll('#tx-body tr').length === 0, { timeout: 15000 });
  assert.equal(await page.evaluate(() => state.transactions.length), 3, '三筆交易都還在');
  assert.deepEqual(await page.evaluate(() => state.transactions.map((t) => t.plans)), [['credit'], ['credit'], ['credit']]);

  // --- 批次移出：只屬於這個計畫的，整筆刪除 ---
  await page.click('.plan-tab:has-text("信貸")');
  await page.waitForFunction(() => document.querySelectorAll('#tx-body tr').length === 3, { timeout: 15000 });
  await page.locator('#tx-body .tx-pick').first().check();
  await page.click('#tx-bulk-remove');
  await page.waitForFunction(() => document.querySelectorAll('#tx-body tr').length === 2, { timeout: 15000 });
  assert.equal(await page.evaluate(() => state.transactions.length), 2, '這筆只屬於信貸，整筆刪掉');

  // 重整後刪除結果有存回伺服器
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#tx-body tr').length > 0, { timeout: 15000 });
  assert.equal(await page.evaluate(() => state.transactions.length), 2);

  assert.deepEqual(jsErrors, [], 'JS errors: ' + jsErrors.join('; '));
});
