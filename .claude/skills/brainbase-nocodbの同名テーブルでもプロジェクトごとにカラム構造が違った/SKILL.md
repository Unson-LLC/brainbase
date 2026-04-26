---
name: brainbase-nocodbの同名テーブルでもプロジェクトごとにカラム構造が違った
description: NocoDBの同名テーブルでもプロジェクトごとにカラム構造が違った
---

# brainbase-nocodbの同名テーブルでもプロジェクトごとにカラム構造が違った

## Trigger
- Use when this pattern appears: NocoDBの同名テーブルでもプロジェクトごとにカラム構造が違った

## Steps
- まず各テーブルのサンプルキーを確認:
- python3 - <<'PY'
- import json
- r = records[0]
- print(list(r.keys()))
- PY
- 例: title = タイトル or 要求 or ID
- 例: date = 会議日 or 作成日 or CreatedAt
- 例: id = Id or 番号 or ID

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/nocodbの同名テーブルでもプロジェクトごとにカラム構造が違った

## Source
- Promoted from explicit_learn / success