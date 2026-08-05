'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

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
