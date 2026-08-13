'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

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

test('頁首提供重整整個頁面的按鈕', () => {
  assert.match(html, /id="page-reload-btn"/);
  assert.match(html, />重整頁面<\/button>/);
  assert.match(appJs, /\$\('page-reload-btn'\)\.addEventListener\('click', \(\) => \{/);
  assert.match(appJs, /location\.reload\(\)/);
});

test('Google 登入帳號需另外記錄，不能只靠 portfolios 判斷使用者數', () => {
  assert.match(serverJs, /CREATE TABLE IF NOT EXISTS portfolio_users/);
  assert.match(serverJs, /user_id TEXT PRIMARY KEY/);
  assert.match(serverJs, /email TEXT NOT NULL DEFAULT ''/);
  assert.match(serverJs, /name TEXT NOT NULL DEFAULT ''/);
  assert.match(serverJs, /last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
  assert.match(serverJs, /let rememberUserProfile = async \(\) => \{\}/);
  assert.match(serverJs, /rememberUserProfile = async \(user\) => \{/);
  assert.match(serverJs, /INSERT INTO portfolio_users \(user_id, email, name\)/);
  assert.match(serverJs, /ON CONFLICT \(user_id\) DO UPDATE/);
  assert.match(serverJs, /last_seen_at = now\(\)/);
  assert.match(serverJs, /await rememberUserProfile\(user\)/);
});

test('刪除計畫必須等雲端儲存成功，失敗時回復畫面狀態', () => {
  assert.match(appJs, /const beforeDelete = \{/);
  assert.match(appJs, /const saved = await savePortfolio\(\)/);
  assert.match(appJs, /if \(!saved\) \{/);
  assert.match(appJs, /state\.plans = beforeDelete\.plans/);
  assert.match(appJs, /state\.transactions = beforeDelete\.transactions/);
  assert.match(appJs, /state\.snapshots = beforeDelete\.snapshots/);
  assert.match(appJs, /deletingPlanId = planId/);
  assert.match(appJs, /return/);
});

test('登入狀態要固定在主網域，且使用中要延長 session', () => {
  assert.match(serverJs, /const CANONICAL_HOST = process\.env\.CANONICAL_HOST \|\| ''/);
  assert.match(serverJs, /function setSessionCookie\(res, user\)/);
  assert.match(serverJs, /res\.cookie\('session', signSession\(user\)/);
  assert.match(serverJs, /if \(CANONICAL_HOST && req\.hostname !== CANONICAL_HOST\)/);
  assert.match(serverJs, /res\.redirect\(308, target\.toString\(\)\)/);
  assert.match(serverJs, /setSessionCookie\(res, user\)/);
  assert.match(serverJs, /app\.get\('\/api\/me', async \(req, res\) => \{/);
});

test('資產類別配置圖例不顯示目前基準為 0 的標的與類別', () => {
  assert.match(appJs, /const members = ordered\s*\.filter\(\(r\) => \(r\.stock\.category \|\| '未分類'\) === cat\)\s*\.filter\(\(r\) => basis\.valueOf\(r\) > 0\)/);
  assert.match(appJs, /if \(catValue <= 0\) continue/);
  assert.doesNotMatch(appJs, /legend-member\$\{v <= 0 \? ' zero' : ''\}/);
});
