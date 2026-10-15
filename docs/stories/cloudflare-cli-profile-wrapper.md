# Cloudflare CLI organization profile wrapper

## Background

Unson and Tech Knight use separate Cloudflare accounts. A developer who regularly
operates both accounts must not depend on whichever Wrangler OAuth session happened
to be active most recently.

## Acceptance Criteria

1. Every Wrangler invocation names a local Brainbase profile explicitly.
2. A profile binds a Wrangler named-auth profile to one expected Cloudflare Account ID.
3. A conflicting `account_id` in `wrangler.toml`, `wrangler.json`, or `wrangler.jsonc`
   fails before Wrangler is started.
4. Inherited API-token and legacy global-key variables cannot silently override the
   selected OAuth profile.
5. Login and read-only diagnosis are available without storing credentials in this
   repository or in the profile file.
6. The wrapper can be composed with `wrangler-tail-bounded` for bounded log tails.

## Verification

- `npm test -- tests/cloudflare-profile.test.ts`
- `git diff --check`
