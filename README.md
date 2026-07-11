# 投資計畫追蹤

投資組合追蹤網頁：自訂總投資金額與標的配置，依目標比例計算各標的應投入金額、記錄實際買入的股數與成本，並以 Yahoo Finance 即時報價換算目前市值與投資進度。支援 Google 登入，每個帳號儲存自己的計畫；不登入也可以使用（資料存在瀏覽器本機）。

## 預設目標配置（範本，總預算與配置皆可自行修改）

| 股票 | 代號 | 市場 | 比例 | 目標金額 |
| --- | --- | --- | ---: | ---: |
| 台積電 | 2330.TW | 台股 | 25% | NT$1,250,000 |
| TSM ADR | TSM | 美股 | 25% | NT$1,250,000 |
| SK hynix | 000660.KS | 韓股 | 10% | NT$500,000 |
| NVIDIA | NVDA | 美股 | 7% | NT$350,000 |
| 台達電 | 2308.TW | 台股 | 7% | NT$350,000 |
| 台光電 | 2383.TW | 台股 | 5% | NT$250,000 |
| 奇鋐 | 3017.TW | 台股 | 5% | NT$250,000 |
| Micron | MU | 美股 | 5% | NT$250,000 |
| Broadcom | AVGO | 美股 | 3% | NT$150,000 |
| 雙鴻 | 3324.TW | 台股 | 3% | NT$150,000 |
| 金像電 | 2368.TW | 台股 | 3% | NT$150,000 |
| 欣興 | 3037.TW | 台股 | 2% | NT$100,000 |
| **合計** | | | **100%** | **NT$5,000,000** |

> SK hynix 未在台股或美股主板上市，採韓國原股 000660.KS 報價（可透過複委託買入）。美股與韓股皆以即時匯率（USD/TWD、KRW/TWD）換算成台幣計算進度。

## 功能

- 依比例自動計算每檔應投入的台幣金額
- 「✎ 編輯標的」可直接在頁面上調整標的清單：改名稱/代號/市場/類別/幣別/比例、新增或移除標的、修改總預算（上表為預設配置，設定會存進資料庫）
- 「資產類別配置」甜甜圈圖：依產業類別（記憶體、PCB、散熱…）分組上色顯示佔比，可切換基準（目標配置／投入成本／目前市值），圖例列出各類別與所屬標的的比例
- 記錄每筆交易（股數、原幣價格、可選填實際台幣成本；賣出輸入負股數）
- 即時報價（Yahoo Finance，經後端代理避免 CORS）：開頁載入一次，之後按「↻ 更新報價」手動更新
- 每檔標的投入進度條、平均成本、市值、未實現損益（紅漲綠跌）
- 整體 KPI：已投入成本、目前市值、未實現損益、整體投資進度
- 交易紀錄可刪除；支援 JSON 匯出／匯入備份

## 本機執行

```bash
npm install
npm start
# 開啟 http://localhost:3000
```

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
4. 重新部署後，頁面上方會出現「使用 Google 登入」。

啟用登入前既有的共用資料仍保留在資料庫的 `legacy` 列；原本使用該瀏覽器的人登入後，瀏覽器備份會自動同步到他的帳號。

## API

- `GET /api/config` – 前端設定（是否啟用登入、Google Client ID）
- `GET /api/me` – 目前登入的使用者
- `POST /api/auth/google` – 以 Google ID token 登入（設定 httpOnly session cookie）
- `POST /api/auth/logout` – 登出
- `GET /api/portfolio` – 取得自己的計畫（多人模式需登入）
- `PUT /api/portfolio` – 覆寫自己的計畫 `{ "budget": 5000000, "stocks": [...], "transactions": [...] }`
- `GET /api/quotes?symbols=2330.TW,TSM,TWD=X` – 批次報價（60 秒快取）
