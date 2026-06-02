# Spec: STR-011 _isXtermOnlyMode transport gate

Story: STR-011 / 受け入れ基準を検証可能な仕様句に落とす。

## 対象

- `server/services/session-runtime/runtime-query-methods.js` の `_isXtermOnlyMode()`
- `server/services/session-runtime/runtime-maintenance-methods.js` の `repairActiveTtydSessions`（xterm-only 早期 return）
- 既存テスト `tests/server/session-manager-env.test.js`（ttyd-spawn 検証のため transport を ttyd に pin）

## 契約 (Spec Clauses)

- SPEC-1 (ac:1): `BRAINBASE_TERMINAL_TRANSPORT === 'xterm'` のとき、`BRAINBASE_TEST_MODE` の値（'false' 含む）に関わらず `_isXtermOnlyMode()` は true を返す。
- SPEC-2 (ac:2): xterm-only 時、`repairActiveTtydSessions` は `{checked:0,restarted:0,failed:0,skipped:0}` を返し、`getRuntimeStatus`/`ensureTtydForActiveSession`（ttyd spawn 経路）を呼ばない。
- SPEC-3 (ac:3): `transport !== 'xterm'` のとき、`repairActiveTtydSessions` は active セッションを検査し（checked>0）、`startTtyd` は ttyd spawn 時の環境変数を設定する（既存挙動）。
- SPEC-4 (ac:4): 本 Story は VibePro dogfood として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる。

## 不変条件 (workflow scenario)

- During the PTY watchdog maintenance workflow the repair process runs each cycle and classifies active sessions; when the live transport is xterm the repair state must short-circuit so the recover flow does not spawn ttyd that times out and loops.
- 判定は transport を正本とし test mode をゲートに含めない。ttyd transport 構成の挙動は不変。

## 非目標

- session open/takeover の xterm-only 分岐の再設計、ttyd transport 挙動変更、永続レコードのクリーンアップは対象外。
- 既存の pre-existing テスト失敗の修正は対象外。
