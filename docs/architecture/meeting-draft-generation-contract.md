# Meeting draft generation port contract

UNS-367 prerequisite, opt-in and not wired to a host. Exported through the existing
`@unson/brainbase-mcp/meeting-automation-runtime` entry point as
`runMeetingDraftGeneration`. This is the common execution seam for the generation
stages; it does not claim that the organization application's drafts currently
execute the judgment DAG. The existing review-package runtime is unchanged.

The organization design remains
[the integration plan](https://github.com/Unson-LLC/brainbase-organization/blob/codex/uns-367-minutes-dag-design/docs/architecture/meeting-minutes-dag-integration-plan.md).

| Stage | Port and condition |
| --- | --- |
| `project_resolution_gate` | `authorize` verifies the current publish decision, selected destination, canonical project mapping and the person's current access. Only explicit `true` proceeds. |
| `project_scoped_graph_context` | `resolveContext` returns the selected tenant, organization and canonical project, a context digest and records. Missing context is an error; an explicitly verified empty result is allowed. |
| `mention_resolution` / `glossary_resolution` / `meeting_note_generation` | `generate` uses the pinned source and context. A host can reuse candidate-name extraction and its existing prompt. Stage-specific trace recording remains a host integration requirement. |
| Output verification | `validate` must verify shape, transcript quotations, context use and proper names. It returns the parsed draft only on success. |
| Personal draft storage | `saveIfCurrent` conditionally saves the verified result; `readback` proves the same input and draft fingerprints are durable. |

The caller must first claim the source in the person's storage and supply an
opaque token that identifies that exact claim attempt. The host continues to own
daily limits, lease recovery, bounded retries and idempotency. This function makes
no retry or fallback model call and creates no separate organization ledger.

Input identity includes owner, source version, transcript digest, draft, claim
token, tenant, organization, canonical project ID, project code and channel.
Canonical project IDs must be resolved explicitly; the runtime never treats a
project code as a canonical ID. Input fields are pinned before asynchronous work.
The result receipt fingerprints that input plus the context digest and the
validated draft independently.

`saveIfCurrent` is a host security boundary. In the same transaction as its write
it must recheck the publish decision, destination, latest source digest, current
access and claim token. A stale worker returns null, even if a newer worker saved
the same draft ID. A readback adapter must derive the draft fingerprint from the
stored draft body and retrieve the persisted input fingerprint; echoing the
request receipt is insufficient. A missing or different readback is a failure,
including when a write may already have committed. The host must reconcile that
outcome with the existing claim before another generation attempt.

This entry point does not publish, deliver, ingest organization candidates or
create tasks. A selected publish destination is permission to generate a personal
draft, not task approval. Those operations must use the published version and
their existing authorization, approval and idempotency boundaries.

Before host activation, remaining work is to implement the conditional PostgreSQL
save/readback adapters, connect the existing prompt and parsers, record stage
evidence, import a fixed compatible core version and choose this entry point once
per claim. PostgreSQL tests must cover stale workers, destination/source changes
and revoked access during generation. No test of the common function alone proves
those database or authorization properties. Published-version candidate and task
integration, staging acceptance and production activation remain separate work.
