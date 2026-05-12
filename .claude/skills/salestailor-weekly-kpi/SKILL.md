---
name: salestailor-weekly-kpi
description: SalesTailor の CxO ミーティング用 KPI スプレッドシート（FYE0227KPI進捗管理）を更新するときに使う。#eng/#cxo、主要DM、salestailor-app のマージ済みPR、NocoDB バグ/ストーリーを確認し、CTO担当の行6・7・8を記入する。
---

# SalesTailor Weekly KPI

This is a Codex bridge for the Claude skill stored at:

`/Users/ksato/.claude/skills/salestailor-weekly-kpi/SKILL.md`

## Workflow

When this skill triggers, read the Claude skill above first and follow it as the source of truth.

The skill is for updating SalesTailor's CxO meeting KPI spreadsheet:

- Spreadsheet: `FYE0227KPI進捗管理`
- Account: `k.sato@sales-tailor.jp`
- Automatically handled rows: 6, 7, 8
- Main sources: Slack `#eng`, Slack `#cxo`, key DMs, merged PRs in `salestailor-app`, NocoDB bug/story tables

## Guardrails

- Do not use the generic `05_kpi.md` workflow for this task.
- Do not update KPI cells from NocoDB alone. Slack and merged PRs are required context.
- If Slack and NocoDB disagree, follow the source priority described in the Claude skill.
- Use `SLACK_BOT_TOKEN_SALESTAILOR`, not the Unson workspace token.
- Confirm the target month column before writing to the spreadsheet.
