# Onboarding Routine Registration Spec

## Invariants

- INV-1: `onboard:routines` must not write `graph.json`, `relationships.json`, `personal-kg.jsonl`, or `decisions.jsonl`.
- INV-2: Generation is deterministic; identical inputs yield byte-identical output, and routine ids and schedules are derived from inputs, not from the clock or randomness.
- INV-3: The command is dry-run by default; it writes a file only when `--out` is provided and never registers with a live scheduler.
- INV-4: Codex output is valid `automation.toml` with `kind = "cron"` and an RFC 5545 `rrule`; Claude output includes a 5-field cron expression plus the routine prompt.
- INV-5: Routine prompts are personal-scoped and must not contain Unson internal references (Slack workspaces, SNS ledger, NocoDB corporate boards, multi-account corporate operations).
- INV-6: Routine prompts must instruct against unconfirmed external side effects (no sending, publishing, calendar edits, or deletions without explicit confirmation).
- INV-7: ohayo and oyasumi are daily; retro is weekly with a configurable day-of-week.

## Scenarios

- S-1: `onboard:routines --target codex` emits three flat Codex automation TOML documents (ohayo, oyasumi, retro), each a per-file `automation.toml` with `kind = "cron"` and an `rrule`.
- S-2: `onboard:routines --target claude` emits three scheduled-task entries each with a cron expression and a prompt.
- S-3: `--routines ohayo,retro` emits only the ohayo and retro routines.
- S-4: `--ohayo-hour 7 --oyasumi-hour 22 --retro-dow FRI --retro-hour 17` is reflected in the rrule/cron of each routine.
- S-5: `--format json` emits deterministic machine-readable routine objects with stable ids.
- S-6: Every generated routine prompt references local Brainbase MCP context and contains no Unson internal references.

## Anti-Patterns

- AP-1: Writing into `~/.codex/automations`, launchd, cron, or any live scheduler from this command.
- AP-2: Emitting the internal Unson ohayo/oyasumi prompt (multi-account Slack, SNS ledger, corporate NocoDB) for a personal adopter.
- AP-3: Using `Date.now()` or randomness so output changes between identical runs.
- AP-4: Generating routine prompts that send, publish, edit calendars, or delete without explicit confirmation.

## Verification

- Unit tests cover routine selection, schedule-to-rrule and schedule-to-cron mapping, Codex/Claude serialization, determinism, and personal-scope guards.
- CLI tests cover `onboard:routines` for codex and claude targets and both markdown and json output.
- Acceptance E2E checks every story acceptance criterion against CLI output, including TOML/cron validity and the absence of Unson internal references.
