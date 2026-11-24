# Judgment event outbox conditional `candidate_id: null` for `episode` events — unreleased (breaking)

Unreleased; publish needs separate approval. The latest release tag is `v0.50.29`,
which still types `JudgmentOutboxPostAck['candidate_id']` and
`JudgmentOutboxReadback['candidate_id']` as `string`. The release that first ships
this change must call it out as a breaking change and choose its version accordingly.

This change implements RFC-002 v0.3 Layer C PR-3b (Item 52) on `develop`, paired
with `brainbase-organization` PR-3a (`#1584`).

## Changed public surface

| Kind | Name | Note |
|---|---|---|
| type | `JudgmentOutboxPostAck['candidate_id']` from `@unson/brainbase-mcp/judgment-event-outbox` | Widened from `string` to `string \| null`. Also adds optional `candidate_created?: boolean` and `target_tier?: string` aligned with `POST /events` responses when raw `episode` events skip `memory_candidates` creation. |
| type | `JudgmentOutboxReadback['candidate_id']` from `@unson/brainbase-mcp/judgment-event-outbox` | Widened from `string` to `string \| null`. Also adds optional `candidate_created?: boolean` and `target_tier?: string` aligned with `GET /cycles/:eventId` (`knowledge_cycle_receipt.v1`) readback responses. |
| function | `deliverJudgmentKnowledgeEventOutbox` from `@unson/brainbase-mcp/judgment-event-outbox` | Conditionally accepts `candidate_id: null` on `post`, `readback`, and `confirmedReceipt` recovery **only** when `event.subject.type === 'episode'`, both `post.candidate_id` and `readback.candidate_id` are `null`, and any explicit `candidate_created` / `target_tier` flags are consistent (`false` / `'episode'`). Non-`episode` subjects (such as `decision`, `distilled_candidate`, `judgment_episode`) continue to require identical non-empty string `candidate_id` values and fail closed with `knowledge_event_delivery_ack_identity_mismatch` or `knowledge_event_readback_identity_or_state_mismatch`. |

### Why this is a breaking TypeScript change

TypeScript consumers that assign `post.candidate_id` or `readback.candidate_id`
to a non-nullable `string` without narrowing will no longer compile under
`--strict`:

```ts
import type { JudgmentOutboxPostAck } from '@unson/brainbase-mcp/judgment-event-outbox';
declare const ack: JudgmentOutboxPostAck;
const id: string = ack.candidate_id; // TS2322: Type 'string | null' is not assignable to type 'string'
```

Similarly, custom `JudgmentOutboxDeliveryPort['readback']` implementations that
annotate `post: { candidate_id: string }` must widen that parameter to
`string | null` (or narrow before passing to a non-null API). Keeping
`candidate_id: string` would force unsafe casts or lie about the runtime value
returned for raw `episode` events under RFC-002 PR-3.

### Additive public surface

- `@unson/brainbase-mcp/judgment-event-outbox`:
  - `JudgmentOutboxCandidateIdCheckInput` interface
  - `isValidJudgmentOutboxCandidateIdPair(input)` guard function
  - Optional `candidate_created?: boolean` and `target_tier?: string` properties on `JudgmentOutboxPostAck` and `JudgmentOutboxReadback`.

## Runtime compatibility

- Unconditional `candidate_id: null` is forbidden. Any `event.subject.type !== 'episode'`
  (including `decision`, `distilled_candidate`, and `judgment_episode`) still
  requires a non-empty string `candidate_id` on `post`, `readback`, and receipt
  recovery, even if `candidate_created: false` or `target_tier: 'episode'` is
  injected into the response.
- Transitional compatibility for `subject.type === 'episode'` is preserved: when
  both `post.candidate_id` and `readback.candidate_id` carry the same non-empty
  string (for example against a server not yet upgraded to PR-3a), delivery still
  confirms cleanly.
- Half-null mismatches (`null` vs non-empty string in either direction) and
  contradictory flags (`candidate_id: null` with `candidate_created: true` or
  `target_tier !== 'episode'`) fail closed.

## Consumers

- In-repository consumers (`src/judgment-event-outbox.ts`, `tests/judgment-event-outbox.test.ts`,
  `tests/judgment-host.test.ts`, tarball consumer smoke `scripts/judgment-harness-consumer-smoke.mjs`,
  and all Vitest suites) compile and pass with `candidate_id: string | null`.
- External downstream consumers (`brainbase-organization`, `brainbase-unson`)
  that pin an older published release are unaffected until upgraded; verify their
  TypeScript usage of `JudgmentOutboxPostAck` and `JudgmentOutboxReadback` at the
  version bump.

## Migration

1. Update TypeScript signatures consuming `JudgmentOutboxPostAck['candidate_id']`
   or `JudgmentOutboxReadback['candidate_id']` (including custom
   `JudgmentOutboxDeliveryPort.readback` callbacks) from `string` to
   `string | null`.
2. When building `POST /events` and `GET /cycles/:eventId` adapters for PR-3a
   (`#1584`), preserve `candidate_id: null` (do not coerce to `''`) and forward
   `candidate_created` / `target_tier` when returned by the API.
3. For callers that require a candidate ID, narrow with
   `if (ack.candidate_id !== null)` or use `isValidJudgmentOutboxCandidateIdPair`.

No npm publication, version bump or deployment is included.
