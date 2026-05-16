---
name: brainbase-構造化入力からダッシュボードを生成する時に-繰り返し項目の選択肢を途中から省略しない
description: 構造化入力からダッシュボードを生成する時に、繰り返し項目の選択肢を途中から省略しない
---

# brainbase-構造化入力からダッシュボードを生成する時に-繰り返し項目の選択肢を途中から省略しない

## Trigger
- Use when this pattern appears: 構造化入力からダッシュボードを生成する時に、繰り返し項目の選択肢を途中から省略しない

## Steps
- 1. 入力のDecision項目を件数確認する
- 2. 各項目について「タイトル」「状態」「選択肢」「推奨」を表形式または同一テンプレートで展開する
- 3. 文字数制限がある場合は説明文を削り、選択肢・推奨は削らない

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- decisions/構造化入力からダッシュボードを生成する時に-繰り返し項目の選択肢を途中から省略しない

## Source
- Promoted from explicit_learn / success