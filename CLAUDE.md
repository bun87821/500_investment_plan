# CLAUDE.md

投資組合追蹤網頁（500 萬台幣投資計畫）。單一 Express 伺服器 + 原生 JS 前端，資料存 Postgres（無 `DATABASE_URL` 時退回本機 JSON 檔）。

## 常用指令

```bash
npm start    # 啟動伺服器（http://localhost:3000）
npm test     # API 測試（node:test）＋ Playwright 端對端測試
# Playwright 瀏覽器不在預設位置時：CHROMIUM_PATH=/path/to/chromium npm test
```

## 架構速覽

- `server.js` — 全部後端：Express 路由、Google 登入、Postgres/JSON 儲存、Yahoo Finance 報價代理、歷史回推
- `public/` — 前端（`index.html` + `app.js` + `style.css`），無框架、無打包
- `tests/` — `api.test.js`（API）、`e2e.test.js`（Playwright）、`helpers.js`
- 領域詞彙見 `CONTEXT.md`；架構決策紀錄放 `docs/adr/`

## Agent skills

本 repo 安裝了 [Matt Pocock 的 skills 工作流](https://github.com/mattpocock/skills)（`.claude/skills/`）。
建議流程：`/grill-me` → `/to-spec` → `/to-tickets` → `/implement`（內含 TDD）→ `/code-review`。
完整說明見 `docs/agents/workflow.md`。

### Issue tracker

Issues 追蹤在 GitHub（`bun87821/500_investment_plan`）。See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context：repo 根目錄的 `CONTEXT.md` + `docs/adr/`。See `docs/agents/domain.md`.
