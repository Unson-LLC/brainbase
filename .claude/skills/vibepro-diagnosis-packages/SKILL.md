---
name: vibepro-diagnosis-packages
description: Use when the user asks VibePro to check UI, security, performance, architecture, PR readiness, launch readiness, or performance improvement evidence.
---

# VibePro Diagnosis Packages

## Purpose

Use VibePro purpose-level packages instead of guessing which low-level scanner or log to inspect. The package is the user-facing intent; the scanner set and evidence paths are VibePro's implementation detail.

## Diagnosis Packages

List packages first when the request is ambiguous:

```bash
vibepro check list
```

Use these mappings:

- UI quality / user flow / API contract in UI calls: `vibepro check ui <repo> --story-id <story-id>`
- Security / auth / exposed surface / API route contracts: `vibepro check security <repo> --story-id <story-id>`
- Performance readiness / heavy dev / DB access risks: `vibepro check performance <repo> --story-id <story-id>`
- Architecture / responsibility boundary: `vibepro check architecture <repo> --story-id <story-id>`
- PR readiness: `vibepro check pr-readiness <repo> --story-id <story-id> --base <ref> --head <ref>`
- Release or handoff readiness: `vibepro check launch-readiness <repo> --story-id <story-id>`
- Broad inspection: `vibepro check all <repo> --story-id <story-id>`

Package evidence is written to:

```text
.vibepro/checks/<pack>/<run-id>/check.json
.vibepro/checks/<pack>/<run-id>/check.md
```

## Performance Evidence

For a performance improvement claim, define Story-level metrics and record before/after runs. Do not rely only on ad hoc server logs or one-off E2E output.

Define metrics:

```bash
vibepro performance define <repo> \
  --id <story-id> \
  --metric-id <metric-id> \
  --user-story <text> \
  --start-condition <text> \
  --completion-condition <text> \
  --intermediate-marker <marker-id> \
  --timeout-ms <ms> \
  --evidence-source <server_log|browser_e2e|api_log|client_marker|manual_observation> \
  --readiness-kind <server_side|user_perceived|external_dependency|system_internal>
```

Record runs:

```bash
vibepro performance record <repo> \
  --id <story-id> \
  --metric-id <metric-id> \
  --label before \
  --status completed \
  --duration-ms <ms> \
  --marker <marker-id=ms> \
  --evidence-source <type:ref:summary>

vibepro performance record <repo> \
  --id <story-id> \
  --metric-id <metric-id> \
  --label after \
  --status completed \
  --duration-ms <ms> \
  --marker <marker-id=ms> \
  --evidence-source <type:ref:summary>
```

Compare:

```bash
vibepro performance compare <repo> --id <story-id>
```

Run evidence is written to:

```text
.vibepro/pr/<story-id>/performance-runs/*.json
```

## Performance Guardrails

- DB performance is included, but DB/server time and user-perceived time must be separate metrics.
- `server_side` examples: DB query completed, API handler completed, tmux/server readiness.
- `user_perceived` examples: button click to visible DOM, snapshot visible, input ready, interactive ready.
- Do not claim user-perceived improvement from `server_log` alone.
- Compare only runs with the same `metricId` and `completionCondition`.
- Keep incomplete runs as evidence: `blocked`, `needs_review`, `timeout`, `auth_required`, `resource_unavailable`, `unknown`.
- If comparison is not possible, report `改善率不明` and list the missing marker/evidence.

## Network Contract Guardrails

- When UI code introduces `fetch('/api/...')`, axios, or an API wrapper call, confirm the matching Next.js route exists.
- App Router route example: `/api/foo/bar` -> `src/app/api/foo/bar/route.ts`.
- Pages Router route example: `/api/foo/bar` -> `src/pages/api/foo/bar.ts`.
- If a direct server function / Server Action call is replaced by an HTTP API call, treat it as a contract change requiring route, schema, auth/runtime, and network-aware E2E evidence.
- In `vibepro verify flow`, API 4xx/5xx, API HTML responses, console/page errors, `Failed to fetch`, `Unexpected token '<'`, and visible loading failure text are Gate failures even when the UI appears to render.

## UI Interactive Contract Guardrails

- `vibepro check ui` must evaluate the screen at the level of visible interaction contracts, not only at the Story E2E level.
- Clickable-looking UI must have one of these outcomes: save/mutate, visible state change, navigation, scroll/focus movement, explicit disabled state, or an explicit unfinished state such as `準備中` / `coming soon`.
- Treat normal-looking placeholder buttons as findings when they only `console.log`, TODO, no-op, or have no `onClick` / `href` / submit / disabled / unfinished-state marker.
- Story E2E coverage is not enough when the changed screen has additional clickable-looking controls. Require a screen-level clickable element inventory for UI-heavy changes.
- For Playwright flow checks, click not only the main happy path but also controls that appear actionable: secondary buttons, detail links, icon buttons, tabs, menu triggers, AI/voice actions, and expandable rows.

## Review Checklist

Before saying VibePro confirmed the result:

- The package or performance command that produced the evidence is named.
- The evidence artifact path is included.
- The Story ID is correct.
- p50, p90, max, sample count, and incomplete rate are shown for performance comparisons.
- The answer separates internal readiness from user-perceived readiness.
- UI findings include whether clickable-looking controls have an interaction contract or are explicitly disabled/unfinished.
