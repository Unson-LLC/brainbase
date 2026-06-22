---
title: Companion Reply Draft API Architecture
status: active
date: 2026-06-22
story_id: story-companion-reply-draft-api
---

# Companion Reply Draft API Architecture

## Boundary

`POST /api/companion/reply-draft` is a Brainbase server-side handoff boundary for native Mac clients. The Mac app sends source message metadata and user intent. Brainbase owns retrieval of Graph SSOT and Personal KG context, then delegates draft text creation to a replaceable generator.

## Components

- Route: `server/routes/companion.js`
- Controller: `server/controllers/companion-controller.js`
- Service: `server/services/companion/reply-draft-service.js`
- Context resolver: `server/services/companion/reply-draft-context-resolver.js`
- Draft generator: `server/services/companion/draft-generator.js`

## Auth

The route first uses existing Brainbase auth middleware, then applies a companion-specific native access guard. Bearer JWT, `bbsvc_` service tokens, internal API key auth, and existing test header auth can enter the route. Browser cookie-only auth is rejected because `/api/companion/` is a CSRF-exempt native/server-to-server boundary.

Bearer/test-header actors must match the configured Personal KG owner id or configured owner alias ids before Graph or owner-visible Personal KG lookup. Internal and service-token credentials are allowed for server-to-server operation.

The CSRF middleware already exempted `/api/sessions/report_activity` for local activity telemetry. This design keeps that exemption unchanged and adds only the `/api/companion/` native-client boundary, so the companion API does not regress existing session telemetry.

## Data Flow

1. Route authenticates the request.
2. Controller passes the body and `req.access` to the service.
3. Service validates `contextPolicy=brainbase_workflow` and `workflowName=brainbase.reply_draft`.
4. Context resolver reads:
   - Graph SSOT via `infoSSOTService.getContext()`.
   - Personal KG via `learningService.searchPersonalKgCandidates()`.
5. Draft generator receives request, user instruction, thread messages, and resolved context.
6. Service returns `DraftHandoffResult` with a draft-only writeback intent.

## Failure Policy

Graph or Personal KG lookup failure is a structured `503 context_unavailable` response. Missing generator is a structured `503 generator_unconfigured` response. The service does not fall back to a canned reply because that would hide missing context or missing generation infrastructure.

## Safety

The writeback intent always sets `requiresHumanApproval: true` and `sendAllowed: false`. This API never sends or persists a Slack/Gmail message.
