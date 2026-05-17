---
story_id: str.brainbase.sns-auth-health-unified
title: SNS auth health follows posting credentials spec
status: active
---

# SPEC: SNS auth health follows posting credentials

## Story

`str.brainbase.sns-auth-health-unified`

## Invariants

- INV-1: Account Health must never expose token values, client secrets, access token secrets, API keys, or cookie material.
- INV-2: Explicit OAuth2 credential refs take precedence for X API health and rate-limit checks.
- INV-3: `X_ACCESS_TOKEN` and `TWITTER_ACCESS_TOKEN` are OAuth1 posting bridge variables and must not be used as OAuth2 Bearer tokens, whether by fallback or explicit `credential_ref.env`.
- INV-4: When OAuth2 health is unavailable, posting bridge health may verify OAuth1 readiness without posting.
- INV-5: Posting bridge health must return a clear `credential_mode` so UI/API operators know which path was checked.
- INV-6: Posting bridge health does not provide X API read rate-limit data.

## Contracts

### Account API

`GET /api/sns-growth/accounts` returns a sanitized `credential_ref`:

- `provider`, `path`, `version`, `env`, `project`
- `env_present`
- `posting_bridge_env_present`

No secret values are returned.

### Health API

`POST /api/sns-growth/accounts/:id/health-check` returns:

```json
{
  "health": {
    "ok": true,
    "reason": null,
    "credential_mode": "posting_bridge_oauth1",
    "rate_limit": {
      "remaining": null,
      "resetAt": null,
      "reason": "not_available_for_posting_bridge"
    }
  }
}
```

OAuth2 health may return `credential_mode: "x_api_oauth2"` and actual rate-limit data.

## Scenarios

- S-1: Explicit OAuth2 env exists and `/2/users/me` succeeds: health is OK using `x_api_oauth2`.
- S-2: OAuth2 env is missing, OAuth1 posting env is complete, and non-posting verify succeeds: health is OK using `posting_bridge_oauth1`.
- S-3: OAuth2 is unavailable and OAuth1 posting env is incomplete: health is NG with `missing_posting_bridge_credentials`.
- S-4: `X_ACCESS_TOKEN` exists without an explicit OAuth2 ref, or is present as `credential_ref.env`: OAuth2 client does not use it as Bearer.

## Anti-Patterns

- AP-1: Returning raw env values in Account API responses.
- AP-2: Treating legacy OAuth1 `X_ACCESS_TOKEN` as OAuth2 Bearer.
- AP-3: Health check that publishes or mutates the posting ledger.

## Verification

- `tests/server/routes/sns-growth.test.js`
- `tests/sns/providers/x-api-client.test.js`
- `tests/sns/publishing/sns-posting-auth-health.test.js`
