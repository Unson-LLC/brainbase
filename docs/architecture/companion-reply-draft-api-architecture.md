---
title: Companion Reply Context API Architecture
status: active
date: 2026-06-22
story_id: story-companion-reply-draft-api
---

# Companion Reply Context API Architecture

## Boundary

`POST /api/companion/reply-context` is the primary Brainbase server-side handoff boundary for native Mac clients. The Mac app sends source message metadata and user intent. Brainbase owns retrieval, ACL, and minimization of Graph SSOT and Personal KG context, then returns reply guidance for Mac-side draft generation.

`POST /api/companion/reply-draft` remains as a compatibility endpoint for earlier experiments. It is not the preferred product boundary because Slack/Gmail thread state, regeneration intent, editing, approval, and provider draft writeback all live in Mac Companion.

## Components

- Route: `server/routes/companion.js`
- Controller: `server/controllers/companion-controller.js`
- Service: `server/services/companion/reply-draft-service.js`
- Context resolver: `server/services/companion/reply-draft-context-resolver.js`
- Draft generator: `server/services/companion/draft-generator.js` (compatibility endpoint only)

## Auth

The route first uses existing Brainbase auth middleware, then applies a companion-specific native access guard. Bearer JWT, `bbsvc_` service tokens, internal API key auth, and existing test header auth can enter the route. Browser cookie-only auth is rejected because `/api/companion/` is a CSRF-exempt native/server-to-server boundary.

Bearer/test-header actors must match the configured Personal KG owner id or configured owner alias ids before Graph or owner-visible Personal KG lookup. Internal and service-token credentials are allowed for server-to-server operation.

The CSRF middleware already exempted `/api/sessions/report_activity` for local activity telemetry. This design keeps that exemption unchanged and adds only the `/api/companion/` native-client boundary, so the companion API does not regress existing session telemetry.

## Data Flow

1. Route authenticates the request.
2. Controller passes the body and `req.access` to the service.
3. Service validates `contextPolicy=brainbase_workflow` and `workflowName=brainbase.reply_context`.
4. Context resolver reads:
   - Graph SSOT via `infoSSOTService.getContext()`.
   - Personal KG via `learningService.searchPersonalKgCandidates()`.
5. Service returns `ReplyContextResult` with `contextSnippets`, `guidance`, `rationale`, and an audit id.
6. Mac Companion uses the source thread, user instruction, and Brainbase context to create a local `DraftHandoffResult`.

## Failure Policy

Graph or Personal KG lookup failure is a structured `503 context_unavailable` response. The `reply-context` endpoint does not require a Brainbase-hosted draft generator. The compatibility `reply-draft` endpoint still returns structured `503 generator_unconfigured` when no generator is configured.

## Safety

The context endpoint returns guidance only. Mac Companion creates any provider writeback intent locally and must keep `requiresHumanApproval: true` and `sendAllowed: false`. Brainbase never sends or persists a Slack/Gmail message.
