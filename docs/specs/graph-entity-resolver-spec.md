---
story_id: story-graph-entity-resolver
title: Graph entity resolver spec
status: proposed
date: 2026-06-19
---

# Graph entity resolver spec

## Resolver Input

The resolver accepts:

- `query`: raw user or agent text.
- `types`: optional entity type filters such as `person`, `org`, `contact`,
  `customer`, `project`, `decision`, or `document`.
- `project`: optional project code used as request context. It must not act as
  a strict candidate filter because the original failure mode can include
  `project=brainbase` while the matching entity belongs to another project.
- `scope`: optional Graph scope.
- `includePhilosophy`: optional philosophy-context toggle.

## Resolver Output

The resolver returns:

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
- `unsupported_types`

## Invariants

- `absence_verdict=not_in_graph` must not be returned from one raw compound
  query alone.
- Exact `name` and exact `aliases` matches must survive noisy extra tokens.
- Field-level evidence must distinguish name, alias, org, project, source, and
  content matches.
- `project` request context must not suppress name or alias candidates from
  other project-linked records.
- Resolver decisions must be deterministic code behavior, not model judgment.
- Existing Graph MCP tools remain backward-compatible.
- Unsupported type filters must be reported in `unsupported_types` and must add
  `unsupported_type_reported` to `fallbacks_used`.

## Normalization

- Split broad queries on whitespace, punctuation, slashes, commas, pipes, and
  Japanese separators.
- Strip common person suffixes: `さん`, `氏`, `様`, `先生`.
- Normalize case and full-width/half-width ASCII.
- Normalize repeated spaces and derive no-space variants.

## Matching

Person matching covers:

- `name`
- `aliases`
- `role`
- `org`
- `org_tags`
- `projects`
- `source`
- `source_path`
- `legacy_source_path`
- `content`

Organization, customer, project, decision, and document matching use the same
field-aware pattern where equivalent structured fields exist. `contact` is a
forward-compatible filter until a Core contact index surface exists; it is
reported in `unsupported_types` rather than silently dropped.

## Regression Cases

- `若松 Lecaldo レカルド TechKnight 役員` with `project=brainbase` returns
  `per_wakamatsu_fuyumi` with a high-confidence `name` match on `若松`.
- `若松さん` resolves to `per_wakamatsu_fuyumi`.
- `若松冬美` resolves to `per_wakamatsu_fuyumi`.
- `Wakamatsu Fuyumi` resolves to `per_wakamatsu_fuyumi`.
- `持田` resolves to `per_mochida_sho`.
- `リカルド` returns relevant candidates with `matched_fields=["org"]` when
  only structured org fields match, or reports precise standalone-org absence.
- `senpainurse` finds relevant project/person context when Graph payloads contain
  `projects=["senpainurse"]` or a project entity exists.

## Agent Contract

Agents use the resolver for raw user phrases. They use `search`, `get_entity`,
`get_context`, and `list_entities` for direct fallback and inspection. One
`search` no-result is not sufficient evidence that Graph lacks an entity.
