---
name: brainbase-gm向け報告では入力にないリスク評価や状態判定を断定しない
description: GM向け報告では入力にないリスク評価や状態判定を断定しない
---

# brainbase-gm向け報告では入力にないリスク評価や状態判定を断定しない

## Trigger
- Use when this pattern appears: GM向け報告では入力にないリスク評価や状態判定を断定しない

## Steps
- 例: 入力に「介入推奨」「期限超過12件」がある → 「介入が必要な状態」は可
- 例: 入力に案件ロスの記載がない → 「案件ロスリスクが高い」と断定せず「案件状況の確認を優先」
- 例: statusが待機中・current_taskなし → 「順調」と断定せず「現在の停止要因なし」

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/gm向け報告では入力にないリスク評価や状態判定を断定しない

## Source
- Promoted from explicit_learn / success