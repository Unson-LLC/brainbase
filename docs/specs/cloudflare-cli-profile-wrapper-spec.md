# Cloudflare CLI organization profile wrapper spec

## Story

Let an operator choose an Unson or Tech Knight Cloudflare identity explicitly and
stop before execution when the repository configuration targets another account.

## Invariants

- INV-1: Profile aliases and profile files are explicit; there is no implicit default.
- INV-2: OAuth credentials remain owned by Wrangler. Tokens, keys, and email addresses
  are not accepted in the Brainbase profile JSON.
- INV-3: A declared account mismatch fails closed before invoking Wrangler.
- INV-4: The wrapper never prints credential values.

## Contracts

- C-1: Profiles live outside repositories under
  `~/.brainbase/cloudflare/profiles/<alias>.json` by default.
- C-2: A profile contains `wranglerProfile` and `accountId`, plus an optional
  `wranglerBin` override.
- C-3: `cloudflare-profile <alias> login` runs Wrangler's named-profile login flow.
- C-4: `cloudflare-profile <alias> doctor [--config <path>]` validates the profile,
  account binding, Wrangler availability, and named authentication.
- C-5: `cloudflare-profile <alias> -- <wrangler arguments...>` runs Wrangler with the
  selected native profile and expected account ID.

## Scenarios

- S-1: An `unson` profile executes `whoami` with `--profile unson` and the expected
  `CLOUDFLARE_ACCOUNT_ID`.
- S-2: A Tech Knight config passed to the Unson profile is rejected without starting
  Wrangler.
- S-3: A missing, malformed, or credential-bearing profile is rejected.
- S-4: Inherited Cloudflare API-token variables are removed before OAuth execution.
- S-5: `doctor` rejects a named authentication that cannot see the expected account.

## Verification

- V-1: Unit tests use a fake Wrangler process and temporary profile/config directories.
- V-2: Tests prove both the successful argument/environment handoff and fail-closed
  paths without performing a real login or Cloudflare write.
