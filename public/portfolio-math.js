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

  return {
    fxSymbolOf,
    fxRateOf,
    computeStock,
  };
});
