---
name: brainbase-会議メモは現在プロジェクト直下だけでなく関連顧客・別プロジェクト配下にあることがある
description: 会議メモは現在プロジェクト直下だけでなく関連顧客・別プロジェクト配下にあることがある
---

# brainbase-会議メモは現在プロジェクト直下だけでなく関連顧客・別プロジェクト配下にあることがある

## Trigger
- Use when this pattern appears: 会議メモは現在プロジェクト直下だけでなく関連顧客・別プロジェクト配下にあることがある

## Steps
- 1. まず想定場所を確認: ls meetings/minutes/ | grep '2026-05-01\|湘南\|中谷\|shonan'
- 2. 見つからなければ横断検索: grep -RIlE '湘南|中谷|Shonan|nakatani|セミナー講師' .
- 3. 見つかったminutesだけでなく transcript_ref の原文も確認する
- 4. プロジェクトIDと保存ディレクトリ名が違っても、本文の日時・相手・決定事項で同一案件か判定する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/会議メモは現在プロジェクト直下だけでなく関連顧客・別プロジェクト配下にあることがある

## Source
- Promoted from explicit_learn / success