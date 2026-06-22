---
story_id: story-companion-reply-draft-api
title: Brainbase Mac Companion reply draft handoff API
status: active
date: 2026-06-22
---

# Brainbase Mac Companion Reply Draft Handoff API

## Story

Mac Companion sends a message handoff to Brainbase and receives a safe reply draft that is informed by Brainbase Graph SSOT and owner-only Personal KG context.

## Acceptance Criteria

- **ac:1 route**: Brainbase exposes `POST /api/companion/reply-draft` and does not return 404 for the Mac handoff path.
- **ac:2 request-shape**: The endpoint accepts the Mac `DraftHandoffRequest` fields, including `userInstruction`, `threadMessages`, `contextPolicy=brainbase_workflow`, and `workflowName=brainbase.reply_draft`.
- **ac:3 brainbase-context**: Brainbase API resolves Graph SSOT and Personal KG context server-side; the Mac app does not expand owner-only Personal KG.
- **ac:4 success-result**: With an injected draft generator, the endpoint returns a Mac-compatible `DraftHandoffResult`.
- **ac:5 structured-failure**: If Graph/Personal KG context cannot be loaded or no generator is configured, the endpoint fails loudly with a structured error.
- **ac:6 auth-required**: Missing or invalid auth is rejected; the endpoint is not public.
- **ac:7 native-csrf**: Native/server-to-server companion POSTs are not blocked by browser CSRF middleware before auth, but browser cookie auth is rejected on this CSRF-less path.
- **ac:8 draft-only-writeback**: The writeback intent is always draft-only: human approval is required and sending is not allowed.

## Workflow Scenarios

- **scenario:accepted-draft**: receive handoff -> authenticate request -> resolve Graph/Personal KG -> call generator -> return `DraftHandoffResult` with safe writeback intent.
- **scenario:auth-rejected**: receive handoff -> reject before context lookup/generation -> return `401`.
- **scenario:context-unavailable**: receive authenticated handoff -> Graph or Personal KG lookup fails -> return structured `503 context_unavailable`.
- **scenario:generator-unconfigured**: receive authenticated handoff -> context resolves -> generator missing -> return structured `503 generator_unconfigured`.
- **scenario:native-csrf-exempt**: receive native/server-to-server POST without browser CSRF token -> pass CSRF middleware -> auth still decides access.
- **scenario:cookie-auth-rejected**: receive browser cookie-authenticated POST without browser CSRF token -> reject with `403 server_to_server_auth_required` before Graph or Personal KG lookup.
- **scenario:existing-activity-csrf-exempt**: keep the pre-existing `/api/sessions/report_activity` CSRF exemption unchanged while adding the companion native-client exemption.

## Out Of Scope

- Direct Slack or Gmail writeback.
- Production LLM provider wiring.
- Public unauthenticated API access.
