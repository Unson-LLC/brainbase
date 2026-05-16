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

- UI quality / user flow: `vibepro check ui <repo> --story-id <story-id>`
- Security / auth / exposed surface: `vibepro check security <repo> --story-id <story-id>`
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

## Review Checklist

Before saying VibePro confirmed the result:

- The package or performance command that produced the evidence is named.
- The evidence artifact path is included.
- The Story ID is correct.
- p50, p90, max, sample count, and incomplete rate are shown for performance comparisons.
- The answer separates internal readiness from user-perceived readiness.
