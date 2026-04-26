---
name: brainbase-brainbaseのセッション名検索はstate-jsonだけを正とせず-sqlite-stat
description: brainbaseのセッション名検索はstate.jsonだけを正とせず、SQLite state.dbも確認する
---

# brainbase-brainbaseのセッション名検索はstate-jsonだけを正とせず-sqlite-stat

## Trigger
- Use when this pattern appears: brainbaseのセッション名検索はstate.jsonだけを正とせず、SQLite state.dbも確認する

## Steps
- 1. まず state.json を検索する
- jq '.sessions[] | select(.name | contains("署名問題")) | {id,name,project}' /Users/ksato/workspace/shared/var/state.json
- 2. 見つからない場合は SQLite を確認する
- sqlite3 /Users/ksato/workspace/var/state.db "select id,name,project from sessions where name like '%署名問題%';"
- 3. 見つかったIDで復旧する
- export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 LC_CTYPE=en_US.UTF-8 && export BRAINBASE_SESSION_ID='session-...' && claude

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- stories/brainbaseのセッション名検索はstate-jsonだけを正とせず-sqlite-stat

## Source
- Promoted from explicit_learn / success