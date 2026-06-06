# Onboarding Skills Installer Architecture

## Decision

Brainbase ships a small built-in public skill set as TypeScript templates and exposes it through `brainbase onboard:skills`. The command generates portable `SKILL.md` files for the user's coding agent. It does not copy internal skills and does not mutate live agent configuration.

## Boundaries

- Public skills are personal-scoped only. They support a local Brainbase MCP server, local personal SSOT, source import, candidate review, and daily routines.
- Internal Brainbase operations stay out of this package. Skills must not mention Unson internal Slack workspaces, SNS ledger, NocoDB corporate boards, VibePro, hosted backend operations, Infisical, Lightsail, or server operations.
- The command is generation-only by default. `--out` writes portable skill files into a chosen directory and refuses to overwrite.
- Canonical SSOT is never read or written by `onboard:skills`.

## Data Flow

1. The user chooses a target agent (`codex`, `claude`, or `portable`) and optionally selects a skill subset.
2. `src/skills.ts` builds a deterministic manifest and portable skill files.
3. `src/cli.ts` prints markdown or JSON output.
4. When `--out <dir>` is provided, the CLI writes `<dir>/<skill-id>/SKILL.md` for each selected skill.
5. The user or coding agent copies or points the generated files into the agent's configured skill directory.

## Modules

- `src/skills.ts`: skill definitions, target path mapping, safety checks, renderers, and file-plan generation.
- `src/cli.ts`: `onboard:skills` command wiring and filesystem writes.

## Safety

- No secrets in chat.
- No direct live config mutation.
- No canonical SSOT mutation.
- No internal operations leakage.
