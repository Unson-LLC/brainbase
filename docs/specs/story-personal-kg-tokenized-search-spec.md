---
spec_id: SPEC-personal-kg-tokenized-search
story_id: story-personal-kg-tokenized-search
---

# SPEC-personal-kg-tokenized-search

## Invariants

- INV-001: Personal KG search remains read-only and must not mutate `memory_candidates`.
- INV-002: Search scope remains `owner_person_id`, `visibility='owner'`, `redaction_status='none'`, and `promotion_status <> 'rejected'`.
- INV-003: Exact phrase matches must remain valid and rank before token fallback matches.

## Contracts

- C-001: `searchPersonalKgCandidates({ query })` first accepts the query as an exact body phrase.
- C-002: When the query has multiple normalized tokens, the SQL also accepts rows where `body` contains every token.
- C-003: Token fallback is all-token matching, not any-token matching.
- C-004: `cognitiveTypes` and `limit` must continue to bind after the generated token parameters without placeholder drift.
- C-005: `GET /api/learning/memory-candidates/search?q=...&cognitive_type=...&limit=...` keeps the existing response shape `{ candidates: [...] }` and forwards the raw query to Personal KG search.

## Scenarios

- S-001: Query `AI駆動経営 判断 Ship` can match a body containing `AI駆動経営`, `判断`, and `Ship` even when that exact space-joined phrase does not appear.
- S-002: Single-token query `判断` remains a normal phrase search without token fallback expansion.
- S-003: The direct learning API route accepts a compound Personal KG query and preserves `cognitive_type` and `limit` request parameters.

## Verification

- `npm run test:run -- tests/server/services/learning-service.test.js`
- `npm run test:run -- tests/server/routes/learning.test.js`
- `BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts`
