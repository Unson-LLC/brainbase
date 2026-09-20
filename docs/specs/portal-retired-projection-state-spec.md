---
story_id: story-nocodb-runtime-boundary-retirement
spec_id: spec-portal-retired-projection-state-v1
status: active
---

# Portal retired projection state — implementation spec

The project portal keeps its historical response shape while the legacy
NocoDB read projection is retired. The response must not turn the absence of
that source into a successful zero-valued measurement.

## Invariants

1. `issues.stats.open` and `issues.stats.highImpact` are `null`.
2. Every field in `tasks.stats` and `health.score` is `null`.
3. The main portal response includes
   `meta.legacyProjection = { status: "retired", source: "nocodb" }`.
4. `/api/brainbase/portal/:projectCode/value-loop` keeps its four existing
   sections and includes `meta = { status: "retired", source: "nocodb" }`.
5. These routes do not call the NocoDB service. Graph-backed direction,
   frame, story, and member contracts remain unchanged.

## Verification

`tests/server/routes/portal-routes.test.js` covers the null-valued legacy
fields, explicit retirement metadata, route shape, and absence of NocoDB
calls.

## Non-scope

This spec does not change Graph/story/member retrieval, migration tools,
historical NocoDB data, or E2E fixtures.
