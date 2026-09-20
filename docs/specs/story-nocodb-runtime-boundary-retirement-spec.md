---
story_id: story-nocodb-runtime-boundary-retirement
spec_id: spec-nocodb-runtime-boundary-retirement-v1
status: complete
---

# NocoDB runtime boundary retirement — implementation spec

## Invariants

1. `resolveCanonicalTaskBackend()` returns `disabled` when its argument and
   `CANONICAL_TASK_BACKEND` are unset. NocoDB and PostgreSQL require explicit
   selection; unsupported values fail closed.
2. `createNocoDBRouter()` exposes no CRUD handlers. The mounted route returns
   HTTP 410 with `error=capability_retired` for reads and writes alike and
   never calls `fetch`.
3. Portal routes do not call `NocoDBService`, inspect project NocoDB mappings,
   or use NocoDB records to build the response. Graph-backed direction, frame,
   people, events, and stories retain their existing contracts.
4. `/api/brainbase/actions` and `/api/brainbase/action-types` return `410
   capability_retired` for every method and sub-path and never invoke the
   legacy action service.
5. Cursor encoding/decoding is a transport concern shared by both canonical
   repositories. The PostgreSQL repository must not import the NocoDB
   repository module.
6. The NocoDB repository remains available only under explicit backend selection
   and for migration callers. No external record or secret is deleted.

## Verification matrix

| Invariant | Test/evidence |
| --- | --- |
| backend fail-closed | backend selection and canonical-task contract tests |
| retired route | all-method route test with a fetch spy |
| no portal projection | portal route test with a throwing NocoDB service |
| shared cursor | repository cursor tests and static import inspection |
| compatibility boundary | existing migration/preflight tests |

## Explicit non-scope

The overview/trends read projections, standalone `mcp/nocodb` package,
launcher, production environment, and deployment are not modified by this
spec.
