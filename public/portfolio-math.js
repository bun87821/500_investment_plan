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

  // XIRR 年化報酬率：買入為負現金流、賣出/配息為正、期末市值（today 當日）為正，二分法解 NPV=0
  function computeXirr({ rows, stocks, transactions, quotes, today }) {
    if (!rows.length || rows.some((r) => r.valueTWD == null)) return null;
    const totalValue = rows.reduce((s, r) => s + r.valueTWD, 0);
    const flows = [];
    for (const t of transactions) {
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
    computeStock,
    computeXirr,
  };
});
