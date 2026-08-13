# 投資計畫追蹤

投資組合追蹤網頁：自訂總投資金額與標的配置，依目標比例計算各標的應投入金額、記錄實際買入的股數與成本，並以 Yahoo Finance 即時報價換算目前市值與投資進度。支援 Google 登入，每個帳號儲存自己的計畫；不登入也可以使用（資料存在瀏覽器本機）。

## 預設目標配置（範本，總預算與配置皆可自行修改）

| 股票 | 代號 | 市場 | 比例 | 目標金額 |
| --- | --- | --- | ---: | ---: |
| 台積電 | 2330.TW | 台股 | 25% | NT$1,250,000 |
| 富邦台50 | 006208.TW | 台灣 | 0% | NT$0 |
| 元大台灣50 | 0050.TW | 台灣 | 0% | NT$0 |
| 台玻 | 1802.TW | 台灣 | 0% | NT$0 |
| TSM ADR | TSM | 美股 | 25% | NT$1,250,000 |
| SK hynix | 000660.KS | 韓股 | 10% | NT$500,000 |
| NVIDIA | NVDA | 美股 | 7% | NT$350,000 |
| 台達電 | 2308.TW | 台股 | 7% | NT$350,000 |
| 智邦 | 2345.TW | 台灣 | 0% | NT$0 |
| 台光電 | 2383.TW | 台股 | 5% | NT$250,000 |
| 聯發科 | 2454.TW | 台灣 | 0% | NT$0 |
| 萬海 | 2615.TW | 台灣 | 0% | NT$0 |
| 奇鋐 | 3017.TW | 台股 | 5% | NT$250,000 |
| 緯創 | 3231.TW | 台灣 | 0% | NT$0 |
| Micron | MU | 美股 | 5% | NT$250,000 |
| Broadcom | AVGO | 美股 | 3% | NT$150,000 |
| 雙鴻 | 3324.TW | 台股 | 3% | NT$150,000 |
| 金像電 | 2368.TW | 台股 | 3% | NT$150,000 |
| 欣興 | 3037.TW | 台股 | 2% | NT$100,000 |
| 健策 | 3653.TW | 台灣 | 0% | NT$0 |
| 榮剛 | 5009.TWO | 台北 | 0% | NT$0 |
| 力積電 | 6770.TW | 台灣 | 0% | NT$0 |
| 復華台灣科技優息 | 00929.TW | 台灣 | 0% | NT$0 |
| 華景電 | 6788.TWO | 台北 | 0% | NT$0 |
| **合計** | | | **100%** | **NT$5,000,000** |

> SK hynix 未在台股或美股主板上市，採韓國原股 000660.KS 報價（可透過複委託買入）。美股與韓股皆以即時匯率（USD/TWD、KRW/TWD）換算成台幣計算進度。

## 功能

- 依比例自動計算每檔應投入的台幣金額
- 「✎ 編輯標的」可直接在頁面上調整標的清單：改名稱/代號/市場/類別/幣別/比例、新增或移除標的、修改總預算（上表為預設配置，設定會存進資料庫）
- 「資產類別配置」甜甜圈圖：依產業類別（記憶體、PCB、散熱…）分組上色顯示佔比，可切換基準（目標配置／投入成本／目前市值），圖例列出各類別與所屬標的的比例
- 記錄每筆交易（股數、原幣價格、可選填實際台幣成本；賣出輸入負股數）
- 即時報價（Yahoo Finance，經後端代理避免 CORS）：開頁載入一次，之後按「↻ 更新報價」手動更新
- **歷史市值回推**：依交易紀錄與歷史收盤價自動回推「從第一筆買入到今天」每天的市值與當日損益（入金/賣出金流不會被誤算成損益），可切 1月/3月/6月/1年/全部；每天 14:00 的快照作為備援資料
- **年化報酬率（XIRR）**與「同額投入 0050」對比線：檢視自己選股有沒有贏過大盤
- **再平衡建議**：依目標比例與現價算出每檔該買（賣）幾股與金額，可切「依總預算」（分批投入時把剩餘資金投向落後標的）或「依目前市值」（不加錢的純再平衡），偏離 <1% 視為已平衡
- **已實現損益與配息**：賣出以平均成本法計算已實現損益；交易可記「現金股利」；KPI 分列未實現／已實現（含股利）
- **股票分割偵測**：抓 Yahoo 分割事件，發現「分割日在你買入之後、紀錄卻還沒調整」時顯示提醒，一鍵產生分割紀錄（股數×比例、成本不變），可刪除復原；絕不自動改資料
- **未記帳配息提醒**：持有期間除息卻沒記帳時提醒（附每股金額、當時股數與估算金額），一鍵帶入預填的配息表單。誤判可「忽略」，忽略狀態跨裝置同步
- **月報**：每月一列的總覽表——淨投入、配息、當月損益、月報酬率（TWR）與 0050 當月對比，點列展開每日損益明細
- **PWA**：手機可「加入主畫面」像 App 一樣開啟；離線時顯示最後一次載入的資料並標示離線（正式站 https 才啟用 service worker）
- **交易可編輯**（✎）與 **CSV 批次匯入**（date, stock, shares, price, twd, kind）
- **多裝置併發保護**：樂觀鎖（rev 版本號），兩個裝置同時操作不會互相覆蓋資料
- 每檔標的投入進度條、平均成本、市值、未實現損益（紅漲綠跌）
- 整體 KPI：已投入成本、目前市值、未實現損益、整體投資進度
- 交易紀錄可刪除；支援 JSON 匯出／匯入備份

