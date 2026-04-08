---
name: brainbase-session-ui-state-changed-は-更新された-session-と-status-から消えた-session-の両方を必ず通知
description: SESSION UI STATE CHANGED は「更新された session」と「status から消えた session」の両方を必ず通知
---

# brainbase-session-ui-state-changed-は-更新された-session-と-status-から消えた-session-の両方を必ず通知

## Trigger
- Use when this pattern appears: SESSION UI STATE CHANGED は「更新された session」と「status から消えた session」の両方を必ず通知

## Steps
- [session-indicators.js](/Users/ksato/workspace/code/brainbase/public/modules/session-indicators.js)
- `sessionStatusMap` の二重管理を撤去
- hook status の正本を `sessionUi.byId[sessionId].hookStatus` に一本化
- `SESSION_UPDATED` で hook status を流す旧ルートを削除
- `SESSION_UI_STATE_CHANGED` は「更新された session」と「status から消えた session」の両方を必ず通知
- [session-ui-state.js](/Users/ksato/workspace/code/brainbase/public/modules/session-ui-state.js)
- `deriveSessionUiState()` に `goalSeek` を正式に含めた
- 差分検出用の `getSessionHookStatusMap()` を追加して、polling 側も store ベースに統一
- [session-view.js](/Users/ksato/workspace/code/brainbase/public/modules/ui/views/session-view.js)
- `getSessionStatus()` / `updateSessionIndicators()` 依存を削除
- 行描画、timeline ソート、sort timestamp の hook status 参照を全部 `deriveSessionUiState()` に統一
- [session-list-renderer.js](/Users/ksato/workspace/code/brainbase/public/modules/session-list-renderer.js)
- goal-seek 表示を `sessionUiState.goalSeek` に統一
- `thinking` は見た目を `working` と同じオレンジに統一
- [session-indicators.test.js](/Users/ksato/workspace/code/brainbase/tests/unit/session-indicators.test.js)
- [session-ui-state.test.js](/Users/ksato/workspace/code/brainbase/tests/unit/session-ui-state.test.js)
- [session-view.test.js](/Users/ksato/workspace/code/brainbase/tests/ui/session-view.test.js)
- `node --check` 通過
- `npm -s exec vitest run tests/unit/session-indicators.test.js tests/unit/session-ui-state.test.js tests/ui/session-view.test.js tests/ui/integration/app-switch-session-runtime.test.js`
- 24 tests passed

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/session-ui-state-changed-は-更新された-session-と-status-から消えた-session-の両方を必ず通知

## Source
- Promoted from codex_session_log / success