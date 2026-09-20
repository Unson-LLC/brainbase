---
story_id: story-nocodb-runtime-boundary-retirement
status: complete
title: NocoDB runtime boundary retirement
---

# NocoDB runtime boundary retirement

## Outcome

The retired NocoDB HTTP CRUD boundary cannot mutate or read live data.
Canonical Tasks require an explicit backend; an unconfigured environment is
disabled instead of silently selecting NocoDB or PostgreSQL.

## Acceptance criteria

- An unset canonical backend returns `disabled` and the Task API fails with 503
  before store access or external metadata extraction. NocoDB and PostgreSQL
  are available only through explicit selection and the existing cutover evidence.
- Every method and subpath under `/api/nocodb` returns a side-effect-free
  `410 capability_retired` response before any NocoDB request is made.
- The project portal does not fetch or merge NocoDB records. Its existing
  response shape remains available for Graph-backed content and retired
  projection fields explicitly distinguish retired/unavailable data from measured zero.
- The `/api/brainbase/actions` and `/api/brainbase/action-types` aliases return
  side-effect-free `410 capability_retired` responses; they cannot create,
  list, or update NocoDB action records.
- PostgreSQL and NocoDB canonical repositories share cursor decoding without
  importing the legacy repository from the PostgreSQL implementation.
- Historical migration tools and opaque legacy identifiers remain readable;
  this change does not delete external data, secrets, or migration fixtures.

## Scope and non-goals

This story covers the server route boundary, portal projection, canonical
backend-selection fail-closed behavior, the shared cursor helper, and the legacy Brainbase action
aliases. Other NocoDB-backed dashboard read projections, the standalone
NocoDB MCP package, and production deployment are separate work and are not
silently changed here.

## Verification

Graphify impact lookup for the bounded files was partial/unknown, so direct
consumer inspection and affected route/repository tests are the authoritative
verification for this story.
