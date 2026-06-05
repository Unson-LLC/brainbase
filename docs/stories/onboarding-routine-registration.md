# Onboarding Routine Registration

## Background

The onboarding kit now loads personal context once (import -> extract -> apply), but it never sets up the recurring operating cadence. The reference setup runs a daily morning input routine (ohayo), a daily end-of-day routine (oyasumi), and a weekly retrospective (retro); ohayo and oyasumi are registered as Codex cron automations while retro is not auto-registered anywhere. As a first personal Brainbase adopter running an always-on local agent host, I want onboarding to generate personal-scoped ohayo, oyasumi, and retro routine definitions for whichever coding agent I use, so the daily loop is part of onboarding instead of a one-time data load. The generated routines must be scoped to my own connected sources and local Brainbase MCP context, not the internal Unson multi-account operations.

## Acceptance Criteria

- `brainbase onboard:routines` generates personal-scoped ohayo, oyasumi, and retro routine definitions, and `--routines` can select a subset.
- The command targets the user's coding agent: `--target codex` emits Codex `automation.toml` content and `--target claude` emits a Claude Code scheduled-task definition.
- Each routine carries a schedule: ohayo and oyasumi are daily and retro is weekly, with configurable hour, minute, and retro day-of-week.
- Codex output is valid `automation.toml` with `kind = "cron"`, an RFC 5545 `rrule`, and a personal-scoped prompt; Claude output includes a cron expression and the same personal-scoped prompt.
- Routine prompts are personal-scoped: they reference the local Brainbase MCP context and the user's own calendar, mail, tasks, and notes, and they must not reference Unson internal Slack workspaces, SNS ledger, or multi-account corporate operations.
- Routine prompts keep external side effects safe: they do not send messages, publish, modify calendars, or delete records without explicit confirmation.
- The command is generation-only and dry-run by default: it prints definitions and writes a file only when `--out` is provided, and it never writes canonical SSOT.
- JSON and markdown output are deterministic, including stable routine ids and schedules.
