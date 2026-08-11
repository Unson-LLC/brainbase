---
spec_id: SPEC-story-brainbase-judgment-audit-fail-closed
title: Judgment Audit Fail-closed Specification
status: final
date: 2026-08-11
story_id: story-brainbase-judgment-audit-fail-closed
implementation_files:
  - scripts/check-codex-judgment-hook-readiness.mjs
  - scripts/codex-hooks/judgment-resolver-host.mjs
test_files:
  - tests/unit/codex-judgment-hook-readiness.test.js
  - tests/unit/judgment-resolver-host.test.js
  - tests/integration/judgment-resolver-host-entrypoint.test.js
  - tests/e2e/story-brainbase-judgment-resolver-v1-live-session.spec.ts
---

# SPEC: Judgment Audit Fail-closed

## Invariants

- **INV-1**: Hook definition、effective trust、fresh task activation、live turn evidenceを別状態として扱う。
- **INV-2**: Codex-owned `hooks/list`以外の手製hash比較でtrustを判定しない。
- **INV-3**: `modified`、`untrusted`、missing、status取得不能をreadiness成功にしない。
- **INV-4**: journal-backed episodeがないStopは回答完了を許可しない。
- **INV-5**: complete finalは同一event setと回答digestへexactly oneで束縛する。

## Contracts

- **C-1**: readiness CLIは`--cwd`、`--codex-bin`、`--json`を受け取り、`status`、イベント別状態、`next_action`を返す。
- **C-2**: 3イベントが各1件、same command、enabled、expected matcher、`trusted|managed`ならexit 0と`ready_for_fresh_task`を返す。
- **C-3**: trust不成立ならexit nonzero、`trust_required`、`Open /hooks and approve the three current Resolver hooks.`を返す。
- **C-4**: identity/episodeなしStopはfirst Stopではvisible block、active Stopではstderrとnonzeroにする。
- **C-5**: active再Stopでrequired knowledgeまたはowner auditが不足する場合、final receiptを作らない。
- **C-6**: orphan PostToolUse、complete Stop、complete replayの既存契約は維持する。

## Scenarios

- **S-1**: fake Codex app-serverが3件を`trusted`で返すとreadinessは`ready_for_fresh_task`になる。
- **S-2**: 1件でも`modified`なら`trust_required`になり、hashを書換しない。
- **S-3**: matcher不一致、duplicate、missing、app-server error/timeoutは明示的に失敗する。
- **S-4**: orphan Stopは`{}`/exit 0を返さない。
- **S-5**: first Stopの不足は1回継続し、active再Stopの不足はfinalなしで失敗する。
- **S-6**: trust承認後の新規taskでepisode、final、transcript監査行が同一turnに揃った時だけlive E2Eが成功し、`proven_active`になる。

## Acceptance traceability

- Story AC 1–3: readiness CLI unit testとrunbookで検証する。
- Story AC 4–6: Host unit/integration testで検証する。
- Story AC 7: publication consistency testで検証する。
- Story AC 8: exact npm VibePro verification evidenceとlive E2Eで検証する。

## Anti-patterns

- **AP-1**: trust recordの存在をcurrent trustと呼ぶ。
- **AP-2**: direct entrypoint testをDesktop activationと呼ぶ。
- **AP-3**: Brainbase側でCodexのtrust hashを生成・承認する。
- **AP-4**: episodeのない回答へ見かけだけの`🧠`行を追加する。
