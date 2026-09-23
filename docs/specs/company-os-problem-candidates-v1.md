# Company OS Problem Candidate v1

Story: `story-company-os-problem-candidates-v1`

This contract keeps an observed event as a reviewable problem candidate. It
does not select, approve, or execute a problem. Foundation definitions remain
in the canonical Graph; candidate records and event evidence are committed to
the evidence sidecar through the canonical SSOT transaction.

## Invariants

- A candidate references one or more exact `objective` revisions. The
  reference includes the foundation digest, but never copies the Objective
  definition into the candidate sidecar.
- The event occurrence time and record time are kept separately. A recorded
  event cannot claim to have been recorded before it occurred.
- `observedGap`, `opportunity`, `threat`, `uncertainty`, `deadline`,
  `expectedEffect`, `requiredResources`, and `responsibleId` are explicit
  `known` or `unknown` values. Missing values are never converted to zero,
  empty text, or success.
- A candidate is always `candidate`, `merged`, or `dismissed`. There is no
  `selected` or `approved` state in this store. Selection is the next Story.
- Event IDs are idempotency keys. The same event ID and canonical payload
  returns the existing candidate; the same event ID with a different payload
  fails with an identity conflict.
- Merge creates a new candidate and marks source candidates `merged`. Source
  records, source references, and event IDs remain in the sidecar so the
  original evidence path is recoverable.
- Evidence bodies and summaries are never accepted by this API. Only source
  IDs, kinds, and optional immutable digests are retained. This omission alone
  is not an evidence authorization boundary: a trusted
  `evidenceAccessProvider` must recheck current source visibility on save and
  read. The provider is also called for every root reached through
  `mergedFrom`, so a merge cannot expose a restricted source by publishing a
  broader candidate ACL or a copied statement.
- Candidate writes and reads require the candidate ACL, trusted current scope,
  and the evidence access provider. Objective references are rechecked against
  the current Graph aggregate and digest while the sidecar transaction lock is
  held. A missing provider or denied source fails closed.

## Public API

`src/problem-candidates.ts` exports `createProblemCandidateStore`,
`ProblemCandidateEvidenceAccessProvider`, and the following operations:

- `saveCandidate(input, context)` — create or idempotently re-read one
  candidate from an event.
- `mergeCandidates(input, context)` — create a new candidate from existing
  candidate IDs and mark those sources `merged` in one transaction.
- `readCandidate(id, context)` — return one candidate after current Objective
  ACL/digest and candidate ACL/scope checks.
- `listCandidates(query, context)` — return visible candidates filtered by
  owner scope, responsible person, and status. Unauthorized records are
  omitted rather than summarized.

The store uses `evidence/problem-candidates.json` and
`mutatePersonalOsWithSidecar`. No candidate or event is added to
`graph.json`. `createProblemCandidateStore` requires a trusted evidence access
provider; the provider receives each source reference, operation (`save` or
`read`), and principal and must resolve current visibility for that exact
reference/digest.

## Verification boundary

Pure contract tests cover explicit unknowns, timestamp/reference validation,
event identity conflicts, and prohibition of selection/approval states.
Real-store tests cover Objective revision persistence, sidecar-only records,
same-event retry, merge provenance, current-scope filtering, restricted ACL
readback, current source visibility checks, a broader-ACL merge denial, and
unchanged Graph aggregate structure.
