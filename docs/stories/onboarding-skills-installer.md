# Onboarding Skills Installer

## Background

Brainbase Personal Onboarding Kit now installs the MCP server, helps collect local sources, extracts review candidates, and generates recurring routines. But a first adopter using Codex or Claude Code still needs reusable agent instructions for how to run this safely. The current internal Brainbase skills include Unson-only operations and must not be copied into the public kit. Public onboarding needs a small, personal-scoped skill set that teaches the coding agent how to interview, import sources, review candidates, and run daily routines without leaking internal operations or requiring hosted services.

## Acceptance Criteria

- `brainbase onboard:skills` exposes the built-in public Brainbase skill set: `brainbase-personal-onboarding`, `brainbase-source-import`, `brainbase-candidate-review`, and `brainbase-daily-routines`.
- The command targets the user's coding agent: `--target codex`, `--target claude`, or `--target portable` changes the recommended install paths while keeping skill content portable `SKILL.md`.
- The command is dry-run by default: it prints a manifest and file contents, writes files only when `--out <dir>` is provided, and refuses to overwrite existing `SKILL.md` files.
- `--skills <id,id>` can select a deterministic subset while rejecting unknown skill ids loudly.
- Generated skills are public-safe and personal-scoped: they reference local Brainbase MCP, local SSOT, metadata-first source collection, review candidates, and routines, and they must not reference Unson internal Slack workspaces, SNS ledger, NocoDB corporate boards, VibePro, hosted backend operations, Infisical, or server operations.
- Generated skills must tell agents not to ask users to paste OAuth tokens, passwords, API keys, or refresh tokens into chat.
- The command never writes canonical SSOT files and never changes live MCP/client/scheduler configuration.
- JSON and markdown output are deterministic, including skill order, file paths, and content.
