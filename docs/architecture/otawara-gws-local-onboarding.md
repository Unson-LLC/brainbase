# Otawara Google Workspace Local Onboarding Architecture

## Decision

Add a planning-only onboarding surface that converts an agent interview result into a deterministic local setup plan. The plan lives beside `onboard:diagnose-sources` and `onboard:candidates`; it does not collect data, call external APIs, or write canonical SSOT files.

## Boundaries

- Brainbase v1 remains local-first MCP only.
- A 24/365 Mac mini is modeled as a local runtime host for the user's own MCP process.
- Hosted backends, Infisical, Unson APIs, Lightsail, and bb.unson.jp sync remain out of scope.
- Google Workspace source collection is delegated to local GoG-style commands after user authorization.
- Drive and local filesystem collection are allowlist-first.
- Calendar and notes task fragments feed candidate extraction, not canonical task truth.

## Data Flow

1. Codex or Claude Code asks the onboarding interview questions.
2. `brainbase onboard:plan` receives the selected profile and source answers.
3. The plan prints setup steps, source boundaries, required user input, and next commands.
4. The agent runs `onboard:diagnose-sources` to check local collector readiness.
5. The agent drafts candidates under `candidates/`.
6. The user reviews candidates before any `onboard:seed` promotion.

## Non-Goals

- No UI.
- No source import implementation.
- No server operations handoff.
- No automatic config mutation for Gmail, Calendar, Drive, Notion, or local notes.

