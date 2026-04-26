---
name: brainbase-nocodb-mcpが見つからない場合でもrest-apiでテーブル探索・レコード取得できた
description: NocoDB MCPが見つからない場合でもREST APIでテーブル探索・レコード取得できた
---

# brainbase-nocodb-mcpが見つからない場合でもrest-apiでテーブル探索・レコード取得できた

## Trigger
- Use when this pattern appears: NocoDB MCPが見つからない場合でもREST APIでテーブル探索・レコード取得できた

## Steps
- テーブル一覧:
- curl -s -H "xc-token: $NOCODB_TOKEN" "$NOCODB_URL/api/v1/db/meta/projects/$BASE_ID/tables" | jq '.list[] | {id,title}'
- レコード取得:
- curl -s -H "xc-token: $NOCODB_TOKEN" "$NOCODB_URL/api/v1/db/data/noco/$BASE_ID/$TABLE_ID?where=(ステータス,neq,解決済み)&limit=200"

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- specs/nocodb-mcpが見つからない場合でもrest-apiでテーブル探索・レコード取得できた

## Source
- Promoted from explicit_learn / success