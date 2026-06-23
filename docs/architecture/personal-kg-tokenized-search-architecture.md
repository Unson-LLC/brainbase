---
architecture_id: arch-personal-kg-tokenized-search
story_id: story-personal-kg-tokenized-search
title: Personal KG Tokenized Search Architecture
status: accepted
date: 2026-06-23
related_specs:
  - SPEC-personal-kg-tokenized-search
---

# Personal KG Tokenized Search Architecture

## Center Pin

Personal KG search remains a read-only owner-visible candidate-store lookup. The change improves recall for compound keyword prompts without changing the API route, response shape, ACL filters, or write behavior.

## Public Contract Boundary

The public route remains:

```text
GET /api/learning/memory-candidates/search?q=...&cognitive_type=...&limit=...
```

The route still returns:

```json
{ "candidates": [] }
```

Direct callers and the `search_personal_kg` MCP tool continue to send one raw query string. The server-side search path is responsible for adapting that query to the candidate-store SQL.

## Search Semantics

Search evaluates the raw query as an exact body phrase first. When the normalized query contains multiple tokens, search also accepts rows whose `body` contains every token, even if punctuation or spacing differs from the original query.

Exact phrase matches rank before token fallback matches. Token fallback is an all-token condition, not an any-token expansion.

## Preserved Filters

The search continues to require:

- `owner_person_id`
- `visibility = 'owner'`
- `redaction_status = 'none'`
- `promotion_status <> 'rejected'`
- non-empty `body`

`cognitive_type` and bounded `limit` behavior remain part of the same query path. The fallback must not bypass these filters or create a second source of truth.

## Non-Goals

- No semantic or vector search.
- No mutation of `memory_candidates`.
- No broad OR matching across tokens.
- No change to Personal KG owner identity or visibility policy.

## Verification

- `npm run test:run -- tests/server/services/learning-service.test.js`
- `npm run test:run -- tests/server/routes/learning.test.js`
- `BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts`
