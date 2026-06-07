# Onboarding Project Registration Architecture

## Decision

Add `brainbase onboard:projects` as a project-centered onboarding command. It turns user/agent interview answers into a deterministic registration plan and, with `--write`, promotes approved project context into local canonical SSOT.

## Boundaries

- The command does not connect to or read external providers. Mail, calendar, drive, task, and local-note references are stored as allowlist metadata only.
- Canonical writes require `--write`.
- Project data is stored in `graph.json` as a `project` entity with structured metadata.
- Project work context is appended to `personal-kg.jsonl`.
- Stakeholders are stored as `relationships.json` records and as person graph entities.
- Project-specific decision principles are appended to `decisions.jsonl`.

## Data Flow

1. Codex or Claude Code asks the user about active projects and permitted sources.
2. `onboard:projects` receives the approved interview fields.
3. Dry-run output shows the exact canonical writes that would happen.
4. After user approval, rerun with `--write`.
5. MCP tools read canonical files and return project context to future agent sessions.

## Modules

- `src/projects.ts`: parsing, deterministic project registration planning, markdown rendering, and canonical write payloads.
- `src/cli.ts`: `onboard:projects` command wiring and canonical writes.
- `src/tools.ts`: exposes structured project context in `get_context` and searchable metadata in `search`.

## Safety

- User answers are primary.
- External sources are optional supporting metadata.
- No provider reads happen in project registration.
- No canonical write happens without `--write`.
