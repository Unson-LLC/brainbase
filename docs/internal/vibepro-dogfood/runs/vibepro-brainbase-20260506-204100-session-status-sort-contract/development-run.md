# VibePro Autonomous Development Run: Session Status Sort Contract

## Request

`では次のVibeProから出た課題に進んで`

## Interpreted Goal

前回VibePro runの残リスクである `/api/sessions/status` から UI timeline sort までの暗黙契約を、明示的な integration-style UI test で固定する。

## Findings

- 前回 run では Graphify が server-to-UI path を API boundary のため抽出できなかった。
- client-side focused corpus では `pollSessionStatus()` から `_reorderTimelineRows()` への path を確認できた。
- path には inferred edge が残るため、実際の contract はテストで固定する必要がある。

## Implementation

- commit: `9af1aab1c5602136c6d64f8c6ed31b8af3e3df86`
- PR: `https://github.com/Unson-LLC/brainbase-unson/pull/581`
- description: `test: cover session status timeline sort contract`

Changed file:

- `tests/ui/views/session-view.test.js`

Behavior fixed:

- 実装挙動は変更していない。
- status polling -> `sessionUi` -> `SESSION_UI_STATE_CHANGED` -> `SessionView._reorderTimelineRows()` の既存契約をテストで固定した。

## Verification

Passed:

- `npm -s exec vitest run tests/ui/views/session-view.test.js tests/unit/session-indicators.test.js tests/unit/session-ui-state.test.js tests/unit/session-activity-state.test.js`
- `npx eslint tests/ui/views/session-view.test.js public/modules/session-indicators.js public/modules/session-ui-state.js public/modules/ui/views/session-view.js`
- Graphify focused corpus: 64 nodes / 117 edges.
- Graphify path: `pollSessionStatus()` -> `replaceSessionHookStatuses()` -> `session-ui-state.js` -> `deriveSessionUiState()` -> `_computeRowFingerprint()` -> `SessionView` -> `_reorderTimelineRows()`.

## VibePro Judgment

`go`.

The prior residual risk is now covered by an explicit integration-style UI test and Graphify path evidence.

## Residual Risks

- なし。

## Next Actions

- server side の `/api/sessions/status` schema を追加する場合は、今回の UI contract test と重複しない形で API response validator を設計する。
