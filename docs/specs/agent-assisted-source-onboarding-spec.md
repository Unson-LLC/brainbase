# Agent-assisted Source Onboarding Spec

## Objective

Provide a UI-free onboarding protocol where Codex, Claude Code, or CodeCode interviews the user about existing work tools and Brainbase returns safe local connector recommendations. The package remains a local MCP onboarding kit.

## Commands

### `brainbase onboard:agent [--format markdown|json]`

Outputs an agent-facing onboarding protocol.

The protocol must include:

- Goal: build a local Personal OS for MCP clients.
- Interview questions for mail, calendar, drive/docs, task management, active projects, key relationships, and decision principles.
- Safety boundaries: read-only collection, no secrets in chat, raw sources are secondary material, approval before canonical writes.
- Suggested next commands: `onboard:init`, `onboard:recommend`, `onboard:install`, `doctor`.

### `brainbase onboard:recommend`

Inputs:

- `--email <tool>`
- `--calendar <tool>`
- `--drive <tool>`
- `--tasks <tool>`
- `--format markdown|json`

Outputs deterministic recommendations with:

- area: `email | calendar | drive | tasks`
- input
- recommendation
- source path
- import mode
- setup hints
- safety notes

## Connector Rules

- Gmail and Google Workspace mail recommend local GoG-style Gmail collection.
- Google Calendar recommends local GoG-style calendar collection.
- Google Drive / Google Docs recommend local GoG Drive collection with folder allowlists and metadata-first import.
- Outlook / Microsoft 365 recommend Microsoft Graph or export-based collection as a future connector path.
- Apple Mail / Apple Calendar recommend export/manual import as a future connector path.
- Notion tasks recommend Notion MCP or Notion export.
- Todoist tasks recommend Todoist API/export.
- Linear tasks recommend Linear MCP.
- GitHub Issues recommend GitHub connector or issue export.
- NocoDB tasks recommend NocoDB MCP/API.
- CSV/manual and `none` must be valid deterministic task recommendations.

## Local Data Layout

`onboard:init` must create:

```text
sources/
  gmail/
  calendar/
  drive/
  tasks/
candidates/
schemas/
graph.json
personal-kg.jsonl
relationships.json
decisions.jsonl
```

Empty source subdirectories are not raw source records. `rawSources` counts files only.

## Canonicalization Boundary

The normal MCP tools prefer canonical SSOT:

- `graph.json`
- `personal-kg.jsonl`
- `relationships.json`
- `decisions.jsonl`

External tool imports are secondary material under `sources/`. Candidate extraction and approval are future workflow steps unless explicitly implemented by the current command.

## Non-goals

- No OAuth implementation in this story.
- No hosted backend.
- No Infisical requirement.
- No UI.
- No automatic canonical promotion from raw sources.
