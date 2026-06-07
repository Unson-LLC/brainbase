# Source Diagnosis and Candidate Onboarding Architecture

## Decision

Brainbase keeps agent-assisted onboarding local and deterministic. Codex, Claude Code, or CodeCode performs the conversational interview, while Brainbase owns two CLI surfaces:

- source diagnosis: deterministic provider guidance, local readiness, and safe collection targets under `sources/`.
- candidate drafting: reviewable facts under `candidates/`, with no canonical writes.

## Boundaries

- Brainbase v1 does not authenticate to Gmail, Google Calendar, Google Drive, Notion, or task systems.
- GoG, Notion MCP, exports, and other connectors remain external collectors.
- Brainbase returns setup commands and staging targets; it does not run provider imports.
- Candidate files are secondary material until the user explicitly promotes them.

## Data Flow

1. After the first value demo, the coding agent asks the user about mail, calendar, drive/docs, tasks, permissions, and review scope.
2. The agent calls `onboard:diagnose-sources` with the answers.
3. The diagnosis tells the agent which local collector is needed and which `sources/` path should receive metadata-first output.
4. The agent calls `onboard:candidates` with approved interview facts.
5. Brainbase writes optional candidate JSON under `candidates/`.
6. The user reviews candidates and then runs `onboard:seed` or a future explicit promotion command.

## Safety

- No command asks for secrets in chat.
- Drive collection is folder allowlist based.
- Canonical MCP context remains `graph.json`, `personal-kg.jsonl`, `relationships.json`, and `decisions.jsonl`.
