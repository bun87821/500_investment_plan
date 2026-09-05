// 共用投資計算模組：前端（window.PortfolioMath）與後端（require）載入同一份實作。
// 純函式：不讀全域狀態、不碰 DOM、不看系統時鐘；所有輸入由呼叫端傳入。
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.PortfolioMath = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 該幣別換算台幣的 Yahoo 匯率代號（USD 用 TWD=X，其餘用 <幣別>TWD=X）
  function fxSymbolOf(currency) {
    if (currency === 'TWD') return null;
    return currency === 'USD' ? 'TWD=X' : currency + 'TWD=X';
  }

  function fxRateOf(currency, quotes) {
    const sym = fxSymbolOf(currency);
    if (!sym) return 1;
    const q = quotes[sym];
    return q ? q.price : null;
  }

  // 依日期順序以「平均成本法」重放交易：
  // - invested＝目前持有部位的成本（賣出時按平均成本扣減，而非扣掉賣出金額）
  // - realized＝已實現損益（賣出金額 − 平均成本 × 賣出股數）
  // - dividends＝現金股利收入（kind:'dividend' 的紀錄）
  function computeStock(stock, transactions, quotes, budget) {
    const fx = fxRateOf(stock.currency, quotes);
    const quote = quotes[stock.symbol];
    const txs = transactions
      .filter((t) => t.stockId === stock.id)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    let shares = 0;
    let costTWD = 0;
    let costNative = 0;
    let realized = 0;
    let dividends = 0;
    let investedKnown = true;

    for (const t of txs) {
      if (t.kind === 'split') {
        // 分割：股數 × 比例、成本不變（均價隱含 ÷ 比例）、無現金流
        const ratio = Number(t.ratio) || 0;
        if (ratio > 0) shares *= ratio;
        continue;
      }
      if (t.kind === 'dividend') {
        if (t.twdCost != null) dividends += Number(t.twdCost) || 0;
        else if (fx != null) dividends += (Number(t.amount) || 0) * fx;
        else investedKnown = false;
        continue;
      }
      const s = Number(t.shares) || 0;
      const price = Number(t.price) || 0;
      let flowTWD = null; // 買＝台幣成本；賣＝台幣入帳
      if (t.twdCost != null) flowTWD = Math.abs(Number(t.twdCost));
      else if (fx != null) flowTWD = Math.abs(s) * price * fx;
      else investedKnown = false;

      if (s > 0) {
        if (flowTWD != null) costTWD += flowTWD;
        costNative += s * price;
        shares += s;
      } else if (s < 0) {
        const sell = -s;
        const removed = Math.min(sell, Math.max(shares, 0));
        const avgTWD = shares > 0 ? costTWD / shares : 0;
        const avgNat = shares > 0 ? costNative / shares : 0;
        if (flowTWD != null) realized += flowTWD - avgTWD * removed;
        costTWD -= avgTWD * removed;
        costNative -= avgNat * removed;
        shares -= sell;
      }
    }

    const targetTWD = ((budget || 0) * stock.percent) / 100;
    const avgCost = shares > 0 ? costNative / shares : null;
    const price = quote ? quote.price : null;
    const valueTWD = price != null && fx != null ? shares * price * fx : shares === 0 ? 0 : null;
    const invested = investedKnown ? costTWD : null;
    const pnl = valueTWD != null && invested != null ? valueTWD - invested : null;
    const progress = invested != null && targetTWD > 0 ? invested / targetTWD : null;
    const dayChange =
      quote && quote.previousClose ? (quote.price - quote.previousClose) / quote.previousClose : null;

    return {
      stock,
      shares,
      avgCost,
      invested,
      targetTWD,
      price,
      fx,
      valueTWD,
      pnl,
      progress,
      dayChange,
      realized: investedKnown ? realized : null,
      dividends: investedKnown ? dividends : null,
    };
  }

  const DEFAULT_BUDGET = 5_000_000;

  // 快照只保留圖表真正會讀的欄位。早期版本還存了 holdings 明細（每檔標的一列）與
  // quoteErrors，兩者從未被讀取卻佔掉單筆快照約 96% 的體積 —— 帳號資料是一份整存整取的
  // JSON，放著會一路長到超過請求上限，所以在寫入時一律剝除。
  const SNAPSHOT_FIELDS = ['date', 'planId', 'at', 'source', 'totalInvested', 'totalValue', 'pnl', 'pnlPct'];

  function slimSnapshot(snapshot) {
    const out = {};
    for (const key of SNAPSHOT_FIELDS) if (snapshot[key] !== undefined) out[key] = snapshot[key];
    return out;
  }

  const slimSnapshots = (snapshots) => (Array.isArray(snapshots) ? snapshots : []).map(slimSnapshot);

  // 舊格式（單一計畫、目標比例掛在標的上）→ 新格式（plans 陣列、交易與快照標明歸屬）。
  // 純函式且幂等：不就地修改輸入，已遷移的資料再跑一次結果相同。
  function migratePortfolio(doc) {
    const stocks = Array.isArray(doc.stocks) ? doc.stocks : [];
    let plans = Array.isArray(doc.plans) ? doc.plans : [];
    if (!plans.length) {
      const allocations = {};
      for (const s of stocks) if (Number(s.percent) > 0) allocations[s.id] = Number(s.percent);
      plans = [
        {
          id: 'plan-1',
          name: '主要計畫',
          budget: Number(doc.budget) > 0 ? Number(doc.budget) : DEFAULT_BUDGET,
          allocations,
        },
      ];
    }
    const primary = plans[0].id;
    const transactions = (Array.isArray(doc.transactions) ? doc.transactions : []).map((t) =>
      Array.isArray(t.plans) && t.plans.length ? t : { ...t, plans: [primary] }
    );
    const snapshots = slimSnapshots(doc.snapshots).map((s) => (s.planId ? s : { ...s, planId: primary }));
    return { ...doc, plans, transactions, snapshots };
  }

  // 多計畫的唯一篩選點：所有計算函式都吃「已篩選的交易」，本身不認得計畫。
  // 沒有標籤的交易在每個計畫都看得到——遷移會補上標籤，萬一有漏網之魚，
  // 寧可到處都看得到讓使用者發現，也不要整筆從畫面上消失。
  function transactionsInPlan(transactions, planId) {
    return (Array.isArray(transactions) ? transactions : []).filter(
      (t) => !Array.isArray(t.plans) || !t.plans.length || t.plans.includes(planId)
    );
  }

  // 只屬於這個計畫的交易——刪除計畫時會跟著消失的那些
  const onlyInPlan = (t, planId) => Array.isArray(t.plans) && t.plans.length === 1 && t.plans[0] === planId;

  function transactionsOnlyInPlan(transactions, planId) {
    return (Array.isArray(transactions) ? transactions : []).filter((t) => onlyInPlan(t, planId));
  }

  // 同一天同一個計畫只留一筆快照；前後端共用同一套 upsert 規則
  function upsertSnapshots(snapshots, incoming) {
    const replaced = new Set(incoming.map((s) => s.date + '|' + s.planId));
    const kept = (Array.isArray(snapshots) ? snapshots : []).filter((s) => !replaced.has(s.date + '|' + s.planId));
    return [...kept, ...incoming].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  // 從既有計畫複製交易：產生獨立副本（新的交易 id、只掛新計畫），來源不受影響。
  // makeId 由呼叫端提供，讓這個函式維持純函式。
  function copyTransactionsToPlan(transactions, fromPlanId, toPlanId, makeId) {
    return transactionsInPlan(transactions, fromPlanId).map((t) => ({ ...t, id: makeId(), plans: [toPlanId] }));
  }

  const CURRENCIES = ['TWD', 'USD', 'KRW', 'JPY', 'HKD'];

  // 把代號搜尋的結果變成一檔標的。已經有同一個代號就直接沿用既有那檔——
  // 使用者取的名字與分類不該被 Yahoo 的官方名稱蓋掉。
  // 新標的的目標配置一律 0%：它是「事後記錄的持股」，不是規劃的一部分，
  // 不該去動到原本配置的基準。
  function upsertStockFromSymbol(stocks, result) {
    const list = Array.isArray(stocks) ? stocks : [];
    const symbol = String(result?.symbol || '').trim().toUpperCase();
    if (!symbol) return { stocks: list, stockId: null, created: false };

    const existing = list.find((s) => String(s.symbol || '').toUpperCase() === symbol);
    if (existing) return { stocks: list, stockId: existing.id, created: false };

    const currency = CURRENCIES.includes(result.currency) ? result.currency : 'TWD';
    const stock = {
      id: symbol,
      name: String(result.name || '').trim() || symbol,
      symbol,
      market: String(result.market || '').trim() || '—',
      currency,
      category: '未分類',
      percent: 0,
    };
    return { stocks: [...list, stock], stockId: stock.id, created: true };
  }

  // 批次把既有交易掛進某個計畫（一筆一筆編輯太費工）。
  // 沒有標籤的交易原本在每個計畫都看得到，這裡補成明確的標籤——加入後它就只屬於這個計畫，
  // 這是使用者按下按鈕時看到的、也是他要的結果。
  function addTransactionsToPlan(transactions, ids, planId) {
    const wanted = new Set(ids || []);
    if (!wanted.size || !planId) return transactions;
    return (transactions || []).map((t) => {
      if (!wanted.has(t.id)) return t;
      const plans = Array.isArray(t.plans) ? t.plans : [];
      if (plans.includes(planId)) return t;
      return { ...t, plans: [...plans, planId] };
    });
  }

  // 批次把交易移出某個計畫。規則跟刪除計畫時一樣：只屬於這個計畫的整筆刪掉，
  // 同時掛別的計畫的只拿掉這個標籤——在別的分頁看得到的資料不該被這裡的操作掃掉。
  // allPlanIds 是為了處理沒有標籤的交易（原本每個計畫都看得到）：改掛其餘計畫，
  // 讓它只從眼前這個計畫消失；沒有其餘計畫可掛時才真的刪掉。
  function removeTransactionsFromPlan(transactions, ids, planId, allPlanIds) {
    const wanted = new Set(ids || []);
    if (!wanted.size || !planId) return transactions;
    const out = [];
    for (const t of transactions || []) {
      if (!wanted.has(t.id)) {
        out.push(t);
        continue;
      }
      const plans = Array.isArray(t.plans) && t.plans.length ? t.plans : allPlanIds || [];
      const rest = plans.filter((p) => p !== planId);
      if (rest.length) out.push({ ...t, plans: rest });
    }
    return out;
  }

  // 移出前先讓使用者知道後果：幾筆會整筆消失、幾筆只是拿掉標籤
  function countTransactionsRemoval(transactions, ids, planId, allPlanIds) {
    const wanted = new Set(ids || []);
    let deleted = 0;
    let untagged = 0;
    for (const t of transactions || []) {
      if (!wanted.has(t.id)) continue;
      const plans = Array.isArray(t.plans) && t.plans.length ? t.plans : allPlanIds || [];
      if (plans.filter((p) => p !== planId).length) untagged += 1;
      else deleted += 1;
    }
    return { deleted, untagged };
  }

  // 刪除計畫：孤兒交易與該計畫的快照一併刪除，同時掛在其他計畫的交易只移除這個標籤
  function removePlan(doc, planId) {
    return {
      ...doc,
      plans: (doc.plans || []).filter((p) => p.id !== planId),
      transactions: (doc.transactions || [])
        .filter((t) => !onlyInPlan(t, planId))
        .map((t) => (Array.isArray(t.plans) && t.plans.includes(planId) ? { ...t, plans: t.plans.filter((p) => p !== planId) } : t)),
      snapshots: (doc.snapshots || []).filter((s) => s.planId !== planId),
    };
  }

  function msToDateStr(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  // ---- 交易明細文字解析 ----
  // 券商的歷史成交（CSV 檔或直接從畫面抄下來的文字）貼進來就能匯入。
  // 有標題列就依標題對欄位，順序隨便排；沒有就用預設順序。

  const IMPORT_HEADERS = {
    date: ['date', '日期', '成交時間', '成交日期', '交易日期'],
    stock: ['stock', 'symbol', 'ticker', '標的', '代號', '股票', '股名', '商品'],
    shares: ['shares', 'qty', '股數', '成交股數', '數量'],
    price: ['price', '價格', '每股價格', '成交價', '成交單價', '成交均價', '均價'],
    twd: ['twd', 'twdcost', '台幣', '台幣成本', '台幣總成本', '淨收付'],
    net: ['淨收付'],
    kind: ['kind', 'type', '類型', '買賣', '買賣別', '交易別', '別'],
  };

  const BUY_WORDS = ['買進', '買', 'buy', 'b'];
  const SELL_WORDS = ['賣出', '賣', 'sell', 's'];
  const DIVIDEND_WORDS = ['dividend', 'div', '息', '配息', '股利', '現金股利'];

  const DATE_LIKE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/;
  const TIME_LIKE = /^\d{1,2}:\d{2}(:\d{2})?$/;

  // 「2026/06/27 02:50:51」用空白切會變成兩欄，害後面的欄位整排位移。
  // 緊跟在日期後面的純時間欄直接丟掉——成交時間的時分秒對記帳沒有用。
  function dropTimeCells(cells) {
    return cells.filter((c, i) => !(TIME_LIKE.test(c) && i > 0 && DATE_LIKE.test(cells[i - 1])));
  }

  // 一行切成欄位：有逗號就照 CSV 規則（含引號），否則用 Tab／連續空白切
  function splitRow(line) {
    if (line.includes(',')) {
      const cells = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"' && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else if (ch === '"') inQuotes = false;
          else cur += ch;
        } else if (ch === '"') inQuotes = true;
        else if (ch === ',') {
          cells.push(cur);
          cur = '';
        } else cur += ch;
      }
      cells.push(cur);
      return dropTimeCells(cells.map((c) => c.trim()));
    }
    return dropTimeCells(line.trim().split(/[\t\s]+/));
  }

  function parseImportNumber(value) {
    const normalized = String(value ?? '').trim().replace(/,/g, '');
    return normalized === '' ? NaN : parseFloat(normalized);
  }

  // '2026/06/27 02:50:51' → '2026-06-27'（成交時間的時分秒不需要）
  function parseImportDate(value) {
    const head = String(value ?? '').trim().split(/[\sT]/)[0];
    const parts = head.replace(/\//g, '-').split('-');
    if (parts.length !== 3) return '';
    const [y, m, d] = parts;
    if (!/^\d{1,4}$/.test(y) || !/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d)) return '';
    return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // 依代號、名稱或不帶後綴的代號找標的
  function findStockByText(stocks, text) {
    const q = String(text ?? '').trim().toLowerCase();
    if (!q) return null;
    return (
      (stocks || []).find(
        (s) =>
          String(s.id).toLowerCase() === q ||
          String(s.symbol).toLowerCase() === q ||
          String(s.symbol).split('.')[0].toLowerCase() === q ||
          String(s.name).toLowerCase() === q
      ) || null
    );
  }

  function parseTransactionText(text, stocks) {
    const lines = String(text || '')
      .replace(/^﻿/, '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '');
    if (!lines.length) return { rows: [], failed: [], unknownSymbols: [] };

    let table = lines.map(splitRow);
    // 預設順序沿用既有的 CSV 匯入，避免舊檔匯入行為改變
    const col = { date: 0, stock: 1, shares: 2, price: 3, twd: 4, kind: 5, net: null };
    const first = table[0].map((c) => c.toLowerCase());
    const hasHeader = Object.values(IMPORT_HEADERS).some((names) => names.some((n) => first.includes(n)));
    if (hasHeader) {
      for (const key of Object.keys(col)) col[key] = null;
      for (const [key, names] of Object.entries(IMPORT_HEADERS)) {
        const idx = first.findIndex((c) => names.includes(c));
        if (idx >= 0) col[key] = idx;
      }
      table = table.slice(1);
    }

    const rows = [];
    const failed = [];
    const unknown = [];
    const cellAt = (cells, key) => (col[key] == null ? '' : cells[col[key]] ?? '');

    for (const [i, cells] of table.entries()) {
      const lineNo = i + 1 + (hasHeader ? 1 : 0);
      const raw = cells.join(' ').slice(0, 40);
      const date = parseImportDate(cellAt(cells, 'date'));
      const symbolText = String(cellAt(cells, 'stock')).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !symbolText) {
        failed.push(`第 ${lineNo} 行（${raw}）`);
        continue;
      }

      const kindRaw = String(cellAt(cells, 'kind')).trim().toLowerCase();
      const price = parseImportNumber(cellAt(cells, 'price'));
      const twdRaw = String(cellAt(cells, 'twd')).trim();
      const twdCost = twdRaw === '' ? null : Math.abs(parseImportNumber(twdRaw)) || null;
      const stock = findStockByText(stocks, symbolText);
      const stockId = stock ? stock.id : null;
      if (!stock && !unknown.includes(symbolText)) unknown.push(symbolText);
      const base = { date, symbolText, stockId, twdCost };

      if (DIVIDEND_WORDS.includes(kindRaw)) {
        if ((Number.isNaN(price) || price <= 0) && twdCost == null) {
          failed.push(`第 ${lineNo} 行（配息缺金額）`);
          continue;
        }
        rows.push({ ...base, kind: 'dividend', amount: Number.isNaN(price) ? 0 : price });
        continue;
      }

      // 賣出的判斷：買賣欄寫了賣、或（券商對帳單）淨收付為正
      const net = col.net == null ? NaN : parseImportNumber(cellAt(cells, 'net'));
      const isSell = SELL_WORDS.includes(kindRaw) || (!Number.isNaN(net) && net > 0);
      const magnitude = Math.abs(parseImportNumber(cellAt(cells, 'shares')));
      if (!magnitude || Number.isNaN(price)) {
        failed.push(`第 ${lineNo} 行（股數或價格無效）`);
        continue;
      }
      rows.push({ ...base, kind: 'trade', shares: isSell ? -magnitude : magnitude, price });
    }
    return { rows, failed, unknownSymbols: unknown };
  }

  // 依公司搜尋交易：比對標的名稱與代號（含不帶後綴的寫法）。
  // 標的被刪掉的孤兒交易至少還能用 stockId 找到，不然它在列表裡永遠搜不出來。
  function filterTransactionsByStockQuery(transactions, stocks, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return transactions;
    const stockOf = Object.fromEntries((stocks || []).map((s) => [s.id, s]));
    return (transactions || []).filter((t) => {
      const stock = stockOf[t.stockId];
      const haystack = stock
        ? [stock.name, stock.symbol, String(stock.symbol || '').split('.')[0]]
        : [t.stockId];
      return haystack.some((x) => String(x || '').toLowerCase().includes(q));
    });
  }

  // ---- 交易紀錄的時間區間篩選 ----
  // 日期一律以 'YYYY-MM-DD' 字串運算（不經 Date 的時區換算），與 app 其他地方的台北日期一致。

  const pad2 = (n) => String(n).padStart(2, '0');

  // 該年月的最後一天（1-based month）
  function lastDayOfMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  // 往前/後推 n 個日曆月；目標月沒有這一天時取該月最後一天（5/31 −3 月 → 2/28）
  function shiftMonths(dateStr, months) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const total = y * 12 + (m - 1) + months;
    const ny = Math.floor(total / 12);
    const nm = ((total % 12) + 12) % 12; // 0-based
    return `${ny}-${pad2(nm + 1)}-${pad2(Math.min(d, lastDayOfMonth(ny, nm + 1)))}`;
  }

  // preset → { from, to }（皆含端點；null 代表該側不設限）
  // 具名的日曆區間（本月／今年）連結尾也框住，滾動區間（近3月）只設起點。
  function transactionDateWindow({ preset, from, to, today }) {
    if (preset === 'custom') return { from: from || null, to: to || null };
    if (preset === 'month') {
      const [y, m] = String(today).split('-').map(Number);
      return { from: `${y}-${pad2(m)}-01`, to: `${y}-${pad2(m)}-${pad2(lastDayOfMonth(y, m))}` };
    }
    if (preset === 'year') {
      const y = String(today).slice(0, 4);
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    if (preset === '3mo') return { from: shiftMonths(today, -3), to: null };
    return { from: null, to: null }; // 'all' 與未知值
  }

  function filterTransactionsByDate(transactions, window) {
    const { from, to } = window || {};
    return (Array.isArray(transactions) ? transactions : []).filter((t) => {
      const d = String(t.date || '');
      return (!from || d >= from) && (!to || d <= to);
    });
  }

  // 月報用：每一列代表「整個月」，所以只要該月與區間有重疊就整列留下
  // （不去裁切成半個月的數字——那會讓「當月損益」名不副實）
  function filterMonthsByDate(rows, window) {
    const from = window && window.from ? String(window.from).slice(0, 7) : null;
    const to = window && window.to ? String(window.to).slice(0, 7) : null;
    return (Array.isArray(rows) ? rows : []).filter(
      (r) => (!from || String(r.month) >= from) && (!to || String(r.month) <= to)
    );
  }

  // 提醒的忽略鍵，格式見 CONTEXT.md：`split:<代號>:<日期>` / `div:<代號>:<日期>`
  function eventKey(type, symbol, date) {
    return type + ':' + symbol + ':' + date;
  }

  // 分割調整係數：把「date 當天的股數」換算成「所有更晚的分割都套用後」的股數。
  // splitList 統一為 [[date, ratio], ...]，來源可為 Yahoo 事件或 kind:'split' 交易。
  function splitFactorAfter(splitList, date) {
    let factor = 1;
    for (const [d, ratio] of splitList) if (d > date && ratio > 0) factor *= ratio;
    return factor;
  }

  // Yahoo 分割事件 [[ms, numerator, denominator]] → [[date, ratio]]
  function normalizeSplitEvents(splits) {
    return (Array.isArray(splits) ? splits : [])
      .map(([ms, numerator, denominator]) => [msToDateStr(ms), denominator > 0 ? numerator / denominator : 0])
      .filter(([, ratio]) => ratio > 0);
  }

  // 分割日當天的股數（未套用任何分割前的原始口徑）
  function rawSharesOn(sortedTxs, date) {
    let s = 0;
    for (const t of sortedTxs) {
      if (t.kind === 'dividend' || t.kind === 'split') continue;
      if (String(t.date) > date) break;
      s += Number(t.shares) || 0;
    }
    return s;
  }

  // 某日仍持有該標的的計畫——分割要對每個這樣的計畫各補一筆調整紀錄，
  // 未記帳配息的表單也預設勾選這些計畫
  function plansHoldingOn(plans, transactions, stockId, date) {
    return (Array.isArray(plans) ? plans : [])
      .filter((p) => {
        const mine = transactionsInPlan(transactions, p.id)
          .filter((t) => t.stockId === stockId)
          .sort((a, b) => String(a.date).localeCompare(String(b.date)));
        return rawSharesOn(mine, date) > 0;
      })
      .map((p) => p.id);
  }

  // 找出「分割日當天仍有股數、且尚未套用（無 7 天內同比例的 split 紀錄）也未忽略」的分割事件
  // splits：Yahoo 事件 [[ms, numerator, denominator], ...]；ignored：`split:<代號>:<日期>` 字串陣列
  function detectUnappliedSplits({ stock, transactions, splits, ignored }) {
    const list = Array.isArray(splits) ? splits : [];
    if (!list.length) return [];
    const mine = transactions
      .filter((t) => t.stockId === stock.id)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const splitTxs = mine.filter((t) => t.kind === 'split');
    const out = [];
    for (const [ms, numerator, denominator] of list) {
      const date = msToDateStr(ms);
      if ((ignored || []).includes(eventKey('split', stock.symbol, date))) continue;
      const ratio = denominator > 0 ? numerator / denominator : 0;
      if (!(ratio > 0) || ratio === 1) continue;
      // 分割當天沒有股數就與這個計畫無關（含分割前尚未買進、以及分割前已全數賣出）
      if (!(rawSharesOn(mine, date) > 0)) continue;
      // 已套用：7 天內有一筆比例相符的分割紀錄（比例不符表示是另一次分割，仍要提醒）
      const applied = splitTxs.some(
        (t) =>
          Math.abs(new Date(String(t.date)).getTime() - ms) <= 7 * 86400_000 &&
          Math.abs((Number(t.ratio) || 0) - ratio) < 1e-9
      );
      if (applied) continue;
      out.push({ stockId: stock.id, symbol: stock.symbol, date, ratio });
    }
    return out;
  }

  // 找出「除息日持有股數 > 0、除息日後 30 天內沒有配息交易、也未忽略」的除息事件
  // dividends：[[ms, 每股金額], ...]（Yahoo 為分割調整後口徑，故估算股數也用調整後）
  function detectUnrecordedDividends({ stock, transactions, dividends, splits, ignored }) {
    const evs = Array.isArray(dividends) ? dividends : [];
    if (!evs.length) return [];
    const eventSplits = normalizeSplitEvents(splits);
    const mine = transactions
      .filter((t) => t.stockId === stock.id)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const divTxs = mine.filter((t) => t.kind === 'dividend');
    const sharesAdjOn = (date) => {
      let s = 0;
      for (const t of mine) {
        if (t.kind === 'dividend' || t.kind === 'split') continue;
        if (String(t.date) > date) break;
        s += (Number(t.shares) || 0) * splitFactorAfter(eventSplits, String(t.date));
      }
      return s;
    };
    const out = [];
    for (const [ms, perShare] of evs) {
      const date = msToDateStr(ms);
      if ((ignored || []).includes(eventKey('div', stock.symbol, date))) continue;
      const shares = sharesAdjOn(date);
      if (!(shares > 0)) continue;
      const recorded = divTxs.some((t) => {
        const d = String(t.date);
        return d >= date && new Date(d).getTime() - ms <= 30 * 86400_000;
      });
      if (recorded) continue;
      out.push({ stockId: stock.id, symbol: stock.symbol, date, perShare, shares, estimatedAmount: perShare * shares });
    }
    return out;
  }

  // 把 { symbol: [[ms, close], ...] } 轉成 { symbol: (date) => 收盤 } 的查詢表。
  // forward-fill：查不到當天就取「≤ 該日的最後一筆」，週末與休市日才有值可用。
  function forwardFillSeries(series) {
    const ff = {};
    for (const [sym, points] of Object.entries(series || {})) {
      const ent = points.map(([t, c]) => [msToDateStr(t), c]);
      ff[sym] = (date) => {
        let lo = 0;
        let hi = ent.length - 1;
        let ans = null;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (ent[mid][0] <= date) {
            ans = ent[mid][1];
            lo = mid + 1;
          } else hi = mid - 1;
        }
        return ans;
      };
    }
    return ff;
  }

  // ---- 外幣成本釘住 ----
  // 外幣交易沒填 twdCost 時，computeStock 只能拿「現在」的匯率回推台幣成本，於是連一筆
  // 交易都沒有的日子，已投入成本也會跟著匯率上下跑。以下兩個函式把這種交易找出來，並用
  // 交易當天的歷史匯率算出台幣金額；呼叫端確認後寫回 twdCost，成本就定住不再飄。

  // 這筆交易的原幣金額（買賣＝股數×價格，配息＝配息總額）；不適用者回傳 null
  function nativeAmountOf(t) {
    if (t.kind === 'split') return null;
    if (t.kind === 'dividend') return Math.abs(Number(t.amount) || 0);
    return Math.abs(Number(t.shares) || 0) * (Number(t.price) || 0);
  }

  // 成本會隨即時匯率浮動的交易：外幣、且沒填 twdCost
  function unpinnedFxTransactions(stocks, transactions) {
    const stockOf = Object.fromEntries((stocks || []).map((s) => [s.id, s]));
    return (transactions || []).filter((t) => {
      const stock = stockOf[t.stockId];
      if (!stock || stock.currency === 'TWD') return false;
      if (t.kind === 'split') return false;
      return t.twdCost == null;
    });
  }

  // 為每筆浮動交易算出「交易當天匯率」換算的台幣金額。
  // 回傳 { pins, missing }：pins 可直接寫回 twdCost，missing 是查不到當天匯率的交易。
  function planFxPins({ stocks, transactions, history }) {
    const stockOf = Object.fromEntries((stocks || []).map((s) => [s.id, s]));
    const ff = forwardFillSeries(history?.series);
    const pins = [];
    const missing = [];
    for (const t of unpinnedFxTransactions(stocks, transactions)) {
      const stock = stockOf[t.stockId];
      const fxSym = fxSymbolOf(stock.currency);
      const rate = ff[fxSym]?.(String(t.date)) ?? null;
      const native = nativeAmountOf(t);
      const row = { id: t.id, date: t.date, stockId: t.stockId, symbol: stock.symbol, currency: stock.currency, native };
      if (rate == null || !(rate > 0)) missing.push({ ...row, reason: '查無 ' + fxSym + ' 在 ' + t.date + ' 的匯率' });
      else pins.push({ ...row, rate, twdCost: Math.round(native * rate) });
    }
    return { pins, missing };
  }

  // 把 planFxPins 的結果寫回交易紀錄；不就地修改輸入
  function applyFxPins(transactions, pins) {
    const byId = new Map(pins.map((p) => [p.id, p.twdCost]));
    return (transactions || []).map((t) => (byId.has(t.id) ? { ...t, twdCost: byId.get(t.id) } : t));
  }

  // 由交易紀錄＋歷史收盤價逐日重放，回推每天的市值、持有成本、當日損益與對比線
  function computeDailySeries({ history, stocks, transactions, quotes, budget, benchSymbol, today }) {
    const hist = history;
    if (!hist || !Object.keys(hist.series || {}).length) return null;
    const held = stocks.filter((s) => transactions.some((t) => t.stockId === s.id));
    if (!held.length) return null;

    const toDate = msToDateStr;
    const ff = forwardFillSeries(hist.series);

    const txs = [...transactions].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!txs.length) return null;
    const firstTxDate = txs[0].date;

    const dateSet = new Set();
    for (const s of held) for (const [t] of hist.series[s.symbol] || []) dateSet.add(toDate(t));
    const dates = [...dateSet].sort().filter((d) => d >= firstTxDate);
    if (!dates.length) return null;

    const stockOf = Object.fromEntries(held.map((s) => [s.id, s]));
    const bySt = Object.fromEntries(held.map((s) => [s.id, { shares: 0, costTWD: 0 }]));
    // Yahoo 歷史收盤是分割調整後價格：把每筆買賣的股數乘上「交易日之後所有分割」的比例，
    // 讓「調整後股數 × 調整後收盤」等於當日實際市值（分割日不會出現假損益）
    const splitsBySt = {};
    for (const t of txs) {
      if (t.kind === 'split' && stockOf[t.stockId]) {
        (splitsBySt[t.stockId] = splitsBySt[t.stockId] || []).push([String(t.date), Number(t.ratio) || 0]);
      }
    }
    const splitFactorAfter = (stockId, date) => {
      let f = 1;
      for (const [d, r] of splitsBySt[stockId] || []) if (d > date && r > 0) f *= r;
      return f;
    };
    const benchFF = ff[benchSymbol];
    let benchUnits = 0;
    let benchOk = !!benchFF;
    let ti = 0;
    const out = [];

    const consumeTx = (t, date) => {
      // 回傳 { flow, dividend }（台幣；flow 買為正、賣為負）
      const stock = stockOf[t.stockId];
      if (!stock) return { flow: 0, dividend: 0 };
      const fxSym = fxSymbolOf(stock.currency);
      const fxT = fxSym ? ff[fxSym]?.(t.date) ?? ff[fxSym]?.(date) : 1;
      if (t.kind === 'split') return { flow: 0, dividend: 0 }; // 效果已由 splitFactorAfter 吸收
      if (t.kind === 'dividend') {
        const amt = t.twdCost != null ? Number(t.twdCost) || 0 : (Number(t.amount) || 0) * (fxT ?? 0);
        return { flow: 0, dividend: amt };
      }
      const rawShares = Number(t.shares) || 0;
      const s = rawShares * splitFactorAfter(t.stockId, String(t.date)); // 股數用調整後
      const price = Number(t.price) || 0;
      const flowT = t.twdCost != null ? Math.abs(Number(t.twdCost)) : Math.abs(rawShares) * price * (fxT ?? 0); // 金流用原始股數
      const st = bySt[t.stockId];
      let flow = 0;
      if (s > 0) {
        st.costTWD += flowT;
        st.shares += s;
        flow = flowT;
      } else if (s < 0) {
        const sell = -s;
        const removed = Math.min(sell, Math.max(st.shares, 0));
        const avg = st.shares > 0 ? st.costTWD / st.shares : 0;
        st.costTWD -= avg * removed;
        st.shares -= sell;
        flow = -flowT;
      }
      // 對比線：同日以同額買入/賣出對比標的
      if (benchOk && flow !== 0) {
        const c = benchFF(t.date);
        if (c == null) benchOk = false;
        else benchUnits = Math.max(0, benchUnits + flow / c);
      }
      return { flow, dividend: 0 };
    };

    for (const date of dates) {
      let flow = 0;
      let dividendToday = 0;
      // 每筆交易只會被消化一次，因此消化到的配息就屬於「上一個資料點到今天」這段區間；
      // 不能只認 t.date === date，否則記在週末／休市日的配息會被整筆丟棄。
      while (ti < txs.length && txs[ti].date <= date) {
        const t = txs[ti++];
        const r = consumeTx(t, date);
        flow += r.flow;
        dividendToday += r.dividend;
      }
      let value = 0;
      let ok = true;
      for (const s of held) {
        const st = bySt[s.id];
        if (!st.shares) continue;
        const c = ff[s.symbol]?.(date);
        const fxSym = fxSymbolOf(s.currency);
        const fxD = fxSym ? ff[fxSym]?.(date) : 1;
        if (c == null || fxD == null) {
          ok = false;
          break;
        }
        value += st.shares * c * fxD;
      }
      if (!ok) continue;
      const invested = held.reduce((sum, s) => sum + bySt[s.id].costTWD, 0);
      const benchClose = benchOk ? benchFF(date) : null;
      out.push({
        date,
        value,
        invested,
        flow,
        dividendToday,
        bench: benchOk && benchClose != null ? benchUnits * benchClose : null,
      });
    }

    // 補上今日即時點（歷史序列還沒有今天、但目前報價可用時）
    if (out.length && out[out.length - 1].date < today && Object.keys(quotes).length) {
      const rows = stocks.map((s) => computeStock(s, transactions, quotes, budget));
      const anyMissing = rows.some((r) => r.valueTWD == null);
      if (!anyMissing) {
        let flow = 0;
        let dividendToday = 0;
        while (ti < txs.length) {
          const t = txs[ti++];
          const r = consumeTx(t, today);
          flow += r.flow;
          dividendToday += r.dividend;
        }
        const benchQuote = quotes[benchSymbol]?.price ?? (benchOk ? benchFF(today) : null);
        out.push({
          date: today,
          value: rows.reduce((s, r) => s + r.valueTWD, 0),
          invested: rows.reduce((s, r) => s + (r.invested ?? 0), 0),
          flow,
          dividendToday,
          bench: benchOk && benchQuote != null ? benchUnits * benchQuote : null,
        });
      }
    }

    // 當日損益＝市值變化 − 當日淨投入 ＋ 當日配息（入金不會被誤算成獲利）
    for (let i = 0; i < out.length; i++) {
      if (i === 0) {
        out[i].dPnl = null;
        out[i].dPct = null;
      } else {
        out[i].dPnl = out[i].value - out[i - 1].value - out[i].flow + out[i].dividendToday;
        out[i].dPct = out[i - 1].value > 0 ? out[i].dPnl / out[i - 1].value : null;
      }
    }
    return out;
  }

  // 月報：把每日序列彙總成每月一列——淨入金、配息、當月損益、TWR（(1+dPct) 連乘）、
  // 對比標的當月漲跌幅（月末收盤 vs 月初前最後收盤；首月以月內第一筆為基準）
  function computeMonthlyReport({ series, benchCloses }) {
    if (!Array.isArray(series) || !series.length) return [];
    const byMonth = new Map();
    for (const p of series) {
      const month = String(p.date).slice(0, 7);
      let m = byMonth.get(month);
      if (!m) byMonth.set(month, (m = { month, flow: 0, dividends: 0, pnl: 0, growth: 1, hasPct: false }));
      m.flow += p.flow || 0;
      m.dividends += p.dividendToday || 0;
      if (p.dPnl != null) m.pnl += p.dPnl;
      if (p.dPct != null) {
        m.growth *= 1 + p.dPct;
        m.hasPct = true;
      }
    }
    const bench = (Array.isArray(benchCloses) ? benchCloses : []).map(([ms, c]) => [msToDateStr(ms), c]);
    return [...byMonth.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => {
        let base = null;
        let first = null;
        let last = null;
        for (const [d, c] of bench) {
          if (d.slice(0, 7) < m.month) base = c;
          else if (d.slice(0, 7) === m.month) {
            if (first == null) first = c;
            last = c;
          }
        }
        if (base == null) base = first;
        const benchPct = base != null && last != null && base > 0 ? (last - base) / base : null;
        return {
          month: m.month,
          flow: m.flow,
          dividends: m.dividends,
          pnl: m.pnl,
          twr: m.hasPct ? m.growth - 1 : null,
          benchPct,
        };
      });
  }

  // XIRR 年化報酬率：買入為負現金流、賣出/配息為正、期末市值（today 當日）為正，二分法解 NPV=0
  function computeXirr({ rows, stocks, transactions, quotes, today }) {
    if (!rows.length || rows.some((r) => r.valueTWD == null)) return null;
    const totalValue = rows.reduce((s, r) => s + r.valueTWD, 0);
    const flows = [];
    for (const t of transactions) {
      if (t.kind === 'split') continue; // 分割無現金流
      const stock = stocks.find((s) => s.id === t.stockId);
      if (!stock) continue;
      const fx = fxRateOf(stock.currency, quotes);
      if (t.kind === 'dividend') {
        const amt = t.twdCost != null ? Number(t.twdCost) || 0 : fx != null ? (Number(t.amount) || 0) * fx : null;
        if (amt == null) return null;
        flows.push([t.date, amt]);
        continue;
      }
      const s = Number(t.shares) || 0;
      const amt = t.twdCost != null ? Math.abs(Number(t.twdCost)) : fx != null ? Math.abs(s) * (Number(t.price) || 0) * fx : null;
      if (amt == null) return null;
      flows.push([t.date, s > 0 ? -amt : amt]);
    }
    if (!flows.length) return null;
    flows.push([today, totalValue]);
    flows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));

    const t0 = new Date(flows[0][0]).getTime();
    const spanDays = (new Date(flows[flows.length - 1][0]).getTime() - t0) / 86400_000;
    if (spanDays < 30) return null; // 期間太短，年化沒有意義
    if (!flows.some(([, a]) => a < 0) || !flows.some(([, a]) => a > 0)) return null;

    const npv = (r) =>
      flows.reduce((sum, [d, a]) => sum + a / Math.pow(1 + r, (new Date(d).getTime() - t0) / 86400_000 / 365), 0);
    let lo = -0.95;
    let hi = 10;
    let fLo = npv(lo);
    if (fLo * npv(hi) > 0) return null;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      if (fLo * npv(mid) <= 0) hi = mid;
      else {
        lo = mid;
        fLo = npv(lo);
      }
    }
    return (lo + hi) / 2;
  }

  return {
    fxSymbolOf,
    fxRateOf,
    eventKey,
    DEFAULT_BUDGET,
    slimSnapshot,
    slimSnapshots,
    migratePortfolio,
    transactionsInPlan,
    transactionsOnlyInPlan,
    transactionDateWindow,
    filterTransactionsByDate,
    filterTransactionsByStockQuery,
    findStockByText,
    parseTransactionText,
    filterMonthsByDate,
    upsertSnapshots,
    copyTransactionsToPlan,
    addTransactionsToPlan,
    upsertStockFromSymbol,
    CURRENCIES,
    removeTransactionsFromPlan,
    countTransactionsRemoval,
    plansHoldingOn,
    removePlan,
    computeStock,
    forwardFillSeries,
    unpinnedFxTransactions,
    planFxPins,
    applyFxPins,
    computeDailySeries,
    computeMonthlyReport,
    computeXirr,
    detectUnappliedSplits,
    detectUnrecordedDividends,
  };
});
