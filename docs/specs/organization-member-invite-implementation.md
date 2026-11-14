# Member invitation kernel implementation

Implements the ports in [the invitation specification](./organization-member-invite-v1.md).
This is a reusable kernel and an opt-in HTTP handler, not a mounted organization
service or a released invitation feature. No existing route or login behavior changes.

The package exports `organization-member-invite` and
`organization-member-invite-http`. The host supplies durable storage, current
authorization, provider-verified identity, idempotent membership binding, audit,
delivery and an HTTPS accept URL without URL credentials, with the token only
in its fragment. URL construction and validation happen before saving or
superseding any invitation. The in-memory store is
for local tests only. No SMTP, provider credentials, database or company defaults
are included. The organization application owns actual API/BFF mounting and UI.

Tokens have 256 random bits. Only their SHA-256 hashes enter the repository.
Readback excludes hashes and reservations. Acceptance reserves a token before
binding; an unknown binding/finalization outcome retains the reservation for the
same person's idempotent recovery, including after expiry. Revocation and reissue
must serialize with acceptance in the host repository. Audit failure does not
overturn an accepted membership. Delivery failure does not imply rollback of the
issued invitation; the host can reissue it using the `inviteId` in the stable
error details. HTTP exposes only that validated ID from error details, never
tokens or email addresses. Missing delivery returns `delivered: false`.

Malformed or unknown repository replies fail closed. Readback validates dates,
status, hash, identifiers and metadata; acceptance checks reservation ownership
and token hash. Mutation result readback must match the requested tenant and
invitation. No unknown lookup is treated as an empty duplicate list. The required repository
`withPendingEmailLock` serializes duplicate lookup, policy and issuance for the
same tenant and normalized email across service instances. Durable adapters must
coordinate this lock across processes and propagate callback errors unchanged.
The reference adapter supplies a per-key queue for one Node process.

Duplicate policy defaults to `reject`. `reissue` replaces a single pending invite
with a new token, preserving its role and metadata and checking reissue authority.
A different requested role or multiple pending records is rejected. There is no
`allow` option that creates a second pending invite. To resend the same link,
use `resendInvite` with the existing raw token. Metadata keys that indicate API
keys or sessions are rejected too. Arbitrary secrets hidden in otherwise allowed
metadata values remain the host's responsibility.

The HTTP handler requires trusted host identity and verified mutation origin;
browser identity fields are rejected. The host must establish that context and
enforce CSRF protection and abuse limits. The kernel does not authenticate a
previously unregistered invitee or grant access by itself. Host policy and binding
must recheck current tenant/provider/role authority at their transaction boundary.

Validation uses deterministic clocks, concurrent calls, failure injection and a
real local HTTP server. The npm consumer smoke installs a packed tarball and
exercises the exported service. These checks prove package behavior, not live
OAuth, durable membership, external email delivery or production deployment.

```sh
npm ci --ignore-scripts
npm run build
npx vitest run tests/organization-member-invite.test.ts tests/organization-connection.test.ts tests/npm-consumer-smoke.integration.test.ts
```