## 本機執行

```bash
npm install
npm start
# 開啟 http://localhost:3000
```

## 測試

```bash
npm test   # API 測試（node:test）＋ Playwright 端對端測試
```

GitHub Actions（`.github/workflows/ci.yml`）會在每次 push / PR 自動跑完整測試。本機若 Playwright 瀏覽器不在預設位置，可用 `CHROMIUM_PATH=/path/to/chromium npm test` 指定。

## 使用者模式

| 模式 | 條件 | 資料存放 |
| --- | --- | --- |
| 單人模式 | 未設定 `GOOGLE_CLIENT_ID` | 伺服器共用一份（Postgres `legacy` 列） |
| 訪客（多人模式下未登入） | 已設定 `GOOGLE_CLIENT_ID`，未登入 | 只存瀏覽器 localStorage |
| 已登入 | Google 登入 | Postgres，依 Google 帳號分開 |

訪客登入後，若帳號還沒有資料，會自動把訪客時期在該瀏覽器建立的計畫同步到帳號。

## 部署到 Railway

1. 將此 repo 連結到 Railway 新專案，Railway 會自動偵測 Node.js 並執行 `npm start`（`PORT` 由 Railway 自動注入）。
2. 在專案內新增 **PostgreSQL**，並確認應用服務的 Variables 有 `DATABASE_URL`（Railway 通常會自動建立參照；若沒有，手動加上 `DATABASE_URL = ${{Postgres.DATABASE_URL}}`）。有 `DATABASE_URL` 時資料存進 Postgres，重新部署也不會遺失。
3. 未設定 `DATABASE_URL` 時退回本機 JSON 檔（`data/`，可用 `DATA_DIR` 改路徑）——僅適合本機開發，Railway 重新部署會清空。

### 啟用 Google 登入（多人模式）

1. 到 [Google Cloud Console](https://console.cloud.google.com/apis/credentials) 建立（或選擇）一個專案 → 「建立憑證」→「OAuth 用戶端 ID」→ 應用程式類型選 **網頁應用程式**。
   - 第一次使用需先設定「OAuth 同意畫面」：User Type 選 External，填應用程式名稱即可發布（Testing 狀態下只有加入的測試帳號能登入，記得按「發布應用程式」）。
2. 「已授權的 JavaScript 來源」加入你的 Railway 網址（例如 `https://xxxx.up.railway.app`；本機開發再加 `http://localhost:3000`）。不需要設定重新導向 URI。
3. 在 Railway 應用服務的 Variables 加入：
   - `GOOGLE_CLIENT_ID`＝剛拿到的用戶端 ID（`xxxx.apps.googleusercontent.com`）
   - `SESSION_SECRET`＝任意長隨機字串（例如 `openssl rand -hex 32` 的輸出）。不設也能跑，但每次重新部署所有人都要重新登入。
   - `CANONICAL_HOST`＝主要網址的 host（例如 `500investmentplan-production.up.railway.app`）。Railway 若同時有兩個網址，瀏覽器 cookie 會分開；設定後副網址會自動導回主要網址，避免看起來被登出。
4. 重新部署後，頁面上方會出現「使用 Google 登入」。

啟用登入前既有的共用資料仍保留在資料庫的 `legacy` 列；原本使用該瀏覽器的人登入後，瀏覽器備份會自動同步到他的帳號。

## AI 開發工作流（Agent Skills）

本 repo 安裝了 [Matt Pocock 的 agent skills](https://github.com/mattpocock/skills)（`.claude/skills/`），在 Claude Code 中的建議流程：

```
/grill-me → /to-spec → /to-tickets → /implement（TDD）→ /code-review
```

完整說明（含深模組思維與 Superpowers 比較）見 [`docs/agents/workflow.md`](docs/agents/workflow.md)；領域詞彙表見 [`CONTEXT.md`](CONTEXT.md)。

## API

- `GET /api/config` – 前端設定（是否啟用登入、Google Client ID）
- `GET /api/me` – 目前登入的使用者
- `POST /api/auth/google` – 以 Google ID token 登入（設定 httpOnly session cookie）
- `POST /api/auth/logout` – 登出
- `GET /api/portfolio` – 取得自己的計畫（多人模式需登入）
- `PUT /api/portfolio` – 覆寫自己的計畫 `{ "budget": 5000000, "stocks": [...], "transactions": [...] }`
- `GET /api/quotes?symbols=2330.TW,TSM,TWD=X` – 批次報價（60 秒快取）
- `GET /api/events?symbols=NVDA,2330.TW` – 分割與配息事件（6 小時快取），供分割偵測與未記帳配息提醒使用
