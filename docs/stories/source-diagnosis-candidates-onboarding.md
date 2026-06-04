# Source Diagnosis and Candidate Onboarding

## Story

As an individual adopting Brainbase MCP through Codex, Claude Code, or CodeCode, I want the agent-assisted onboarding flow to diagnose my mail, calendar, drive, and task source setup and draft reviewed candidates before canonical writes, so that I can get value from real work context without pasting secrets or accidentally promoting raw source data.

## Requirement Sources

- specification: docs/specs/source-diagnosis-candidates-onboarding-spec.md
- architecture: docs/architecture/source-diagnosis-candidates-onboarding.md

## Acceptance Criteria

- README explains that the coding agent should run an interview, source diagnosis, candidate drafting, and only then canonical seed promotion.
- `brainbase onboard:diagnose-sources` accepts `--email`, `--calendar`, `--drive`, and `--tasks` answers and returns provider-specific local readiness.
- Gmail, Google Calendar, and Google Drive diagnosis requires GoG-style metadata-first collection; Drive diagnosis requires an explicit folder allowlist.
- Missing local GoG tooling is reported as `needs_setup`, not as a successful import path.
- Task diagnosis covers Notion, Todoist, Linear, GitHub Issues, NocoDB, CSV/manual, and `none` without asking for secrets in chat.
- `brainbase onboard:candidates` turns agent interview answers into candidate records under `candidates/` without writing canonical SSOT files.
- Candidate output supports markdown and JSON and includes explicit review/promote next steps.
- `brainbase doctor` still reports missing canonical seed areas until the user promotes candidates with `onboard:seed` or an equivalent reviewed flow.

## Non-goals

- Do not implement hosted sync, Infisical, bb.unson.jp, or Unson internal APIs.
- Do not read Gmail, Calendar, Drive, or task source content directly in Brainbase v1.
- Do not auto-promote raw source data or candidates into canonical SSOT.
