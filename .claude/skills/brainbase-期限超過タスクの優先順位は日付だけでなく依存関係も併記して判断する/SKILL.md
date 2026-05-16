---
name: brainbase-期限超過タスクの優先順位は日付だけでなく依存関係も併記して判断する
description: 期限超過タスクの優先順位は日付だけでなく依存関係も併記して判断する
---

# brainbase-期限超過タスクの優先順位は日付だけでなく依存関係も併記して判断する

## Trigger
- Use when this pattern appears: 期限超過タスクの優先順位は日付だけでなく依存関係も併記して判断する

## Steps
- 1. 各タスクの期限超過日数を計算する
- 2. タスク名から依存関係を推定する（方針→ラフ→テスト→制作・発注など）
- 3. TOP3の理由を「期限」と「依存・影響」の2軸で書く
- 例: ブランド方針は期限順位が2位でも、後続制作の起点として午前中の確認対象にする

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- decisions/期限超過タスクの優先順位は日付だけでなく依存関係も併記して判断する

## Source
- Promoted from explicit_learn / success