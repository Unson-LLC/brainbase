# Agent-assisted source onboarding

## Story

As an individual adopting Brainbase MCP through Codex, Claude Code, or CodeCode, I want the AI agent to reach a first value demo from approved local facts, then recommend safe local import paths for optional source expansion so that Brainbase can build my Personal OS from real work context without requiring a hosted backend or UI.

## User Value

The first useful Brainbase moment should not be source setup. It should be:

1. The agent asks what I do not want to explain repeatedly.
2. The agent gets approval for the smallest canonical facts.
3. Brainbase runs a first value demo from local SSOT.
4. Brainbase recommends the right local connector or export path only after that demo.
5. Raw source material is staged under `sources/`.
6. Candidate facts are reviewed before becoming canonical SSOT.
7. Codex / Claude Code can read the approved context through MCP.

## Requirement Sources

- specification: docs/specs/agent-assisted-source-onboarding-spec.md
- architecture: docs/architecture/agent-assisted-source-onboarding.md

## Scope

In scope for this story:

- Add an `onboard:agent` command that prints a value-first Codex / Claude Code onboarding protocol.
- Add an `onboard:recommend` command that maps interview answers to safe local connector recommendations.
- Add an `onboard:demo` command that proves canonical context before source setup.
- Cover mail, calendar, drive/docs, and task management tools.
- Make `onboard:init` create source-specific raw source directories and a candidate staging directory.
- Document that Gmail / Google Calendar / Google Drive should use GoG-style local read-only collection when available.
- Keep raw source material separate from canonical files.

Out of scope for this story:

- OAuth flows.
- Hosted backend sync.
- Infisical-managed secrets.
- Automatic Gmail / Calendar / Drive / task API import.
- UI.
- Automatic promotion from raw source material to canonical SSOT.

## Acceptance Criteria

- `brainbase onboard:agent` outputs a reusable agent prompt that starts with the repeated context the user wants Brainbase to remember.
- `brainbase onboard:agent --format json` returns structured interview sections for value target, hypothesis, approval, minimum seed, first value demo, and optional sources.
- `brainbase onboard:demo` proves canonical context before source diagnosis.
- `brainbase onboard:recommend` accepts tool answers for `--email`, `--calendar`, `--drive`, and `--tasks`.
- Gmail, Google Calendar, and Google Drive answers recommend local GoG-style collection with metadata-first source staging.
- Notion, Todoist, Linear, GitHub Issues, NocoDB, CSV/manual, and `none` task answers produce deterministic recommendations.
- Recommendations always keep imported material in `sources/` and require approval before canonical SSOT writes.
- `onboard:init` creates `sources/gmail`, `sources/calendar`, `sources/drive`, `sources/tasks`, and `candidates` without increasing raw source counts before files exist.
- README explains the agent-assisted first value demo path before the manual seed path and before source diagnosis.

## Safety Rules

- Do not ask the user to paste OAuth tokens or secrets into chat.
- Do not write external service credentials into Brainbase canonical files.
- Do not use raw email, calendar, drive, or task content as normal MCP context until a reviewed candidate has been promoted.
- Prefer metadata-first import. Body excerpts require explicit user approval.
- Drive import must be folder allowlist based.
