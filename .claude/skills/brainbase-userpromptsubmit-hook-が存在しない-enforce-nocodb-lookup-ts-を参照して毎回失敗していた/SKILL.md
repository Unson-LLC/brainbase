---
name: brainbase-userprompt-hook-missing-script
description: UserPromptSubmit hook が存在しない enforce-nocodb-lookup.ts を参照して毎回失敗していた
---

# brainbase-userpromptsubmit-hook-が存在しない-enforce-nocodb-lookup-ts-を参照して毎回失敗していた

## Trigger
- Use when this pattern appears: UserPromptSubmit hook が存在しない enforce-nocodb-lookup.ts を参照して毎回失敗していた

## Steps
- 1. hookエラー確認: rg 'enforce-nocodb-lookup' .claude ~/.claude
- 2. 参照先確認: test -f .claude/scripts/hooks/enforce-nocodb-lookup.ts
- 3. ファイルがない場合は、hook参照を削除するかスクリプトを正本側に追加してSessionStart配布対象に含める
- 4. 修正後に新規セッションまたは該当hook実行で ERR_MODULE_NOT_FOUND が消えたことを確認する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- spikes/userpromptsubmit-hook-が存在しない-enforce-nocodb-lookup-ts-を参照して毎回失敗していた

## Source
- Promoted from explicit_learn / success