---
name: brainbase-日次ブリーフィングでは古い期限を機械的に最優先にしない
description: 日次ブリーフィングでは古い期限を機械的に最優先にしない
---

# brainbase-日次ブリーフィングでは古い期限を機械的に最優先にしない

## Trigger
- Use when this pattern appears: 日次ブリーフィングでは古い期限を機械的に最優先にしない

## Steps
- 1. 今日の日付と各タスクの deadline/status/priority を確認する
- 2. 進行中・外部待ち・近日イベント連動を最優先候補にする
- 3. 長期期限超過タスクは TOP3 に入れる場合でも、推奨アクションは「現状確認・継続判断・期限再設定」にする
- 4. TOP3 と時間帯別アクションの順序が矛盾していないか最後に確認する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- decisions/日次ブリーフィングでは古い期限を機械的に最優先にしない

## Source
- Promoted from explicit_learn / success