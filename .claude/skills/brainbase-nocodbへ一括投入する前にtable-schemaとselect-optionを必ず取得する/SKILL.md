---
name: brainbase-nocodbへ一括投入する前にtable-schemaとselect-optionを必ず取得する
description: NocoDBへ一括投入する前にtable schemaとselect optionを必ず取得する
---

# brainbase-nocodbへ一括投入する前にtable-schemaとselect-optionを必ず取得する

## Trigger
- Use when this pattern appears: NocoDBへ一括投入する前にtable schemaとselect optionを必ず取得する

## Steps
- 1. table idごとにfields/columns metadataを取得
- 2. API bodyは実カラム名に合わせる（例: Brainbaseは`タイトル`,`担当者`,`ステータス`など日本語column_name）
- 3. select値は有効optionへマッピング（例: `川合秀明`→`川合`）
- 4. まず1件POSTして200/201と返却Idを確認
- 5. 成功後にbulk投入し、最後に代表レコードをGETして検証

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- specs/nocodbへ一括投入する前にtable-schemaとselect-optionを必ず取得する

## Source
- Promoted from explicit_learn / success