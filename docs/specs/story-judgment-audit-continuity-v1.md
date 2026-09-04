---
spec_id: SPEC-story-judgment-audit-continuity-v1
title: Judgment Audit Continuity Specification
status: final
date: 2026-08-28
story_id: story-judgment-audit-continuity-v1
implementation_files:
  - scripts/codex-hooks/judgment-resolver-host.mjs
test_files:
  - tests/unit/judgment-resolver-host.test.js
  - tests/integration/judgment-resolver-host-entrypoint.test.js
---

# SPEC: Judgment Audit Continuity

## マルチテナント適用性

対象は単一利用者のローカルCLI Host adapterであり、session/turn digest以外のtenant、顧客、組織別データ・認証情報・共有資源を扱わない。よってマルチテナント契約は適用対象外とする。

## Invariants

- **INV-1**: episode existence is read only after acquiring the identity-scoped transition lock for event recording and Stop finalization.
- **INV-2**: a missing episode is never converted into a complete judgment episode or fabricated initial route receipt.
- **INV-3**: an orphan turn gets at most one answer regeneration request; the active retry terminates with process success and an immutable `audit_degraded` receipt that rejects a late Start for the same identity.
- **INV-4**: `audit_degraded` is not a complete final, task completion proof, prior finalized judgment, retrieval success, or action authorization.
- **INV-5**: missing identity, missing `tool_use_id` on a Brainbase PostToolUse, and integrity conflicts remain terminal failures; a late UserPromptSubmit Start fails closed through `blockedOutput.continue: false` with process exit 0 as required by that Hook protocol, while Brainbase PostToolUse and Stop conflicts remain process-nonzero. Runtime 2.3 additionally records bound non-Brainbase tool calls as non-visible completion evidence without turning them into Brainbase audit claims.
- **INV-6**: normal episode repair, owner audit prefix, answer body binding, required capability, and exactly-one final contracts remain unchanged.

## Contracts

- **C-1**: `recordBrainbaseToolUse` records bound non-Brainbase tools as digest-only execution evidence and Brainbase PostToolUse as journal-bound audit evidence. Brainbase events retain strict identity/tool metadata validation; incomplete generic events are ignored because they cannot satisfy a bound episode contract. The audit becomes owner-visible evidence only when Stop verifies it in the final assistant answer.
- **C-2**: `finalizeEpisode` validates identity, derives paths, acquires the transition lock, then reads and finalizes the episode.
- **C-3**: first orphan Stop writes one diagnostic and returns `decision:block` with an exact warning line and answer-body preservation instruction; it does not create `.final.json`.
- **C-4**: active orphan Stop writes one degraded receipt and returns a non-blocking output with exit 0; it does not instruct the user to create a new task. A later Start for the same identity creates no episode and returns `blockedOutput.continue: false` with process exit 0; this semantic terminal result is neither audit success nor `audit_degraded`.
- **C-5**: diagnostic, degraded receipt, and orphan tool marker contain only digests, counts, canonical ISO timestamps, reason, and display/body verification booleans; an orphan PostToolUse also returns a visible warning without consuming Stop repair state.
- **C-6**: replay validates the exact artifact schema, digests, booleans, and canonical ISO timestamps; identical evidence is idempotent and any mismatch conflicts loudly.
- **C-7**: `priorReceipts` considers only existing accepted/complete schemas and therefore excludes degraded receipts.
- **C-8**: the default transition wait covers the bounded initial Resolver retry budget; an explicit shorter operator override remains a visible terminal timeout.
- **C-9**: local PR readiness requires separate-session VibePro review evidence that independently verifies both the absence of complete-audit masquerading and the absence of action-authorization expansion; passing tests alone is insufficient.

## Scenarios

- **S-1**: delayed UserPromptSubmit holds the transition lock while Stop starts; Stop waits and continues against the committed episode instead of returning `not_found`.
- **S-2**: delayed UserPromptSubmit holds the transition lock while qualifying PostToolUse starts; event recording waits and persists exactly one event after commit.
- **S-3**: an automatic Goal-like turn without UserPromptSubmit reaches first Stop; Host requests one warning-prefix repair and stores a diagnostic without a final.
- **S-4**: the same turn reaches active Stop; Host exits 0, stores `audit_degraded`, never emits a new-task instruction, and rejects a later Start without creating an episode.
- **S-5**: warning/body verification failure is stored as false but does not trigger a third generation.
- **S-6**: a Brainbase PostToolUse missing identity or `tool_use_id` remains a visible terminal failure and creates no artifact bound to an ambiguous target, while a fully bound unrelated tool becomes non-visible execution evidence and an incomplete unrelated tool remains ignored.
- **S-7**: a Resolver response delayed beyond the former three-second wait still lets concurrent PostToolUse/Stop continue after the start commit.
- **S-8**: an orphan Brainbase PostToolUse leaves a digest-only marker and visible warning, then the first Stop still receives its one repair request. A late Start after that marker returns process exit 0 with `blockedOutput.continue: false` and `judgment_orphan_tool_event_start_conflict`; it creates no episode because the digest-only marker cannot reconstruct a complete audited event.

## Acceptance traceability

- Story AC 1–2: C-1/C-2 and S-1/S-2 integration tests.
- Story AC 3–6: C-3/C-4/C-6 and S-3/S-5 process integration tests.
- Story AC 7: C-1/C-6 and S-6 terminal metadata/integrity tests.
- Story AC 8: C-5/C-6 and S-3 digest-only diagnostic and timestamp-integrity tests.
- Story AC 9: C-1/C-5/C-6 and S-8 orphan PostToolUse marker tests.
- Story AC 10: INV-6 normal episode regression tests.
- Story AC 11: INV-1/INV-3/INV-4/INV-5 and S-1/S-2/S-3/S-4/S-6 targeted unit/integration and full related Gate evidence.
- Story AC 12: INV-2/INV-4 and C-9 independent VibePro stage reviews for success masquerading and authority expansion.

## Anti-patterns

- **AP-1**: lock取得前のepisode存在確認で処理を打ち切る。
- **AP-2**: orphan turnへ過去のrouteを無条件継承する。
- **AP-3**: degraded receiptを`.final.json`へ保存する。
- **AP-4**: Hook exit 0を監査成功と表示する。
