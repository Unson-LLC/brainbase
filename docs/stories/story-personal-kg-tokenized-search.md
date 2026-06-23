---
story_id: story-personal-kg-tokenized-search
title: Personal KG search supports compound keyword queries
reason: Existing Personal KG search treated the whole query as a single body substring, causing false not-found results for useful compound prompts such as AI駆動経営 判断 Ship.
related_specs:
  - docs/specs/story-personal-kg-tokenized-search-spec.md
architecture_docs:
  - docs/architecture/personal-kg-tokenized-search-architecture.md
status: active
---

# Personal KG Search Supports Compound Keyword Queries

## Background

`search_personal_kg` is the owner-visible retrieval surface for 佐藤圭吾's cognitive memory. It is used when an agent needs judgment axes, values, SNS philosophy, or decision principles beyond the session preamble.

Before this Story, the backing API searched `memory_candidates.body` with one continuous `ILIKE '%query%'` phrase. That worked for exact fragments such as `Persona Brain / Peer Circle / Own Proof`, but failed for equivalent compound prompts without the same punctuation, such as `Persona Brain Peer Circle Own Proof` or `AI駆動経営 判断 Ship`.

Those failures are not evidence that Personal KG lacks the memory. They are retrieval-shape failures.

## Goal

Keep existing exact phrase behavior, and add a deterministic tokenized fallback so one Personal KG query can find entries containing all query terms even when punctuation or spacing differs.

## Non-Goals

- Do not add semantic/vector search.
- Do not change Personal KG visibility, owner filtering, redaction filtering, or promotion status filtering.
- Do not mutate `memory_candidates`.
- Do not broaden results with token OR matching.

## Acceptance Criteria

- [ ] Exact phrase search remains supported and ranks before fallback matches.
- [ ] Compound queries are tokenized and can match entries that contain all tokens with different separators.
- [ ] Single-term queries do not add unnecessary token fallback SQL.
- [ ] `cognitive_type` filtering and bounded `limit` behavior remain intact.
- [ ] Owner-only, non-redacted, non-rejected filters remain intact.
- [ ] Direct `GET /api/learning/memory-candidates/search` callers keep the same `{ candidates }` response contract while benefiting from the fallback.
