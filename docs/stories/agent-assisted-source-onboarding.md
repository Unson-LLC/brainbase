# Agent-assisted source onboarding

## Story

As an individual adopting Brainbase MCP through Codex, Claude Code, or CodeCode, I want the AI agent to interview me about my mail, calendar, task, and drive tools, then recommend a safe local import path so that Brainbase can build my Personal OS from real work context without requiring a hosted backend or UI.

## User Value

The first useful Brainbase moment should not be hand-writing a seed command. It should be:

1. The agent asks which tools I already use.
2. Brainbase recommends the right local connector or export path.
3. Raw source material is staged under `sources/`.
4. Candidate facts are reviewed before becoming canonical SSOT.
5. Codex / Claude Code can read the approved context through MCP.

## Requirement Sources

- specification: docs/specs/agent-assisted-source-onboarding-spec.md
- architecture: docs/architecture/agent-assisted-source-onboarding.md

## Scope

In scope for this story:

- Add an `onboard:agent` command that prints a Codex / Claude Code onboarding protocol.
- Add an `onboard:recommend` command that maps interview answers to safe local connector recommendations.
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

- `brainbase onboard:agent` outputs a reusable agent prompt that tells Codex / Claude Code what to ask and what not to do.
- `brainbase onboard:agent --format json` returns structured interview sections for mail, calendar, drive/docs, tasks, permissions, and approval.
- `brainbase onboard:recommend` accepts tool answers for `--email`, `--calendar`, `--drive`, and `--tasks`.
- Gmail, Google Calendar, and Google Drive answers recommend local GoG-style collection with metadata-first source staging.
- Notion, Todoist, Linear, GitHub Issues, NocoDB, CSV/manual, and `none` task answers produce deterministic recommendations.
- Recommendations always keep imported material in `sources/` and require approval before canonical SSOT writes.
- `onboard:init` creates `sources/gmail`, `sources/calendar`, `sources/drive`, `sources/tasks`, and `candidates` without increasing raw source counts before files exist.
- README explains the agent-assisted onboarding path before the manual seed path.

## Safety Rules

- Do not ask the user to paste OAuth tokens or secrets into chat.
- Do not write external service credentials into Brainbase canonical files.
- Do not use raw email, calendar, drive, or task content as normal MCP context until a reviewed candidate has been promoted.
- Prefer metadata-first import. Body excerpts require explicit user approval.
- Drive import must be folder allowlist based.
