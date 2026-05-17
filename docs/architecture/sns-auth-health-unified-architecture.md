---
story_id: str.brainbase.sns-auth-health-unified
title: SNS auth health follows posting credentials architecture
status: active
---

# Architecture: SNS auth health follows posting credentials

## Story

`str.brainbase.sns-auth-health-unified`

## Decision

Keep the public posting path on the existing `sns_post.py` bridge for this slice, and make Account Health aware of both supported credential modes:

- `x_api_oauth2`: X API v2 user-context token, used for account health and metrics/rate-limit reads.
- `posting_bridge_oauth1`: legacy OAuth1 env set used by `sns_post.py` for public posting.

## Rationale

The SNS scheduled publisher currently calls `SnsLedgerPublishService`, which executes `sns_post.py`. That script verifies and posts with OAuth1 env vars. Meanwhile, the cockpit account health endpoint used `XApiClient`, which assumes a Bearer/OAuth2 token. In the live environment this produced `auth_failed` even though the relevant posting bridge is a different credential path.

Changing the scheduled publisher to use the internal provider is larger than this operational fix. The safer step is to make health reflect the actual posting path while preserving the no-secret API boundary.

## Boundaries

- Account Health API: `server/routes/sns-growth.js`
- Runtime provider wiring: `server/bootstrap/register-api-routes.js`
- X API OAuth2 client: `server/services/sns/providers/x-client.js`
- Posting bridge health: `server/services/sns/sns-posting-auth-health.js`
- Public post execution remains in `server/services/sns/sns-ledger-publish-service.js`

## Security Notes

The API exposes only env key presence and credential mode. It never returns the env values.

`posting_bridge_oauth1` health uses the same `x_client.py --verify` script family as public posting. In production default mode, the Node process must not fail early only because its own env is missing OAuth1 keys: `x_client.py` is allowed to discover the workspace `.env`, matching the existing posting bridge behavior. Explicit test env objects still fail before shelling out when required keys are incomplete.

## Follow-Up

Unifying actual public posting onto the internal provider should be a separate story because it changes the public side-effect path and audit behavior.
