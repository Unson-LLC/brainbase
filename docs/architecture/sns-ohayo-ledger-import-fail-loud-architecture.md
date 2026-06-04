---
story_id: str.brainbase.sns-ohayo-dedupe-generation
title: SNS ohayo ledger import fail-loud architecture
status: active
related_docs:
  - docs/architecture/ADR-011-sns-posting-ledger-boundary.md
  - docs/architecture/sns-posted-content-dedupe-architecture.md
  - docs/stories/sns-ohayo-dedupe-generation-story.md
  - docs/specs/sns-ohayo-dedupe-generation-spec.md
---

# Architecture: SNS ohayo ledger import fail-loud

## Decision

Keep duplicate suppression at the SNS Posting Ledger import boundary, and make the `/ohayo` import adapter fail loudly when the generated review pack cannot create any reviewable Ledger records.

The importer treats these states as operational failures:

- The review pack contains no posts.
- The Ledger API accepts the request but every draft is skipped, for example by `duplicate_body`.

In both cases the command exits non-zero and reports the skipped reasons and skipped item identifiers in its JSON summary.

## Rationale

`/ohayo` is allowed to generate candidates that later lose to deterministic dedupe, but it must not report a successful morning run when the operator has no new SNS candidates in Cockpit/Ledger. The Ledger remains the final deterministic duplicate gate; the importer is responsible for surfacing an all-skipped result as a failure that daily ops can notice.

This keeps the architecture from moving dedupe back into the generator. Generator-side variation and retry logic can be improved separately, but Ledger import remains the contract that decides whether reviewable operational records actually exist.

## Boundaries

- Review pack to Ledger adapter: `scripts/import-sns-review-pack-to-ledger.js`
- Unit contract: `tests/sns/ops/import-sns-review-pack-to-ledger.test.js`
- Daily ops CLI contract: `e2e/str-brainbase-sns-ohayo-dedupe-generation-cli.spec.ts`

## Non-Goals

- Do not bypass Ledger duplicate checks.
- Do not auto-publish or schedule SNS posts.
- Do not treat X search or generation failures as successful zero-candidate days.
