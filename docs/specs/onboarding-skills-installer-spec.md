# Onboarding Skills Installer Spec

## Invariants

- INV-1: `onboard:skills` must not write `graph.json`, `relationships.json`, `personal-kg.jsonl`, or `decisions.jsonl`.
- INV-2: Generation is deterministic; identical inputs yield byte-identical output, and skill order is stable.
- INV-3: The command is dry-run by default; it writes files only when `--out <dir>` is provided.
- INV-4: Existing `SKILL.md` files are never overwritten.
- INV-5: Skill content is public-safe and must not contain Unson internal references: Slack workspaces, SNS ledger, NocoDB corporate boards, VibePro, hosted backend operations, Infisical, Lightsail, or server operations.
- INV-6: Every skill must forbid asking the user to paste OAuth tokens, passwords, API keys, or refresh tokens into chat.
- INV-7: Skill files use portable `SKILL.md` frontmatter with stable `name` and `description` fields.

## Scenarios

- S-1: `onboard:skills --target codex` emits all four public Brainbase skills with recommended paths under a Codex-compatible skills directory.
- S-2: `onboard:skills --target claude` emits the same skills with recommended paths under `.claude/skills`.
- S-3: `onboard:skills --target portable` emits the same skills under a portable `skills/` directory.
- S-4: `--skills brainbase-source-import,brainbase-candidate-review` emits only those skills in canonical order.
- S-5: `--out <dir>` writes `<dir>/<skill-id>/SKILL.md` for selected skills and reports written files.
- S-6: Re-running `--out <dir>` against an existing skill fails loudly instead of overwriting.
- S-7: `--format json` emits deterministic structured manifest data and skill file contents.

## Anti-Patterns

- AP-1: Copying internal `brainbase-unson` skills into the public package.
- AP-2: Installing directly into live Codex, Claude Code, MCP, cron, launchd, or scheduler configuration.
- AP-3: Mentioning Unson internal operations, hosted backend operations, Infisical, VibePro, Slack workspaces, SNS ledger, or NocoDB corporate boards in public skills.
- AP-4: Treating raw source material as canonical memory before candidate review.
- AP-5: Asking the user to paste secrets into chat.

## Verification

- Unit tests cover skill selection, target path rendering, determinism, public-safety banned-word checks, overwrite refusal, and JSON/markdown serialization.
- Acceptance E2E checks every story acceptance criterion against CLI output and filesystem writes.
- Repo hygiene runs `npm run build`, `npm test`, and `npm pack --dry-run`.
