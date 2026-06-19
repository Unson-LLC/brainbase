---
story_id: story-graph-entity-resolver
title: Graph entity resolver prevents false not-found results
reason: Existing Graph MCP entity resolver architecture is extended with an additive search fallback; no new storage boundary, runtime process, or external dependency is introduced.
source:
  type: conversation
  origin: user
  date: 2026-06-19
architecture_docs:
  - path: docs/architecture/graph-entity-resolver-architecture.md
    status: accepted
related_specs:
  - docs/specs/graph-entity-resolver-spec.md
status: active
---

# Graph entity resolver prevents false not-found results

## Background

Brainbase Graph SSOT is the primary source for canonical people, organizations, customers, projects, terms, decisions, stories, and RACI assignments. Agents must not treat local notes, meeting minutes, transcript fragments, or generated summaries as canonical when Graph has the relevant entity.

The current Graph MCP `search` behavior can produce false "not found" results when an agent sends a broad natural-language query as if Graph were a web search or semantic RAG index.

Observed failure:

```text
query: 若松 Lecaldo レカルド TechKnight 役員
project: brainbase
scope: graph
includePhilosophy: true
```

This returned `No results found`, while narrower Graph queries did find the relevant people:

- `若松` resolves to `per_wakamatsu_fuyumi` / 若松 冬美.
- `持田` resolves to `per_mochida_sho` / 持田 渉.

The failure is not proof that those people are absent from Graph. It is proof that the current compound query did not match the MCP search surface.

Current root causes:

- `searchEntities` treats the whole query string as a substring against indexed fields; it does not tokenize into entity candidates.
- Search matching covers `name`, `content`, `aliases`, `description`, and `title`, but person `org`, `org_tags`, `projects`, `role`, and source fields are not first-class searchable fields.
- There is no canonical normalization pass for honorifics such as `さん` / `氏`, whitespace differences such as `TechKnight` vs `Tech Knight`, or romanized / kana variants such as `Lecaldo` / `Le caldo` / `レカルド` / `リカルド`.
- A single no-result query can be over-reported by agents as "Graph SSOT未登録" even though atomic entity lookup would have found the entity.

## Goal

Add a Graph entity resolver path that accepts raw user text or a broad agent query and returns canonical Graph entity candidates in one call, with enough evidence to prevent false absence claims.

The resolver should make the correct behavior easy:

- Raw query in, normalized candidates out.
- Matched fields and confidence out.
- Absence verdict only after documented fallback checks.
- Existing `search` stays backward-compatible.

## Non-Goals

- Replacing Graph SSOT storage or changing Graph entity schemas.
- Backfilling missing local files into Graph. That belongs to `story-local-data-server-ssot-migration`.
- Treating local meeting notes, transcripts, or docs as canonical when Graph disagrees.
- Automatically mutating Graph records from resolver results.
- UI redesign for Graph browsing.
- Broad semantic vector search. This Story is about deterministic entity resolution first.

## Acceptance Criteria

### Resolver Surface

- [ ] Add a resolver surface, preferably `mcp__brainbase__resolve_entity` or an equivalent MCP tool, that accepts:
  - raw `query`
  - optional `types` such as `person`, `org`, `contact`, `customer`, `project`, `decision`, `document`
  - optional `project`
  - optional `scope`
  - optional `includePhilosophy`
- [ ] Resolver returns a structured result with:
  - `candidates[]`
  - `entity_id`
  - `type`
  - `name`
  - `aliases`
  - `matched_terms`
  - `matched_fields`
  - `score`
  - `confidence`
  - `project_code`
  - `why`
  - `absence_verdict`
  - `searched_terms`
  - `fallbacks_used`
- [ ] Resolver must not return `absence_verdict=not_in_graph` from one raw compound query alone. It can return `no_candidate_after_resolver_checks` only after tokenized matching and configured fallback checks have completed.

### Normalization And Matching

