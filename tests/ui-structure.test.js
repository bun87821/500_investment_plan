'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

test('主要卡片區塊標記為可收合', () => {
  for (const id of [
    'plan-card',
    'overall-progress-card',
    'snapshot-card',
    'allocation-card',
    'editor-card',
    'rebalance-card',
    'monthly-card',
  ]) {
    assert.match(html, new RegExp(`<section[^>]+id="${id}"[^>]+data-collapsible`), id);
  }

  for (const className of ['holdings-card', 'tx-entry-card', 'tx-history-card']) {
    assert.match(html, new RegExp(`<(?:section|div)[^>]+class="[^"]*${className}[^"]*"[^>]+data-collapsible`), className);
  }

  assert.doesNotMatch(html, /id="allocation-toggle"/, '圓餅圖不應再使用專用收合按鈕');
});

test('配息提醒提供一鍵忽略，且不會忽略分割提醒', () => {
  assert.match(appJs, /function ignoreAllDividendAlerts\(/);
  assert.match(appJs, /alert-ignore-divs/);
  assert.match(appJs, /忽略全部配息/);
  assert.match(appJs, /filter\(\(a\) => a\.type === 'div'\)/);
  assert.doesNotMatch(appJs, /filter\(\(a\) => a\.type !== 'split'\)/);
});

test('登入與儲存狀態要清楚，編輯標的不得靜默丟失', () => {
  assert.match(html, /id="sync-status"/, 'header 需要有同步狀態提示');
  assert.match(appJs, /function setSyncStatus\(/);
  assert.match(appJs, /Google 雲端/);
  assert.match(appJs, /訪客本機/);
  assert.match(appJs, /async function saveEditor\(/);
  assert.match(appJs, /const saved = await savePortfolio\(\)/);
  assert.match(appJs, /if \(!saved\) \{/);
  assert.match(appJs, /state\.transactions = prevTransactions/);
  assert.match(appJs, /state\.stocks = prevStocks/);
  assert.match(appJs, /resetTxForm\(\)/);
});
