---
name: brainbase-環境変数確認でnocodbのトークンや管理者パスワードをそのまま出力していた
description: 環境変数確認でNocoDBのトークンや管理者パスワードをそのまま出力していた
---

# brainbase-環境変数確認でnocodbのトークンや管理者パスワードをそのまま出力していた

## Trigger
- Use when this pattern appears: 環境変数確認でNocoDBのトークンや管理者パスワードをそのまま出力していた

## Steps
- 悪い例: env | grep -i noco
- 良い例: env | awk -F= '/NOCODB|NOCO/ {print $1"=<redacted>"}'
- 設定JSON確認時も secret/token/password を含むキーは <redacted> に置換してから表示する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/環境変数確認でnocodbのトークンや管理者パスワードをそのまま出力していた

## Source
- Promoted from explicit_learn / success