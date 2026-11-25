# Judgment knowledge event `project_code` widened from `'brainbase'` to `string` — integrated into `0.50.30`

> **Integrated**: This note was superseded by [`docs/releases/0.50.30.md`](./0.50.30.md) (published in `@unson/brainbase-mcp@0.50.30`). Kept for historical reference.

Unreleased; publish needs separate approval. The latest release tag is `v0.50.27`,
which still types `JudgmentKnowledgeEvent['applicability_scope']['project_code']`
as the literal `'brainbase'`. The release that first ships this change must call
it out as a breaking change and choose its version accordingly.

This change implements RFC-002 v0.3 Layer C PR-1 (#1070) on `develop`.

## Changed public surface

| Kind | Name | Note |
|---|---|---|
| type | `JudgmentKnowledgeEvent['applicability_scope']['project_code']` from `@unson/brainbase-mcp/judgment-event-adapter` | Widened from literal `'brainbase'` to `string`. Also widens the event shape returned by `toKnowledgeEventFromJudgmentEpisode` and referenced by `@unson/brainbase-mcp/judgment-event-outbox` (`JudgmentOutboxDeliveryPort`, `JudgmentQueuedEvent`, `enqueueJudgmentKnowledgeEvent`, `JudgmentKnowledgeEventSink`). |
| function | `toKnowledgeEventFromJudgmentEpisode` from `@unson/brainbase-mcp/judgment-event-adapter` | Propagates a validated `project_code` from the episode (`episode.project_code`, `applicability_scope.project_code`, `payload.project_code`, `adoption.request.project_code`, `adoption.receipt.project_code`) instead of hardcoding `'brainbase'`. Non-empty values that fail `JUDGMENT_EVENT_PROJECT_CODE_PATTERN` throw `Error('project_code is invalid')`. Omitted or blank values still fall back to `DEFAULT_JUDGMENT_EVENT_PROJECT_CODE` (`'brainbase'`) or `options.fallbackProjectCode`. |
| function | `deliverJudgmentKnowledgeEventOutbox` from `@unson/brainbase-mcp/judgment-event-outbox` | Extracts the effective `project_code` from `applicability_scope.project_code` before top-level `project_code` (matching downstream `requireProjectAccess`). When `options.allowedProjectCodes` is provided, events with missing, conflicting, invalid, or out-of-scope `project_code` are deferred (`deferred`, `out_of_scope`) without posting, consuming retry attempts, or dead-lettering. |

### Why this is a breaking TypeScript change

TypeScript consumers that assign `event.applicability_scope.project_code` to the
literal type `'brainbase'` will no longer compile under `--strict`:

```ts
import type { JudgmentKnowledgeEvent } from '@unson/brainbase-mcp/judgment-event-adapter';
declare const event: JudgmentKnowledgeEvent;
const projectCode: 'brainbase' = event.applicability_scope.project_code; // TS2322
```

Keeping `'brainbase'` as a default type parameter would still leave
`toKnowledgeEventFromJudgmentEpisode` returning `JudgmentKnowledgeEvent<string> | null`
(or unsafely lying about runtime values for non-`'brainbase'` projects), breaking
assignability to `JudgmentKnowledgeEvent` and outbox port signatures. Widening
`applicability_scope.project_code` to `string` keeps the public type honest and
aligned with multi-project runtime behavior.

### Additive public surface

- `@unson/brainbase-mcp/judgment-event-adapter`:
  `DEFAULT_JUDGMENT_EVENT_PROJECT_CODE`, `JUDGMENT_EVENT_PROJECT_CODE_PATTERN`,
  `JudgmentKnowledgeEventAdapterOptions`, `normalizeJudgmentEventProjectCode`,
  `isProjectCodeAllowed`, and optional `project_code` / `applicability_scope`
  fields on `JudgmentEpisode`.
- `@unson/brainbase-mcp/judgment-event-outbox`:
  optional `allowedProjectCodes` on `JudgmentOutboxDeliveryOptions` and optional
  `out_of_scope` counter on `JudgmentOutboxDeliveryResult`.

## Runtime compatibility

- Episodes that omit `project_code` (or leave it blank) continue to emit
  `applicability_scope.project_code: 'brainbase'`.
- Deterministic `event_id` derivation (`eventIdFor`) and outbox non-empty
  `candidate_id` verification on `post` ack, `readback`, and `confirmedReceipt`
  are unchanged.
- In `@unson/brainbase-mcp/judgment-host`, an explicit non-conforming
  `project_code` skips outbox enqueue cleanly instead of crashing `Stop` or
  misattributing the event to `'brainbase'`.

## Consumers

- In-repository consumers (`src/judgment-event-outbox.ts`, `src/judgment-host.ts`,
  tarball consumer smoke `scripts/judgment-harness-consumer-smoke.mjs`, and all
  Vitest suites) compile and pass with `project_code: string`.
- External downstream consumers (`brainbase-organization`, `brainbase-unson`)
  that pin an older published release are unaffected until upgraded; check their
  TypeScript usage of `JudgmentKnowledgeEvent` again at the version bump.

## Migration

1. Replace literal `'brainbase'` type annotations on
   `JudgmentKnowledgeEvent['applicability_scope']['project_code']` with `string`.
2. If a caller only accepts `'brainbase'` (or a fixed token allowlist), narrow at
   runtime with `event.applicability_scope.project_code === 'brainbase'` or
   `isProjectCodeAllowed(event.applicability_scope.project_code, allowedProjectCodes)`,
   or pass `allowedProjectCodes` to `toKnowledgeEventFromJudgmentEpisode` /
   `deliverJudgmentKnowledgeEventOutbox`.

No npm publication, version bump or deployment is included.
