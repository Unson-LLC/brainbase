# VibePro Autonomous Development Run: Active Indicator Stale Spinner Guard

## Request

`ではVibeProを使ってこれらを解消していって`

## Interpreted Goal

Graphify/VibeProレビューで見つかったアクティブインジケータの固定青リスクを、実装・テスト・実API/UI検証・run証跡で回収する。

## Findings

- Graphify は UI graph を抽出できたが、server status から UI sort への path は API boundary のため抽出できなかった。
- tmux spinner fallback は、明示 `done` hook status を working で上書きし得た。
- tmux pane title が止まったまま spinner glyph で残ると、古い session が青のまま残り得た。
- `/api/sessions/status` のたびに同期 `tmux list-panes` を実行していた。
- 実ログ上、`activeTurnCount: 0` の heartbeat が `done` 後に working を再表示し得る経路があった。

## Implementation

- commit: `89a94d12deacf29cda9daecfe06bfcff88edcf6c`
- merge commit: `197187360c535575811bd17e40d7f957ad695270`
- PR: `https://github.com/Unson-LLC/brainbase-unson/pull/579`
- description: `fix: guard tmux spinner activity fallback`

Changed files:

- `server/services/create-session-services.js`
- `server/services/session-core/activity-service-methods.js`
- `tests/server/session-manager.test.js`

Behavior fixed:

- tmux spinner fallback は hook status が存在しない session にだけ補完する。
- spinner title の `lastChangedAt` を保持し、30秒以上変化しない title は stale とする。
- `tmux list-panes` 結果を1秒 cache し、連続 polling の同期 tmux 実行を抑える。
- `done` 後の active turn なし heartbeat は working へ戻さない。
- Codex PTY fallback turn の stale pruning と turnId なし completion cleanup を強化した。

## Verification

Passed:

- `npm -s exec vitest run tests/server/session-manager.test.js tests/ui/views/session-view.test.js tests/unit/session-indicators.test.js tests/unit/session-ui-state.test.js tests/unit/session-activity-state.test.js`
- `npx eslint server/services/create-session-services.js server/services/session-core/activity-service-methods.js tests/server/session-manager.test.js public/modules/ui/views/session-view.js tests/ui/views/session-view.test.js`
- Graphify focused corpus: 54 nodes / 78 edges.
- Live API on canonical 31013: `session-1778025113158` returned `null` from `/api/sessions/status`.
- Playwright on canonical 31013: `アクティブインジケーター` row was index 0 with `session-activity-indicator working`; `補助金ブリッジ融資` row was idle.

Blocked:

- Worktree live server on 31014 could not start with session manager because `better-sqlite3` native module in the worktree is x86_64 while the running Node is arm64.
- Canonical 31013 cannot be held on unmerged local server patches because launchd sync restores server files from develop.

## VibePro Judgment

`go_with_residual_risk`.

The Graphify findings were converted into tests and implementation changes. Final canonical live reload needs to be repeated after merge, when launchd sync can pick up the merged develop code.

## Residual Risks

- Graphify still cannot prove the server-to-UI path because `/api/sessions/status` is an implicit contract boundary.
- Final live verification against canonical 31013 must be repeated after merge.

## Next Actions

- Merge the PR, then restart canonical 31013 and verify `/api/sessions/status` plus Playwright again.
- If this regresses again, add an explicit `/api/sessions/status` schema or integration test for the status-to-sort contract.
