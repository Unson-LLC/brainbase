---
story_id: str.brainbase.sns-auth-health-unified
title: SNS auth health follows posting credentials
status: active
horizon: M5
view: ops
period: 2026-05
architecture_docs:
  - docs/architecture/sns-auth-health-unified-architecture.md
spec_docs:
  - docs/specs/sns-auth-health-unified-spec.md
---

# Story: SNS auth health follows posting credentials

## Story ID

str.brainbase.sns-auth-health-unified

## Background

SNS Growth Cockpit shows an X account health check before operations. The current health check uses the X API OAuth2/Bearer client, while the public posting bridge uses the existing `sns_post.py` path backed by OAuth1 credentials (`X_CONSUMER_KEY`, `X_CONSUMER_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`). This makes the cockpit show `auth_failed` even when the posting bridge may be the credential path operators actually depend on.

Related architecture: [SNS auth health unified architecture](../architecture/sns-auth-health-unified-architecture.md)

Related spec: [SNS auth health unified spec](../specs/sns-auth-health-unified-spec.md)

## User Story

As the SNS operator, I want the Account Health indicator to reflect the credential path used by scheduled posting, so I can tell whether the system is ready to post before approving scheduled posts.

## Acceptance Criteria

- AC-1: X Account Health checks OAuth2 credentials when an explicit OAuth2 env credential is present.
- AC-2: If OAuth2 credentials are absent or invalid, Account Health can fall back to the posting bridge credential check.
- AC-3: OAuth1 posting env vars are never returned to the UI; only presence and health state are exposed.
- AC-4: `X_ACCESS_TOKEN` is not treated as an OAuth2 Bearer token fallback because it is used by the legacy OAuth1 posting bridge.
- AC-5: Rate-limit status is reported only for OAuth2 health; posting-bridge health returns a clear non-availability reason.

## Non-Goals

- Do not migrate posting from `sns_post.py` to the internal X provider in this slice.
- Do not expose or rewrite production secrets.
- Do not perform a public post as part of health check.
