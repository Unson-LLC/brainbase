---
spec_id: SPEC-companion-reply-draft-api
title: Brainbase Mac Companion Reply Draft API Spec
status: active
date: 2026-06-22
story_id: story-companion-reply-draft-api
related_architecture:
  - docs/architecture/companion-reply-draft-api-architecture.md
implementation_files:
  - server/routes/companion.js
  - server/controllers/companion-controller.js
  - server/services/companion/reply-draft-service.js
  - server/services/companion/reply-draft-context-resolver.js
  - server/services/companion/draft-generator.js
test_files:
  - tests/server/routes/companion-reply-draft.test.js
  - tests/e2e/story-companion-reply-draft-api-contract.spec.ts
---

# Brainbase Mac Companion Reply Draft API Spec

## Invariants

- **INV-1**: `POST /api/companion/reply-draft` requires native/server-to-server Brainbase auth. Missing, invalid, or browser cookie-only credentials are rejected on this CSRF-less path.
- **INV-2**: Brainbase, not the Mac app, resolves Graph SSOT and Personal KG context.
- **INV-3**: `writebackIntent.requiresHumanApproval` is always `true`.
- **INV-4**: `writebackIntent.sendAllowed` is always `false`.
- **INV-5**: Missing Graph or Personal KG context resolver dependencies fail with a structured error before generation.
- **INV-6**: Missing draft generator fails with a structured error; the service must not return a canned normal draft.
- **INV-7**: `userInstruction` and `threadMessages` are passed to the generator.
- **INV-8**: The pre-existing `/api/sessions/report_activity` CSRF exemption remains unchanged; the companion exemption is additive and does not narrow or broaden that activity telemetry path.
- **INV-9**: Bearer/insecure-header requests may only access the configured Personal KG owner or configured owner aliases; internal and service-token credentials are allowed for server-to-server operation.

## Contracts

### Contract-1: Request

`POST /api/companion/reply-draft` accepts the Mac `DraftHandoffRequest` fields:

```json
{
  "provider": "gmail",
  "accountName": "work",
  "sourceTitle": "Inbox",
  "sourceURL": "https://mail.google.com/...",
  "sourceDedupeKey": "gmail:thread-1",
  "providerMessageID": "msg-1",
  "providerThreadID": "thread-1",
  "sender": { "name": "Sender", "email": "sender@example.com" },
  "subject": "Subject",
  "snippet": "Snippet",
  "threadMessages": [{ "sender": "Sender", "body": "Message body" }],
  "classificationReason": "needs reply",
  "classificationEvidence": ["direct ask"],
  "userInstruction": "polite and brief",
  "contextPolicy": "brainbase_workflow",
  "workflowName": "brainbase.reply_draft"
}
```

### Contract-2: Success Response

The response is compatible with Mac `DraftHandoffResult`:

```json
{
  "body": "Draft body",
  "rationale": ["Graph context resolved", "Personal KG context resolved"],
  "openQuestions": [],
  "sourceURL": "https://mail.google.com/...",
  "auditID": "aud_...",
  "writebackIntent": {
    "provider": "gmail",
    "itemID": "msg-1",
    "targetDedupeKey": "gmail:thread-1",
    "sourceURL": "https://mail.google.com/...",
    "requiresHumanApproval": true,
    "sendAllowed": false
  }
}
```

### Contract-3: Structured Failure

Failures return JSON with `error`, `code`, and `details` when available:

```json
{
  "error": "Context unavailable",
  "code": "context_unavailable",
  "details": { "source": "personal_kg" }
}
```

## Scenarios

### S-1: Authenticated draft handoff succeeds with fake generator

- **given**: valid auth, Graph context, Personal KG context, and an injected generator.
- **when**: the Mac request is posted.
- **then**: the route returns a `DraftHandoffResult`.
- **verification**: `tests/server/routes/companion-reply-draft.test.js`

### S-2: User instruction and thread messages reach generator

- **given**: a request has `userInstruction` and `threadMessages`.
- **when**: the draft is generated.
- **then**: the generator input includes both.
- **verification**: `tests/server/routes/companion-reply-draft.test.js`

### S-3: Context failure is structured

- **given**: Graph or Personal KG lookup fails.
- **when**: the request is posted.
- **then**: the API returns `503` with `code=context_unavailable`.
- **verification**: `tests/server/routes/companion-reply-draft.test.js`

### S-4: Unauthenticated request is rejected

- **given**: no valid token.
- **when**: the request is posted.
- **then**: the API returns `401`.
- **verification**: `tests/server/routes/companion-reply-draft.test.js`

### S-5: Native client POST is not CSRF-blocked

- **given**: Brainbase is running in production-like CSRF mode.
- **when**: a native/server-to-server companion POST reaches `/api/companion/reply-draft` without a browser CSRF token.
- **then**: CSRF middleware allows the request through and auth/context handling returns the final structured result.
- **verification**: `tests/e2e/story-companion-reply-draft-api-contract.spec.ts`, `tests/e2e/story-csrf-exempt-report-activity.spec.ts`

