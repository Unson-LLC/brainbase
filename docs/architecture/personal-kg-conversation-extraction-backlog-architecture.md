# Personal KG Conversation Extraction Backlog Architecture

Story: `story-personal-kg-extraction-backlog`
Date: 2026-06-04

## Decision

ADR is not required for this story. The change stays inside the existing Personal KG and local SSOT inventory boundaries:

- Conversation logs remain secondary material.
- `memory_candidates` remains the Personal KG source of truth.
- The existing deterministic extractor remains the candidate authoring contract.
- The new backlog CLI is a planner/read-only comparator unless the existing extractor write path is invoked separately.

## Boundary

The planner reads local Codex/Claude Code logs and optionally reads server-side `memory_candidates`. It does not mutate Graph, Wiki, NocoDB, or any HTTP API route. It does not introduce a new datastore, public API, UI, or runtime process.

## Data Flow

1. Local conversation logs are grouped by JST date.
2. Existing extraction rules produce deterministic candidate source refs.
3. Optional server comparison reads existing `memory_candidates` source refs.
4. The backlog reports counts and rule identifiers only.

Raw user text and candidate body text are intentionally excluded from backlog output.

## Verification Boundary

Unit tests cover grouping, server-ref comparison, raw-text omission, and non-regression of `needs_extraction` skip behavior. A Playwright CLI contract test covers the Story-level E2E gate without requiring a browser route because this story has no UI surface.
