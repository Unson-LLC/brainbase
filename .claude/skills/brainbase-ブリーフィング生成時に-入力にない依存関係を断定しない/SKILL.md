---
name: brainbase-ブリーフィング生成時に-入力にない依存関係を断定しない
description: ブリーフィング生成時に、入力にない依存関係を断定しない
---

# brainbase-ブリーフィング生成時に-入力にない依存関係を断定しない

## Trigger
- Use when this pattern appears: ブリーフィング生成時に、入力にない依存関係を断定しない

## Steps
- 1. タスク名・期限・ステータス・優先度から確実に言えることだけを本文に書く
- 2. 依存関係を推測した場合は「依存している可能性があるため確認」と表現する
- 3. 推奨アクションには「依存関係の確認」を入れてもよいが、「完了していないと成立しない」と断定しない

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/ブリーフィング生成時に-入力にない依存関係を断定しない

## Source
- Promoted from explicit_learn / success