---
name: nocodb-salestailor
description: SalesTailor の NocoDB 専用操作ガイド。Slack・議事録・調査内容をもとに SalesTailor のインシデント、バグ、タスク、要件、ストーリー等を登録・更新するときに使う。
---

# NocoDB SalesTailor

This is a Codex bridge for the Claude skill stored at:

`/Users/ksato/.claude/skills/nocodb-salestailor/SKILL.md`

## Workflow

When this skill triggers, read the Claude skill above first and follow it as the source of truth.

Use it for SalesTailor NocoDB work, including:

- Incident table updates (`インシデント`)
- Bug table updates (`バグ`)
- Task/action item registration (`タスク`)
- Requirement/backlog updates (`課題`, `要件`)
- Story updates (`ストーリー`)

## Guardrails

- Before writing to NocoDB, confirm the actual table schema and select options.
- Do not overwrite SingleSelect/MultiSelect options programmatically.
- Do not print NocoDB tokens or administrator passwords.
- For SalesTailor `バグ` and `インシデント`, record the originating Slack thread in the dedicated `発端SlackスレッドURL` column when the issue came from Slack. Do not leave the only Slack evidence buried in comments/timeline text.
- Include source evidence where possible, such as Slack channel/thread URLs, PR numbers, or meeting/minutes paths.
- For SalesTailor, use the table IDs and URL format defined in the Claude skill.
