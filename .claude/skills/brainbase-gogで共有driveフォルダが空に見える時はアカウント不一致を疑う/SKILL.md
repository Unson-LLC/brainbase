---
name: brainbase-gogで共有driveフォルダが空に見える時はアカウント不一致を疑う
description: gogで共有Driveフォルダが空に見える時はアカウント不一致を疑う
---

# brainbase-gogで共有driveフォルダが空に見える時はアカウント不一致を疑う

## Trigger
- Use when this pattern appears: gogで共有Driveフォルダが空に見える時はアカウント不一致を疑う

## Steps
- gog auth list
- # folder IDをURLから取り出す
- gog drive ls --parent <folderId> --account <候補メール> --json
- # 見えたアカウントでPDF等を取得
- gog drive download <fileId> --account <email> --out /tmp/file.pdf

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/gogで共有driveフォルダが空に見える時はアカウント不一致を疑う

## Source
- Promoted from explicit_learn / success