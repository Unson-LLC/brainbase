# Brainbase Personal Onboarding Kit MCP-only Repo

## Background

`Unson-LLC/brainbase` is the external distribution repository for Brainbase Personal Onboarding Kit. The internal UI, session runtime, workflow operation, 31013 runtime, SNS operations, and Unson-specific data remain in `brainbase-unson`.

The v1 product value is giving an individual a local personal SSOT that AI tools can access through MCP.

## Acceptance Criteria

1. The root package is `@unson/brainbase-mcp`, with `brainbase-mcp` for stdio MCP and `brainbase` for onboarding CLI.
2. The repository contains no browser UI, session dashboard, xterm transport, launchd runtime, workflow mission control, SNS operation flow, hosted backend implementation, or Unson internal data.
3. The v1 MCP tool surface is fixed to `get_context`, `list_entities`, `search`, `search_personal_kg`, and `onboarding_status`.
4. The default local SSOT directory is `~/.brainbase/personal-os/`, overridable with `BRAINBASE_PERSONAL_OS_DIR`.
5. The canonical local SSOT files are `graph.json`, `personal-kg.jsonl`, `relationships.json`, and `decisions.jsonl`.
6. Raw notes, logs, and meeting transcripts can exist under `sources/`, but MCP responses prefer canonical SSOT data.
7. `brainbase onboard:init` creates the minimum local SSOT structure.
8. `brainbase onboard:seed` can seed self, work, and relationship context.
9. `brainbase onboard:install --target codex|claude|codecode --dry-run` emits a launchable client-specific MCP config without requiring users to guess a global binary path: Codex gets TOML, Claude and CodeCode get standard MCP JSON.
10. Local MCP mode requires no secrets, Infisical, bb.unson.jp, Lightsail, AWS credentials, or hosted backend.
11. The package tarball excludes UI/internal artifacts, raw personal data, VibePro workbench files, and tests.

## Verification

- `npm run build`
- `npm test`
- `npm audit`
- `npm pack --dry-run --json`
- `git diff --check`
- `cmp -s AGENTS.md CLAUDE.md`
- Build artifact CLI smoke for `onboard:init`, `onboard:seed`, `onboard:install --dry-run`, and `doctor`.
