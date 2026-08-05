# CONTEXT.md — 投資計畫追蹤 領域詞彙表

本檔是這個 repo 的 domain glossary（ubiquitous language）。所有 issue 標題、spec、測試名稱、重構提案在提到領域概念時，一律使用這裡定義的詞彙，不要換用同義詞。

## 詞彙表

| 詞彙 | 英文 / 程式欄位 | 定義 |
| --- | --- | --- |
| 帳號資料 | portfolio | 一個使用者的完整資料：`{ stocks, plans, transactions, snapshots, ignoredEvents, rev }`，透過 `GET/PUT /api/portfolio` 整份讀寫 |
| 計畫 | plan | 一個具名的投資規劃：`{ id, name, budget, allocations }`，例如「信貸」「退休」。一個帳號可有多個，以分頁切換 |
| 目前計畫 | active plan | 使用者當下選中的分頁；存在 localStorage（依使用者分開），重新開頁回到上次的計畫 |
| 總預算 | `budget` | 單一計畫的總投資金額（台幣），每個計畫各有一個；留空（`null`）代表不設目標 |
| 純記錄型計畫 | plan without target | 沒有總預算的計畫：只記錄持股、每日損益與總資產，不顯示達成率、資金投入進度條、再平衡建議與目標配置基準 |
| 標的 | stock | 一檔要投資的股票：名稱、代號（Yahoo Finance symbol）、市場（台股/美股/韓股）、產業類別、幣別。全帳號共用一份清單 |
| 目標配置 | `allocations` | 計畫底下「標的 id → 目標百分比」的對應，合計 100%；乘上該計畫的總預算得到每檔的目標金額。每個計畫各有一套 |
| 交易 | transaction | 一筆買入/賣出/配息紀錄：`{ stockId, date, shares, price, twd, kind, plans }`；賣出以負股數表示；`plans` 標明它屬於哪些計畫（可多個） |
| 現金股利 | `kind: 'dividend'` | 配息交易，計入已實現損益，不影響持股股數 |
| 平均成本 | average cost | 每檔標的的持股平均成本；賣出時以平均成本法結算已實現損益 |
| 已實現損益 | realized P/L | 賣出結算＋現金股利的合計 |
| 未實現損益 | unrealized P/L | 目前市值 − 已投入成本（紅漲綠跌顯示） |
| 報價 | quote | Yahoo Finance 即時報價，經後端 `/api/quotes` 代理，60 秒快取；美股/韓股以即時匯率換算台幣 |
| 快照 | snapshot | 每天 14:00 記錄的市值，帶 `planId` 標明屬於哪個計畫，作為歷史圖的備援資料 |
| 歷史回推 | historical backfill | 依交易紀錄與歷史收盤價回推每日市值與當日損益；入金/賣出金流不得誤算成損益 |
| XIRR | XIRR | 以金流計算的年化報酬率 |
| 0050 對比 | benchmark | 「同額同日投入 0050」的對照市值曲線 |
| 再平衡 | rebalance | 依目標比例算出每檔應買（賣）股數；兩種基準：「依總預算」（分批投入）與「依目前市值」（不加錢純再平衡）；偏離 <1% 視為已平衡 |
| 分割 | `kind: 'split'` | 股票分割紀錄（`ratio`＝比例）；重放時股數 ×ratio、成本不變、無現金流 |
| 分割偵測 | unapplied split | Yahoo 分割事件中「分割日當天仍有股數、且尚未有同比例分割紀錄」者，以提醒橫幅呈現；套用時對每個持有該標的的計畫各補一筆 |
| 未記帳配息 | unrecorded dividend | Yahoo 除息事件中「除息日仍有股數、但 30 天內沒有配息交易」者 |
| 孤兒交易 | orphan transaction | 唯一計畫標籤就是某個計畫的交易；刪除該計畫時會一併消失（同時掛在其他計畫的只移除標籤） |
| 忽略清單 | `ignoredEvents` | 已忽略的提醒鍵（`split:<代號>:<日期>`／`div:<代號>:<日期>`），全帳號共用一份，存在帳號資料裡跨裝置同步 |
| 月報 | monthly report | 每月一列的總覽：淨投入、配息、當月損益、月報酬率（TWR）、0050 當月對比 |
| 月報酬率 | TWR | 時間加權報酬率＝當月每日 `dPct` 的 (1+r) 連乘 −1，不受入金時點影響 |
| 樂觀鎖 | `rev` | 帳號資料的版本號；`PUT /api/portfolio` 需帶上讀到的 `rev`，不符則拒絕寫入，防多裝置互相覆蓋 |
| 使用者模式 | user mode | 單人模式（未設 `GOOGLE_CLIENT_ID`，共用 `legacy` 列）／訪客（localStorage）／已登入（Postgres 依 Google 帳號分開） |

## 避免使用的詞

- 「持股」單獨使用時語意含糊 — 指標的本身用**標的**，指數量用**股數**。
- 不要用**計畫**指整份使用者資料 — 那是**帳號資料**；「計畫」專指信貸、退休這種具名規劃。
- 不要把**快照**與**歷史回推**混稱「歷史資料」— 前者是備援實測值，後者是推算值。
