---
story_id: story-companion-reply-draft-api
title: Brainbase Mac Companion reply context handoff API
status: active
date: 2026-06-22
---

# Brainbase Mac Companion Reply Context Handoff API

## Story

Mac Companion sends a message handoff to Brainbase and receives minimized reply context informed by Brainbase Graph SSOT and owner-only Personal KG. Mac Companion uses that context with the current Slack/Gmail thread and user regeneration intent to create the draft locally.

## Acceptance Criteria

- **ac:1 route**: Brainbase exposes `POST /api/companion/reply-context` and does not return 404 for the Mac handoff path. `POST /api/companion/reply-draft` remains available for compatibility.
- **ac:2 request-shape**: The endpoint accepts the Mac `DraftHandoffRequest` fields, including `userInstruction`, `threadMessages`, `contextPolicy=brainbase_workflow`, and `workflowName=brainbase.reply_context`.
- **ac:3 brainbase-context**: Brainbase API resolves Graph SSOT and Personal KG context server-side; the Mac app does not expand owner-only Personal KG.
- **ac:4 success-result**: The endpoint returns a Mac-compatible reply context result with `contextSnippets`, `guidance`, `rationale`, and an audit id.
- **ac:5 structured-failure**: If Graph/Personal KG context cannot be loaded, the endpoint fails loudly with a structured error.
- **ac:6 auth-required**: Missing or invalid auth is rejected; the endpoint is not public.
- **ac:7 native-csrf**: Native/server-to-server companion POSTs are not blocked by browser CSRF middleware before auth, but browser cookie auth is rejected on this CSRF-less path.
- **ac:8 draft-only-writeback**: Brainbase returns no provider writeback. Mac Companion creates any writeback intent locally and keeps it draft-only: human approval is required and sending is not allowed.

## Workflow Scenarios

- **scenario:accepted-context**: receive handoff -> authenticate request -> resolve Graph/Personal KG -> return `ReplyContextResult` for Mac-side draft generation.
- **scenario:auth-rejected**: receive handoff -> reject before context lookup/generation -> return `401`.
- **scenario:context-unavailable**: receive authenticated handoff -> Graph or Personal KG lookup fails -> return structured `503 context_unavailable`.
- **scenario:native-csrf-exempt**: receive native/server-to-server POST without browser CSRF token -> pass CSRF middleware -> auth still decides access.
- **scenario:cookie-auth-rejected**: receive browser cookie-authenticated POST without browser CSRF token -> reject with `403 server_to_server_auth_required` before Graph or Personal KG lookup.
- **scenario:existing-activity-csrf-exempt**: keep the pre-existing `/api/sessions/report_activity` CSRF exemption unchanged while adding the companion native-client exemption.

## Out Of Scope

- Direct Slack or Gmail writeback.
- Production LLM provider wiring.
- Public unauthenticated API access.
