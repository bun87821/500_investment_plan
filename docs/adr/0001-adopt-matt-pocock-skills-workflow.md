# ADR-0001：採用 Matt Pocock skills 作為 AI 開發工作流

日期：2026-07-26 ｜ 狀態：Accepted

## 背景

本專案主要透過 Claude Code 開發。過去的失敗模式：需求對齊不足就開工、AI 產出的測試流於形式（斷言跟實作同一套邏輯）、大改動一次做完難以驗證。

## 決策

採用 [mattpocock/skills](https://github.com/mattpocock/skills)（MIT）的工作流，將核心 skills 直接複製進 `.claude/skills/`（fork-and-own，而非 plugin 訂閱），並完成其 per-repo 設定：

- Issue tracker：GitHub issues（`docs/agents/issue-tracker.md`）
- Domain docs：single-context，根目錄 `CONTEXT.md` ＋ `docs/adr/`（`docs/agents/domain.md`）
- 建議流程：`/grill-me` → `/to-spec` → `/to-tickets` → `/implement`（TDD）→ `/code-review`

## 影響

- 新功能先對齊（grill）、成文（spec）、拆垂直切片（tickets），再以 TDD 實作。
- 測試只寫在講好的 seam：本 repo 為 `tests/api.test.js` 的 HTTP 介面與 Playwright E2E。
- skills 為本地副本，可自行修改；要跟上游同步需手動更新。
