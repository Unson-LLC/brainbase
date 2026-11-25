# Execution authority removed from the OSS core — integrated into `0.51.0`

> **Integrated**: This note has been integrated into [`docs/releases/0.51.0.md`](./0.51.0.md). Kept for historical reference.

Unreleased; publish needs separate approval. The latest npm release is 0.50.22.
The release that first ships this change must call it out as a breaking change
and choose its version accordingly. Publish it only after brainbase-unson has
taken the brainbase-organization version that carries its own copy (see
"Order" below).

## Removed public surface

| Kind | Name | Note |
|---|---|---|
| package export | `@unson/brainbase-mcp/execution-authority` | `ExecutionAuthorityService`, `ExecutionAuthorityError`, `createSidecarExecutionIntentStore` and the port and record types (`ExecutionReservationPort`, `ExecutionIntentStore`, `ExecutionIntentRecord`, …) |
| package export | `@unson/brainbase-mcp/execution-authority-http` | `createExecutionAuthorityHttpHandler` and the `/execution-authority` routes |

An execution intent carries a tenant, an approval, an authority, a delegation
and a required reservation port. Reservations already moved out of the OSS
core (`unreleased-remove-resource-reservations.md`), so the service could not
run on the OSS core alone. It now lives in brainbase-organization
(`packages/company-os/execution-authority.js` and `execution-authority-http.js`,
Unson-LLC/brainbase-organization#1476), whose host always passes the
PostgreSQL intent store. The OSS default sidecar store was not moved.

The organization copy keeps the routes, status codes, error codes and the
stored record. Its HTTP input checks no longer use zod, so the messages of
`invalid_request` differ; the organization Spec lists them.

## Consumers checked (2026-11-20)

- brainbase-organization `main` (`29d8543`, pinned to 0.50.22):
  `packages/company-os/canonical-execution-routes.js`, `scripts/check-brainbase-mcp.mjs`
  and five tests import the removed exports. #1476 replaces all of them with
  the organization copy. Do not raise its OSS dependency to a release that
  contains this change before #1476 is merged.
- brainbase-unson `main` (`4c2dcc5`) and `develop` (`9e218c7`): no direct use.
  It reaches the execution authority only through the vendored
  `@unson/brainbase-organization-company-os`.

Check these again at the version bump.

## Order

1. Merge brainbase-organization#1476.
2. brainbase-unson re-vendors `@unson/brainbase-organization-company-os` from
   that merge (`node scripts/vendor-organization-auth.mjs --commit <sha>`).
3. Publish an OSS release that contains this removal.

## Migration

Import `ExecutionAuthorityService` and `createExecutionAuthorityHttpHandler`
from the organization layer and pass a store (`createPostgresExecutionIntentStore`
in production). Nothing else in the OSS core used these exports.

No npm publication, version bump or deployment is included.
