---
story_id: story-nocodb-runtime-boundary-retirement
status: active
title: NocoDB runtime boundary retirement
---

# NocoDB runtime boundary retirement

## Outcome

Brainbase has one runtime source for canonical Tasks: PostgreSQL. The retired
NocoDB HTTP CRUD boundary cannot mutate or read live data, while migration and
historical compatibility code remains available only to explicit tooling.

## Acceptance criteria

- The canonical backend defaults to PostgreSQL when no backend environment
  variable is provided. An explicit `nocodb` backend remains available only for
  migration and compatibility workflows.
- Every method and subpath under `/api/nocodb` returns a side-effect-free
  `410 capability_retired` response before any NocoDB request is made.
- The project portal does not fetch or merge NocoDB records. Its existing
  response shape remains available for Graph-backed content and retired
  projection fields are empty rather than populated from the legacy service.
- The `/api/brainbase/actions` and `/api/brainbase/action-types` aliases return
  side-effect-free `410 capability_retired` responses; they cannot create,
  list, or update NocoDB action records.
- PostgreSQL and NocoDB canonical repositories share cursor decoding without
  importing the legacy repository from the PostgreSQL implementation.
- Historical migration tools and opaque legacy identifiers remain readable;
  this change does not delete external data, secrets, or migration fixtures.

## Scope and non-goals

This story covers the server route boundary, portal projection, canonical
backend selection, the shared cursor helper, and the legacy Brainbase action
aliases. Other NocoDB-backed dashboard read projections, the standalone
NocoDB MCP package, and production deployment are separate work and are not
silently changed here.

## Verification

Graphify impact lookup for the bounded files was partial/unknown, so direct
consumer inspection and affected route/repository tests are the authoritative
verification for this story.
