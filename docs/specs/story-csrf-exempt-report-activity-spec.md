---
story_id: story-csrf-exempt-report-activity
title: Spec — CSRF exemption for session activity telemetry
status: active
---

## Invariants

- **INV-1 (exempt telemetry)**: In production, a POST to `/api/sessions/report_activity` without an
  `x-csrf-token` header passes the CSRF middleware (calls `next()`, no 403).
- **INV-2 (scoped)**: The exemption matches ONLY the exact path `/api/sessions/report_activity`. Any
  other mutating path without a token is still 403'd in production.
- **INV-3 (placement)**: The exemption is an early `return next()` before token validation, mirroring
  the existing `/api/auth/device/` exemption — no change to the token validation logic itself.

## Constraints

- **CON-1**: Safe methods (GET/HEAD/OPTIONS) and the `/api/auth/device/` exemption are unchanged.
- **CON-2**: Dev-mode behavior (warn + proceed) is unchanged for all other paths; report_activity now
  simply does not warn (it returns before the warn branch).

## Scenarios

- **S-1**: prod, POST report_activity, no token -> next(), no 403.
- **S-2**: prod, POST /api/sessions/<id>/input, no token -> 403 (CSRF still enforced).
- **S-3**: prod, POST report_activity WITH a valid token -> still next() (exemption is unconditional
  for this path, not token-dependent).

## Anti-patterns

- **AP-1**: Broadly disabling CSRF, or prefix-matching `/api/sessions/` (would exempt mutating
  session endpoints like input/scroll). The exemption is the exact telemetry path only.

## Verification

`tests/unit/csrf-report-activity-exempt.test.js` covers S-1 and S-2. The in-process e2e covers the
same. Existing CSRF tests guard CON-1/CON-2.