- [ ] Split broad queries on whitespace, punctuation, slashes, commas, pipes, and Japanese separators.
- [ ] Strip common honorifics and suffixes from person terms: `さん`, `氏`, `様`, `先生`.
- [ ] Normalize case, full-width/half-width ASCII, repeated spaces, and no-space variants such as `TechKnight` vs `Tech Knight`.
- [ ] Match across person fields: `name`, `aliases`, `role`, `org`, `org_tags`, `projects`, `source`, `source_path`, `legacy_source_path`, `content`.
- [ ] Match across org/contact/customer/project fields with the same field-aware approach.
- [ ] Exact name or exact alias matches must survive noisy extra tokens. For example, a query containing `若松` plus unrelated or misspelled tokens still returns 若松 冬美 as a candidate.
- [ ] Return field-level evidence so agents can say "matched by name" or "matched only by org field" instead of guessing.

### Known Regression Cases

- [ ] Query `若松 Lecaldo レカルド TechKnight 役員` returns `per_wakamatsu_fuyumi` as a candidate with a high-confidence `name` match on `若松`, even if other tokens are unmatched.
- [ ] Query `若松さん` resolves to `per_wakamatsu_fuyumi`.
- [ ] Query `若松冬美` resolves to `per_wakamatsu_fuyumi`.
- [ ] Query `Wakamatsu Fuyumi` resolves to `per_wakamatsu_fuyumi`.
- [ ] Query `持田` resolves to `per_mochida_sho`.
- [ ] Query `リカルド` does not silently return no result if people contain `org=株式会社リカルド`; it either returns relevant person candidates with `matched_fields=["org"]` or clearly reports that no standalone org entity exists.
- [ ] Query `senpainurse` can find relevant project/person context where the Graph payload contains `projects=["senpainurse"]` or a project entity exists.

### Backward Compatibility

- [ ] Existing MCP `search` behavior remains available for callers that expect simple substring search.
- [ ] Existing `get_entity`, `get_context`, and `list_entities` contracts are not broken.
- [ ] Extension entity default-noise rules from `SPEC-brainbase-mcp-core-ontology` remain intact unless explicitly changed by a later Story.

### Agent Contract

- [ ] Update Graph lookup guidance so agents use resolver for raw user phrases and use atomic `search` / `list_entities` only as fallback or inspection.
- [ ] Documentation states that one `search` no-result is not Graph absence.
- [ ] If resolver confidence is low, response wording must distinguish:
  - "resolver found no candidate"
  - "Graph entity is confirmed absent"
  - "secondary sources mention it but Graph does not"

## Implementation Notes

- Keep deterministic resolution in code. Do not rely on model judgment to decide whether a compound query proves absence.
- Prefer a shared normalization utility used by resolver tests and MCP handlers.
- Scoring should favor exact name and alias matches, then structured fields, then content.
- Field-level evidence is required because the resolver is used to support high-stakes Graph SSOT claims.

## Suggested Tasks

1. Write Architecture for the resolver boundary and scoring model.
2. Write Spec with normalization, match scoring, and absence-verdict invariants.
3. Add failing tests for the known regression cases.
4. Implement normalization and candidate scoring in `mcp/brainbase/src/indexer`.
5. Expose the resolver through the MCP server.
6. Update Graph lookup docs / capability guidance.
7. Run VibePro PR preparation and required review gates.

## Verification

```bash
npm run test:run -- mcp/brainbase/tests/tools/entity-resolver.test.ts
npm run test:run -- mcp/brainbase/tests/tools/server-core-ontology.test.ts
npm run test:run -- mcp/brainbase/tests/sources/graphapi-source.test.ts
npm run typecheck
node /Users/ksato/workspace/code/vibepro/bin/vibepro.js pr prepare . --base origin/develop --story-id story-graph-entity-resolver
```

Manual smoke:

```text
resolve_entity("若松 Lecaldo レカルド TechKnight 役員")
resolve_entity("若松さん")
resolve_entity("リカルド")
resolve_entity("senpainurse")
```

Expected:

- The first two return `per_wakamatsu_fuyumi`.
- `リカルド` reports relevant person/org candidates or a precise standalone-org absence.
- `senpainurse` reports relevant project/person context or a precise project-surface absence.

## Review Focus

- Does the resolver prevent false "Graph未登録" claims from one broad search?
- Are matched fields and confidence transparent enough for agents to cite evidence?
- Does the implementation avoid turning Graph search into noisy unbounded semantic search?
- Does the resolver preserve Graph SSOT precedence over local notes and generated summaries?
- Are low-confidence and absent cases phrased safely and explicitly?
