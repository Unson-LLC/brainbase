# Resource reservations removed from the OSS core — unreleased (breaking)

Unreleased; publish needs separate approval. The latest npm release is 0.50.22,
and its tag `v0.50.22` does not contain this change. It came in with #1027
(merge commit `4a7d921`), which is on `develop` and not yet on `main`. The
release that first ships `develop` past `4a7d921` must call this out as a
breaking change and choose its version accordingly.

## Removed public surface

| Kind | Name | Note |
|---|---|---|
| package export | `@unson/brainbase-mcp/resource-reservations` | `ResourceReservationService`, `createResourceReservationProblemSnapshotPort`, `ResourceReservationError` and their types |
| package export | `@unson/brainbase-mcp/resource-reservation-http` | `createResourceReservationHttpHandler` and the `/api/resource-reservations` routes |
| function | `createResourceReservationExecutionPort` from `@unson/brainbase-mcp/execution-authority` | The OSS core now only receives a reservation through `ExecutionReservationPort` |

`ExecutionProblemReference` in `./execution-authority` is now declared there as
an interface instead of an alias of `ResourceReservationProblemReference`. Its
shape is unchanged.

Reservations are an organization concept (tenants, approval, capacity). They
now live in brainbase-organization (`packages/company-os/resource-reservations.js`
and `resource-reservation-http.js`, Unson-LLC/brainbase-organization#1428),
which stores the ledger in PostgreSQL.

## Consumers checked (2026-11-20)

- brainbase-organization `main` (`29d8543`, the default branch, pinned to
  0.50.22): imports `ExecutionAuthorityService` only from the OSS package and
  takes the reservation pieces from its own `packages/company-os` copies. Not
  affected.
- brainbase-organization `develop` (`6ea2304`, last updated 2026-11-10, pinned
  to 0.45.0): `packages/company-os/canonical-execution-routes.js` still imports
  `createResourceReservationExecutionPort`, `./resource-reservations` and
  `./resource-reservation-http` from the OSS package. That branch breaks if its
  dependency is raised to a release containing this change without first taking
  the `main` version of the file.
- brainbase-unson `main` (`4c2dcc5`) and `develop` (`9e218c7`): no use of the
  removed exports or function.

Check these again at the version bump.

## Migration

Import the reservation service and HTTP handler from the organization layer,
and pass its execution port to `ExecutionAuthorityService` as the
`reservation` port. Nothing changes for callers that only use
`./execution-authority` with their own `ExecutionReservationPort`.

No npm publication, version bump or deployment is included.
