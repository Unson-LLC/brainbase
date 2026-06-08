# Onboarding Operationalization Next Actions Spec

## Invariants

- INV-1: First value demo readiness is not an onboarding completion signal unless the remaining operationalization actions are shown to the user.
- INV-2: Operationalization actions remain local-first and do not write live MCP config, scheduler entries, or canonical source facts by default.
- INV-3: The required unfinished actions are public skills placement, ohayo / oyasumi / retro routine registration, real MCP config merge, source allowlist / import / candidate review decision, and doctor plus MCP `get_context` / `search` verification.
- INV-4: Source setup remains optional follow-up after first value, but it must be explicitly completed or deferred.

## Contracts

- C-1: `brainbase onboard:demo --format json` returns `operationalization.pending[]` with action IDs `public-skills`, `routines`, `mcp-config`, `source-allowlist`, and `verification`.
- C-2: Markdown `brainbase onboard:demo` renders `## Operationalization Still Pending` with completed items, next actions, and recommended order.
- C-3: `brainbase onboard:start --format json` returns `operationalization` and `nextCommands` entries for `skills`, `routines`, `install`, and `doctor`.
- C-4: `brainbase doctor` returns `operationalization.pending[]` with the same action IDs as the first value demo.
- C-5: AGENTS.md, CLAUDE.md, and README.md instruct agents/users to report skills/routines/MCP/source-review work as unfinished operationalization, not as implied completion.
- C-6: `brainbase onboard:agent` JSON and Markdown output include the operationalization commands and completion-report guidance.

## Scenarios

- S-1: After minimum seed, `onboard:demo --format json` is ready and still reports the operationalization pending actions.
- S-2: After minimum seed, Markdown `onboard:demo` shows the operationalization section after the first value output.
- S-3: `onboard:start --format json` puts the operationalization commands after the first value demo and before optional source diagnosis.
- S-4: `doctor` reports value demo readiness and operationalization as separate sections.
- S-5: Agent instruction files, README.md, and the `onboard:agent` protocol state that commands existing in the product are insufficient unless the user sees the remaining operationalization actions.

## Anti-Patterns

- AP-1: Treating `ready=true`, `first_value_demo_ready`, or `doctor.valueDemo.ready` as final completion without pending operationalization actions.
- AP-2: Registering live schedules or modifying live MCP config from onboarding output without user approval.
- AP-3: Presenting source imports as required before the first value demo.

## Verification

- Unit tests cover JSON and Markdown output from `onboard:demo`, JSON output from `onboard:start`, `doctor`, the `onboard:agent` protocol, README operationalization guidance, and repo instruction hygiene.
- Build and package dry-run confirm the new source module is included through the normal TypeScript build.
