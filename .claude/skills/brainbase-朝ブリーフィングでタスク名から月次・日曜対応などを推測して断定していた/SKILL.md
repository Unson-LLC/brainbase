---
name: brainbase-朝ブリーフィングでタスク名から月次・日曜対応などを推測して断定していた
description: 朝ブリーフィングでタスク名から月次・日曜対応などを推測して断定していた
---

# brainbase-朝ブリーフィングでタスク名から月次・日曜対応などを推測して断定していた

## Trigger
- Use when this pattern appears: 朝ブリーフィングでタスク名から月次・日曜対応などを推測して断定していた

## Steps
- 1. deadline があるタスクは期限超過/残日数で優先度付けする
- 2. deadline がないタスクは、業務名から周期を推測せず「期限未設定」と表記する
- 3. 推奨アクションは入力情報から確実に言える範囲に限定する
- 4. 例: 「Jibble→請求書→GMOは一連の月次フロー」ではなく「関連しそうなBackOffice作業としてまとめて確認」

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/朝ブリーフィングでタスク名から月次・日曜対応などを推測して断定していた

## Source
- Promoted from explicit_learn / success