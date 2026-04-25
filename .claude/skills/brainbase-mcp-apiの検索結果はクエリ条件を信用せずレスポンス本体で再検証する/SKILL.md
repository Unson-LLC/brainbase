---
name: brainbase-mcp-apiの検索結果はクエリ条件を信用せずレスポンス本体で再検証する
description: MCP/APIの検索結果はクエリ条件を信用せずレスポンス本体で再検証する
---

# brainbase-mcp-apiの検索結果はクエリ条件を信用せずレスポンス本体で再検証する

## Trigger
- Use when this pattern appears: MCP/APIの検索結果はクエリ条件を信用せずレスポンス本体で再検証する

## Steps
- freee invoice検索後の確認例:
- query.partner_id と invoice.partner_id が一致するか
- partner_name が想定取引先か
- payment_date が対象月末か
- payment_status が unsettled か
- cancel_status が uncanceled か
- 一致しない行は集計から除外する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- specs/mcp-apiの検索結果はクエリ条件を信用せずレスポンス本体で再検証する

## Source
- Promoted from explicit_learn / success