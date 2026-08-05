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
    const snapshots = (Array.isArray(doc.snapshots) ? doc.snapshots : []).map((s) =>
      s.planId ? s : { ...s, planId: primary }
    );
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
  function transactionsOnlyInPlan(transactions, planId) {
    return (Array.isArray(transactions) ? transactions : []).filter(
      (t) => Array.isArray(t.plans) && t.plans.length === 1 && t.plans[0] === planId
    );
  }

  // 從既有計畫複製交易：產生獨立副本（新的交易 id、只掛新計畫），來源不受影響。
  // makeId 由呼叫端提供，讓這個函式維持純函式。
  function copyTransactionsToPlan(transactions, fromPlanId, toPlanId, makeId) {
    return transactionsInPlan(transactions, fromPlanId).map((t) => ({ ...t, id: makeId(), plans: [toPlanId] }));
  }

  // 刪除計畫：孤兒交易與該計畫的快照一併刪除，同時掛在其他計畫的交易只移除這個標籤
  function removePlan(doc, planId) {
    return {
      ...doc,
      plans: (doc.plans || []).filter((p) => p.id !== planId),
      transactions: (doc.transactions || [])
        .filter((t) => !(Array.isArray(t.plans) && t.plans.length === 1 && t.plans[0] === planId))
        .map((t) => (Array.isArray(t.plans) && t.plans.includes(planId) ? { ...t, plans: t.plans.filter((p) => p !== planId) } : t)),
      snapshots: (doc.snapshots || []).filter((s) => s.planId !== planId),
    };
  }

  function msToDateStr(ms) {
    return new Date(ms).toISOString().slice(0, 10);
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

  // 由交易紀錄＋歷史收盤價逐日重放，回推每天的市值、持有成本、當日損益與對比線
  function computeDailySeries({ history, stocks, transactions, quotes, budget, benchSymbol, today }) {
    const hist = history;
    if (!hist || !Object.keys(hist.series || {}).length) return null;
    const held = stocks.filter((s) => transactions.some((t) => t.stockId === s.id));
    if (!held.length) return null;

    const toDate = (ms) => new Date(ms).toISOString().slice(0, 10);
    const ff = {}; // symbol -> forward-fill 查詢（回傳 ≤ 該日的最後收盤）
    for (const [sym, points] of Object.entries(hist.series)) {
      const ent = points.map(([t, c]) => [toDate(t), c]);
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
    migratePortfolio,
    transactionsInPlan,
    transactionsOnlyInPlan,
    copyTransactionsToPlan,
    removePlan,
    computeStock,
    computeDailySeries,
    computeMonthlyReport,
    computeXirr,
    detectUnappliedSplits,
    detectUnrecordedDividends,
  };
});
