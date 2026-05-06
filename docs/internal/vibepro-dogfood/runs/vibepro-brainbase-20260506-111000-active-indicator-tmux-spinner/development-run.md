# VibePro Autonomous Development Run: Active Indicator tmux Spinner Fallback

## Request

`ソート順もちゃんと反映されてる？あなたのセッションが並び順が変わらないままだよ。`

## Interpreted Goal

アクティブインジケータの青状態が status API に反映され、青状態セッションがソートで上位に来ることを、実 API と実ブラウザで確認できる状態にする。

## Findings

- Sort logic itself was already available, but the current Codex session was not present as `isWorking: true` in `/api/sessions/status`.
- The session's tmux pane title did show a spinner.
- Existing Codex PTY shim sessions may keep old in-memory code and therefore never report activity through the newer hook bridge.
- The server process read tmux pane title output under a non-UTF-8 locale, so spinner glyphs were degraded to underscores and did not match the spinner detector.

## Implementation

- jj change: `xzqoolmspnqrnxluxontrwrvmntmmyou`
- commit: `e94cd44c5a7f`
- merge commit: `82155e5b487ebb289b96c8be122781e3aefaffbc`
- PR: `https://github.com/Unson-LLC/brainbase-unson/pull/572`
- description: `fix: surface tmux spinner sessions as active`

Changed files:

- `server/services/session-core/activity-service-methods.js`
- `tests/server/session-manager.test.js`

Behavior fixed:

- `getSessionStatus()` now supplements hook status with tmux pane title spinner status.
- tmux is resolved through environment and common install path candidates.
- tmux title reads force UTF-8 locale to preserve spinner glyphs.
- The fallback status emits `lastEventType: tmux-pane-title-spinner` and `activeTurnCount: 1`, so the existing working-first sort path applies.

## Verification

Passed:

- `npm -s exec vitest run tests/server/session-manager.test.js tests/ui/views/session-view.test.js tests/unit/session-indicators.test.js tests/unit/session-ui-state.test.js tests/unit/session-activity-state.test.js`
- `npx eslint server/services/session-core/activity-service-methods.js tests/server/session-manager.test.js public/modules/ui/views/session-view.js tests/ui/views/session-view.test.js`
- Live API: `session-1777507759917` returned `isWorking: true`, `lastEventType: tmux-pane-title-spinner`, `activeTurnCount: 1`.
- Playwright against `http://localhost:31013`: `アクティブインジケーター` appeared at index 0 with `session-activity-indicator working`.
- GitHub check: `Verify VibePro Graph SSOT` passed on PR #572.

## VibePro Judgment

`partial_go`.

The implementation, targeted verification, live API check, browser check, and PR merge are closed. As VibePro control-plane evidence, this run still has residual risk because `vibepro pr prepare` was not available on PATH and NocoDB Story backfill was not verified.

## Residual Risks

- VibePro CLI `pr prepare` is not connected to this worktree's standard command path.
- NocoDB Story update with PR URL / cause / fix / verification result was not verified in this run.

## Next Actions

- Connect VibePro CLI through a stable npm script or PATH entry.
- Include NocoDB Story update evidence in the next VibePro run.
- For future active indicator regressions, start from status API, then tmux title, then UI sort.
