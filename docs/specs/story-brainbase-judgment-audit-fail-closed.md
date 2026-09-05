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
- **INV-6**: repairableなowner監査不足は最初のStopで`decision:block`として1回だけ修復機会を与え、なお不完全なactive再Stopは明示終了する。
- **INV-7**: optional knowledgeかつevent 0件は、未参照だった事実をHost-owned監査行で明示する。

## Contracts

- **C-1**: readiness CLIは`--cwd`、`--codex-bin`、`--json`を受け取り、`status`、イベント別状態、`next_action`を返す。
- **C-2**: 4イベントが各1件、same command、enabled、expected matcher、`trusted|managed`ならexit 0と`ready_for_fresh_task`を返す。
- **C-3**: trust不成立ならexit nonzero、`trust_required`、`Open /hooks and approve the four current Resolver hooks.`を返す。
- **C-4**: identity/episodeなしStopはfirst Stopではvisible block、active Stopではstderrとnonzeroにする。
- **C-5**: active再Stopでrequired knowledgeまたはowner auditが不足する場合は`judgment_stop_repair_exhausted`で非zero終了し、final receiptを作らない。
- **C-6**: audit prefix比較は行末のspace/tabだけを無視し、本文・順序・回数を保存値へ一致させる。
- **C-7**: optional knowledgeかつevent 0件のrequired prefixは`📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓`を含む。
- **C-8**: orphan PostToolUse、complete Stop、complete replayの既存契約は維持する。

## Scenarios

- **S-1**: fake Codex app-serverが4件を`trusted`で返すとreadinessは`ready_for_fresh_task`になる。
- **S-2**: 1件でも`modified`なら`trust_required`になり、hashを書換しない。
- **S-3**: matcher不一致、duplicate、missing、app-server error/timeoutは明示的に失敗する。
- **S-4**: orphan Stopは`{}`/exit 0を返さない。
- **S-5**: first Stopの修復可能な不足は`decision:block`で継続し、なお不完全なactive再Stopは`judgment_stop_repair_exhausted`で有限終了する。どちらもcomplete finalを作らない。
- **S-6**: 監査行末にMarkdownの2-space改行が付いても表示上同一としてcompleteできる。
- **S-7**: optional knowledgeの0-call turnは0回表示を含む時だけcompleteできる。
- **S-8**: trust承認後の新規taskでepisode、final、transcript監査行が同一turnに揃った時だけlive E2Eが成功し、`proven_active`になる。

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
