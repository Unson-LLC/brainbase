# Google Workspace Local Onboarding Spec

## Invariants

- INV-1: `onboard:plan` is a planning command only; it must not write `graph.json`, `relationships.json`, `personal-kg.jsonl`, or `decisions.jsonl`.
- INV-2: A local runtime host (for example `--host mac-mini`) is a planning target only. It is not a hosted Brainbase backend, server operation handoff, or sync authority.
- INV-3: Google Workspace and Gmail source collection must stay metadata-first and read-only in the first pass.
- INV-4: Google Drive collection requires at least one explicit Drive folder id before it can be ready.
- INV-5: Local file collection requires explicit local folder allowlists and must not suggest scanning a whole home directory.
- INV-6: Inactive task tools (for example Notion recorded via `--inactive-task-tool`) are inactive context, not required connectors.
- INV-7: Calendar and notes task fragments are candidate extraction inputs only until reviewed.

## Scenarios

- S-1: Given Workspace mail plus an optional secondary Gmail account, the plan lists both when configured and asks GoG to authenticate/read metadata for Gmail services.
- S-2: Given Google Drive without a folder id, the plan marks Drive allowlist as required input.
- S-3: Given `--local-folder ~/Notes`, the plan accepts the folder as an allowlist candidate and still requires review before extraction.
- S-4: Given `--tasks scattered-calendar-notes --inactive-task-tool notion`, the plan recommends Calendar and local notes candidate extraction and marks the inactive tool (for example Notion) inactive.
- S-5: Given `--format json`, the plan is machine-readable with deterministic arrays for setup steps, next commands, and safety rules.

## Anti-Patterns

- AP-1: Treating a local runtime host (for example a Mac mini) as a hosted backend managed by Brainbase v1.
- AP-2: Asking the user to paste OAuth tokens or refresh tokens into chat.
- AP-3: Importing all mail bodies, all Drive files, or all local files before metadata review.
- AP-4: Promoting scattered task fragments directly into canonical SSOT.

## Verification

- Unit and CLI tests cover JSON and markdown output for the Google Workspace local profile.
- Acceptance E2E checks every story acceptance criterion against the CLI output and README.
