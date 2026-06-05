# Onboarding Routine Registration Architecture

## Decision

Onboarding completes the operating loop by generating recurring routine definitions, mirroring how `onboard:install` generates MCP client config. Brainbase produces the routine definition; the user's coding agent registers it with its own scheduler.

- `onboard:routines` builds personal-scoped ohayo / oyasumi / retro routines from deterministic templates and schedule options.
- Output is agent-targeted: Codex `automation.toml` (cron kind + rrule) or Claude Code scheduled-task JSON (cron expression + prompt).
- Brainbase does not write into `~/.codex/automations`, launchd, or any live scheduler. It prints the definition or writes a single requested file, like `onboard:install`.

## Boundaries

- Routine prompts are personal-scoped to the adopter's own connected sources and local Brainbase MCP context.
- Routine prompts never reference Unson internal Slack workspaces, the SNS ledger, NocoDB corporate boards, or multi-account corporate operations. Those belong to the internal `brainbase-unson` system.
- Generation is deterministic: routine ids and schedules are derived from inputs, not from the clock or randomness.
- The command never writes canonical SSOT (`graph.json`, `relationships.json`, `personal-kg.jsonl`, `decisions.jsonl`).

## Data Flow

1. The onboarding interview already establishes which coding agent the user runs and their timezone and preferred hours.
2. `onboard:routines --target <agent>` builds the selected routine definitions from templates and schedule options.
3. The command prints the definitions (dry-run) or writes one file when `--out` is given.
4. The user or agent registers the printed definition with the agent's scheduler (Codex automation import or Claude Code scheduled task).
5. At each scheduled time the routine runs against the user's local Brainbase MCP context and own sources.

## Modules

- `src/routines.ts`: pure routine templates, schedule modeling, rrule/cron rendering, and Codex/Claude serialization.
- `src/cli.ts`: thin `onboard:routines` command wiring.

## Safety

- Personal scope only; no corporate operations leak into a personal routine.
- Routine prompts forbid unconfirmed external side effects (no sends, publishes, calendar edits, or deletes).
- Generation-only and dry-run by default; canonical SSOT is never written.
