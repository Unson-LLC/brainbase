# Brainbase MCP-only Personal Onboarding Kit Spec

## Story

Replace `Unson-LLC/brainbase` with a UI-free, local-first MCP package that lets an individual create a personal SSOT and expose it to Codex, Claude, and CodeCode.

## Invariants

- INV-1: The package must be local-first and must not require hosted backends, Infisical, bb.unson.jp, Lightsail, or Unson internal data for v1.
- INV-2: MCP answers must prefer canonical local SSOT files over raw `sources/` materials.
- INV-3: Malformed canonical SSOT files must fail loudly.
- INV-4: Published package contents must exclude UI, session runtime, xterm, workflow, SNS operations, internal artifacts, and tests.

## Contracts

- C-1: The root package name is `@unson/brainbase-mcp`.
- C-2: The MCP binary is `brainbase-mcp`; the onboarding CLI binary is `brainbase`.
- C-3: Root scripts are limited to `build`, `test`, `start`, `doctor`, `onboard:init`, `onboard:seed`, and `onboard:install`.
- C-4: The default data directory is `~/.brainbase/personal-os/`, overridable through `BRAINBASE_PERSONAL_OS_DIR`.
- C-5: Canonical local SSOT files are `graph.json`, `personal-kg.jsonl`, `relationships.json`, and `decisions.jsonl`.
- C-6: v1 MCP tools are exactly `get_context`, `list_entities`, `search`, `search_personal_kg`, and `onboarding_status`.

## Scenarios

- S-1: `brainbase onboard:init` creates the minimum Personal OS directory and canonical files.
- S-2: `brainbase onboard:seed` updates self, work, and relationship context.
- S-3: `brainbase onboard:install --target codex|claude|codecode --dry-run` prints a valid client-specific MCP config: Codex TOML and Claude/CodeCode standard MCP JSON. `--output` writes a new snippet file and refuses to overwrite existing client config.
- S-4: `brainbase-mcp` starts over stdio and lists the v1 tools.
- S-5: `get_context` combines self, work, relationships, and decisions from canonical files.
- S-6: `search_personal_kg` searches only owner-local Personal KG entries.

## Anti-patterns

- AP-1: Do not reintroduce browser UI, public assets, session dashboards, xterm, launchd, workflow mission control, or SNS operations.
- AP-2: Do not silently use raw notes when canonical Personal KG exists.
- AP-3: Do not add secret requirements to the local MCP path.
- AP-4: Do not use VibePro implicit fallback as the only spec evidence.

## Verification

- V-1: `npm run build`
- V-2: `npm test`
- V-3: `npm pack --dry-run --json`
- V-4: `npm audit`
- V-5: `git diff --check`
- V-6: `cmp -s AGENTS.md CLAUDE.md`
- V-7: build artifact CLI smoke for `onboard:init`, `onboard:seed`, `onboard:install --dry-run`, and `doctor`.
- V-8: path tests cover default `~/.brainbase/personal-os`, `BRAINBASE_PERSONAL_OS_DIR`, and explicit `--dir` precedence.
- V-9: fail-loud tests cover malformed canonical JSON/JSONL files and unsupported CLI inputs.
