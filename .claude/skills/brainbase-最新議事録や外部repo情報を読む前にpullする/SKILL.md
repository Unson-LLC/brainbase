---
name: brainbase-最新議事録や外部repo情報を読む前にpullする
description: 最新議事録や外部repo情報を読む前にpullする
---

# brainbase-最新議事録や外部repo情報を読む前にpullする

## Trigger
- Use when this pattern appears: 最新議事録や外部repo情報を読む前にpullする

## Steps
- cd <対象repo>
- git status --short
- git pull --ff-only
- rg '<会議名|日付|参加者名|キーワード>' meetings docs .

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- decisions/最新議事録や外部repo情報を読む前にpullする

## Source
- Promoted from explicit_learn / success