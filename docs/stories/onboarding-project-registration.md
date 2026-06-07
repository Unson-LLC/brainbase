# Onboarding Project Registration

## Background

Brainbase onboarding can seed a project name and can infer project candidates from sources, but it does not yet give Codex or Claude Code a project-centered registration flow. The intended onboarding premise is agent-assisted: a coding agent interviews the user first, then optionally uses allowed mail, calendar, drive, task, or local-note sources as supporting material. Project registration must work from user answers alone, and source-derived details must remain review material until explicitly approved.

## Acceptance Criteria

- `brainbase onboard:projects` registers project context from user/agent interview answers without requiring any connected external source.
- The command captures project name, goal, current status, the user's role, stakeholders, source allowlists, task sources, and project-specific decision principles.
- The command is dry-run by default and writes canonical SSOT only with `--write`.
- Source references are metadata only. The command never reads mail, calendar, drive, task, or local-note content.
- Stakeholders can be linked to the project as relationship context only after explicit `--write`.
- Project-specific decision principles can be promoted into `decisions.jsonl` only after explicit `--write`.
- `get_context`, `list_entities`, and `search` can return registered project context from canonical files after `--write`.
- `onboard:agent`, README, and generated onboarding skills mention project registration as part of the agent-assisted onboarding flow.
- JSON and markdown output are deterministic for identical inputs, except canonical `updatedAt` timestamps when writing.
