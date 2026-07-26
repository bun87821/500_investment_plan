# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues on `bun87821/500_investment_plan`.

Use the `gh` CLI for all operations when it is available. In Claude Code web/remote sessions where `gh` is not installed, use the GitHub MCP tools (`mcp__github__*`) instead — the conventions below map 1:1 (`gh issue create` → `issue_write`, `gh issue view` → `issue_read`, etc.).

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

Issue titles and bodies may be written in Traditional Chinese (the project's working language) — keep domain terms consistent with `CONTEXT.md`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments` (or `issue_read` via the GitHub MCP tools).
