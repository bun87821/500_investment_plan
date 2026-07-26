# Matt Pocock Skills 工作流指南

本 repo 已安裝 TypeScript 教育者 Matt Pocock 開源的 AI 開發工作流（agent skills），來源與參考：

- Skill repo：<https://github.com/mattpocock/skills>（MIT License）
- 導讀影片：<https://youtu.be/aR97E7aKEgg>

Skills 安裝在 `.claude/skills/`，在 Claude Code 內以斜線指令呼叫（例如 `/grill-me`）。部分 skill（`grilling`、`tdd`、`codebase-design`）也會在對話觸發時自動載入。

## 核心理念

> 「沒有人確切知道自己要什麼。」— The Pragmatic Programmer

AI 開發最常見的失敗不是模型不夠聰明，而是**對齊失敗**：你以為 AI 懂你要什麼，做出來才發現完全不是。GSD、BMAD、Spec-Kit 這類框架用「接管整個流程」來解決，但也拿走了你的控制權。Matt Pocock 的做法相反：**每個 skill 都很小、可組合、可自行修改**——最紅的 `grill-me` 打開來只有一行指令，真正的內容在它引用的 `grilling`，也不過十幾行。

## 建議工作流程

### 1. `/grill-me` — 讓 AI 反過來拷問你

先不寫程式。AI 會**一次一題**地追問你計畫的每個分支：邊界條件、取捨、你沒想過的情境，每題附上它建議的答案。事實類問題它自己查程式碼，**決策**留給你。直到雙方達成共識前，它不會動手。這是整套系統的靈魂：把「對齊」放在寫程式之前。

### 2. `/to-spec` — 把共識變成規格書

把剛才的對話整理成 spec（PRD）：問題陳述、使用者故事、實作決策、**測試決策**（先講好要在哪些 seam 測試）、明確的 out of scope。發佈成 GitHub issue。不會重新訪談你——它只整理已經談好的東西。

### 3. `/to-tickets` — 拆成 tracer-bullet 任務

把 spec 拆成**垂直切片**的 tickets：每張票都貫穿全部層（schema、API、UI、測試），單獨可 demo、可驗證，大小塞得進一個新的 context window。每張票標明被哪些票 blocked，先做沒有 blocker 的。大範圍重構則例外，改用 expand–contract 分批進行。

### 4. `/implement`（內含 `/tdd`）— 測試先行，防 AI 作弊

`implement` 本身只有五行：照 ticket 實作、盡量走 TDD、定期跑型別檢查與測試、最後跑完整測試、做 code review、commit。重點在 `tdd` skill 的紀律：

- **紅在綠之前**：先寫會失敗的測試，再寫剛好讓它通過的程式。
- **只在事先講好的 seam 測試**：測公開介面的行為，不測實作細節。
- **反作弊條款**：禁止「套套邏輯測試」（斷言用跟實作同一套算法重算出來，永遠會過）、禁止一次寫完所有測試再補實作（測的是想像中的行為）。期望值必須來自獨立的事實來源。

對本 repo 來說：API 測試走 `tests/api.test.js` 的 HTTP 介面、E2E 走 Playwright——這兩個就是現成的 seam。

### 5. `/code-review` — 兩軸審查

兩個平行 sub-agent 分別檢查：**Standards**（是否符合 repo 慣例＋Fowler code smell 基準）與 **Spec**（是否忠實做完 issue 要求的事、有沒有偷加東西）。兩軸分開回報，避免「程式碼很乾淨」掩蓋「做錯東西」。

## 深模組（Deep Modules）架構思維

`codebase-design` skill 提供整套設計詞彙（源自 Ousterhout《A Philosophy of Software Design》＋ Michael Feathers 的 seam）：

- **深模組** = 小介面 + 大量實作。介面越小、藏起來的複雜度越多，呼叫者的**槓桿**越大、維護者的**局部性**越好。
- **刪除測試**：想像把這個模組刪掉——如果複雜度跟著消失，它只是 pass-through；如果複雜度散落到 N 個呼叫端重新長出來，它才是有價值的。
- **一個 adapter 是假想的 seam，兩個 adapter 才是真的**：沒有真正會變動的東西，就不要預先抽介面。
- 介面即測試面：測試和呼叫者走同一個 seam。

## 與 Superpowers 的比較

| | Matt Pocock skills | Superpowers |
| --- | --- | --- |
| 哲學 | 小而可組合，每一步你自己按 | 大而全，流程自動串接、強制性高 |
| 內容量 | 每個 skill 幾行到幾十行，讀得完、改得動 | 數十個 skills + 強制工作流，黑盒感較重 |
| 控制權 | 流程出問題時容易定位、容易改 | 省事，但流程有 bug 時難以介入 |
| 適合誰 | 想理解並掌控流程的工程師 | 想要開箱即用、全自動化體驗的人 |

一句話：**想當駕駛選 Matt Pocock，想搭自駕選 Superpowers**。兩者不衝突，也可以混用。

## 本 repo 的設定

| 項目 | 設定 |
| --- | --- |
| 已安裝 skills | `grill-me`、`grilling`、`to-spec`、`to-tickets`、`implement`、`tdd`、`code-review`、`codebase-design`、`setup-matt-pocock-skills` |
| Issue tracker | GitHub（`bun87821/500_investment_plan`），見 `docs/agents/issue-tracker.md` |
| Domain docs | Single-context：根目錄 `CONTEXT.md` ＋ `docs/adr/`，見 `docs/agents/domain.md` |

Skills 是直接複製進 repo 的（skills.sh 哲學：fork 下來改成自己的）。要更新到上游新版或改用 plugin 訂閱制，見上游 README；要換 issue tracker，重跑 `/setup-matt-pocock-skills`。