### S-6: Existing activity telemetry CSRF exemption is preserved

- **given**: Brainbase is running in production-like CSRF mode.
- **when**: `/api/sessions/report_activity` receives a POST without a browser CSRF token.
- **then**: the pre-existing activity telemetry exemption still passes through unchanged.
- **verification**: `tests/e2e/story-csrf-exempt-report-activity.spec.ts`

### S-7: Cookie auth is rejected on the companion native path

- **given**: Brainbase is running in production-like CSRF mode.
- **when**: `/api/companion/reply-draft` receives a POST authenticated only by `brainbase_session` cookie and no browser CSRF token.
- **then**: the request is rejected with `403 server_to_server_auth_required` before Graph or Personal KG lookup.
- **verification**: `tests/e2e/story-companion-reply-draft-api-contract.spec.ts`, `tests/server/routes/companion-reply-draft.test.js`

## Workflow State Machine

| State | Transition | Output |
|---|---|---|
| `handoff_received` | request lacks valid auth | `401 Authorization token required` |
| `handoff_received` | request passes auth | `context_resolving` |
| `context_resolving` | Graph lookup fails | `503 code=context_unavailable details.source=graph` |
| `context_resolving` | Personal KG lookup fails | `503 code=context_unavailable details.source=personal_kg` |
| `context_resolved` | generator is not configured | `503 code=generator_unconfigured` |
| `context_resolved` | generator returns a draft | `draft_ready` |
| `draft_ready` | response is serialized | `DraftHandoffResult` with `requiresHumanApproval=true` and `sendAllowed=false` |

## Production Path Matrix

| Path | Input | Boundary | Evidence |
|---|---|---|---|
| `POST /api/companion/reply-draft` unauthenticated | Mac-shaped body without auth | `requireAuth` rejects before context/generation | `tests/e2e/story-companion-reply-draft-api-contract.spec.ts` `ac:6` |
| `POST /api/companion/reply-draft` authenticated native POST | Mac-shaped body with Brainbase auth, no browser CSRF token | CSRF exemption passes; auth/context boundary handles result | `tests/e2e/story-companion-reply-draft-api-contract.spec.ts` `ac:1`, `ac:2`, `ac:5`, `ac:7` |
| `POST /api/companion/reply-draft` cookie-authenticated browser POST | `brainbase_session` cookie without browser CSRF token | companion access guard rejects cookie auth before context/generation | `tests/e2e/story-companion-reply-draft-api-contract.spec.ts`, `tests/server/routes/companion-reply-draft.test.js` |
| `POST /api/companion/reply-draft` non-owner bearer POST | valid bearer token for a non-owner actor | companion access guard rejects before owner-visible Personal KG lookup | `tests/server/routes/companion-reply-draft.test.js` |
| injected fake generator | normalized request/context | service returns compatible draft result | `tests/e2e/story-companion-reply-draft-api-contract.spec.ts` `ac:3`, `ac:4`, `ac:8` |
| Graph/Personal KG/generator unavailable | authenticated request | structured failure, no writeback side effect | `tests/server/routes/companion-reply-draft.test.js`, `tests/e2e/story-companion-reply-draft-api-contract.spec.ts` |
| `POST /api/sessions/report_activity` existing telemetry | production-like POST without browser CSRF token | existing CSRF exemption remains unchanged | `tests/e2e/story-csrf-exempt-report-activity.spec.ts` |

## Anti-patterns

- **AP-1**: Returning a successful normal draft when no generator is configured.
- **AP-2**: Sending to Gmail or Slack from this endpoint.
- **AP-3**: Allowing `sendAllowed=true`.
- **AP-4**: Expanding owner-only Personal KG inside the Mac app.
- **AP-5**: Publishing this endpoint without Brainbase auth.

## Verification

| Clause | Test | Status |
|---|---|---|
| INV-1, S-4 | tests/server/routes/companion-reply-draft.test.js | passed |
| INV-2, S-1 | tests/server/routes/companion-reply-draft.test.js | passed |
| INV-3, INV-4 | tests/server/routes/companion-reply-draft.test.js | passed |
| INV-5, S-3 | tests/server/routes/companion-reply-draft.test.js | passed |
| INV-6 | tests/server/routes/companion-reply-draft.test.js | passed |
| INV-7, S-2 | tests/server/routes/companion-reply-draft.test.js | passed |
| INV-8, S-6 | tests/e2e/story-csrf-exempt-report-activity.spec.ts | passed |
| INV-9, S-7 | tests/server/routes/companion-reply-draft.test.js, tests/e2e/story-companion-reply-draft-api-contract.spec.ts | passed |
| ac:1-ac:8, S-5 | tests/e2e/story-companion-reply-draft-api-contract.spec.ts | passed |
