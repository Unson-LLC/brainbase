---
name: verify-brainbase
description: Drive Brainbase's local CLI and real stdio MCP server with disposable synthetic data; use before reviewing local onboarding, memory readback, or MCP configuration preview changes.
---

# Verify local Brainbase

This skill verifies a bounded local product journey, not onboarding completion or an automatic-merge approval. Read [the feature map](features/README.md) first. Never use production, staging, real personal data, organization settings, or an existing agent configuration.

## Launch

Run from the repository root with Node.js and npm. The repository builds with `npm run build`; use Node 22 for the CI baseline. The first proof used Node 24.22.1 on Linux, so Node 22 and other operating systems remain unverified by that proof.

```bash
npm ci --ignore-scripts --no-audit --no-fund
mkdir -p ../verification-evidence
node .cursor/skills/verify-brainbase/scripts/verify.mjs ../verification-evidence/run-001 <EXPECTED_FULL_HEAD_SHA>
```

`run-001` must not exist. Use a new directory for every attempt. Install and build outputs stay in the checkout; remove them in Cleanup. This avoids leaving node_modules on an inode-constrained host. No credentials, database service, browser, or TCP port is needed. Dependency installation accesses the npm registry; the product journey uses only local CLI processes and stdio.

The helper checks the expected full head SHA and requires `git status --porcelain` to be empty, then runs `npm run build` itself. Evidence must be outside the checkout. It records the build output and checks the working tree again before driving the product.

The helper creates a unique `.verify-brainbase-*` directory in the OS temporary directory and initializes it through `node dist/cli.js onboard:init --dir <owned-directory>`. Readiness is a successful `doctor` with `localBackend.connected: true`, followed by a successful seed and persisted readback. A cold data directory alone is not seeded readiness. The CLI is noninteractive; each invocation is a fresh child process with captured stdout, stderr, and exit status. The MCP server is a fresh child connected through the public SDK's stdio transport. There is no shared session or persistent server to attach to.

## Doctor

The helper first records the Git head, Node version, checkout, data directory, and child environment keys in `identity.json`, then runs the real read-only command:

```bash
node dist/cli.js doctor --dir <owned-directory>
```

The exact directory and result are in `actions.json` and `doctor.json`. Require exit 0 and `localBackend.connected: true`. The CLI child environment contains only PATH, LANG, BRAINBASE_PERSONAL_OS_DIR, and BRAINBASE_PERSONAL_KNOWLEDGE_MODE=local. The MCP SDK also inherits its standard OS variables such as HOME, USER, and SHELL. Both environment key lists are recorded; provider credentials and organization configuration are not inherited. The helper passes its owned directory explicitly to CLI commands. MCP receives the same directory through the environment. Do not remove a doctor failure or replace it with a health-only check.

## Drive

The executable helper is `scripts/verify.mjs`; its complete invocation appears in Launch. It drives all three mapped journeys in order:

1. [Seed and list local memories](features/cli-seed.md) with the actual CLI and file readback.
2. [Preview the Codex MCP configuration](features/install-preview.md) with a before/after directory manifest.
3. [Read local context through MCP](features/mcp-readback.md) with `tools/list` and `tools/call` against `dist/index.js`.

It calls public commands and tools, never application internals, fixture writers, or test-only endpoints. The seed values are fixed synthetic strings. Assertions fail on missing prerequisites or unexpected results. One mapped journey is enough for the skill generator's initial proof; this helper checks all three. Changes to Graph retrieval, Web UI, imports, or agent-first-value behavior need their own mapped journeys before this skill can verify them.

## Evidence

The requested evidence directory survives teardown, including failed attempts:

- `identity.json`: Git head, Node version, paths, and environment keys.
- `actions.json`: commands, arguments, stdout, stderr, exit codes, MCP requests and responses.
- `doctor.json`, `memories.json`, `persisted-files.json`: usable local backend, visible memories, and persisted file hashes.
- `install-preview.json`: preview output and equal before/after manifests. The supplied output path must remain absent. This proves file behavior, not a general guarantee about every dry-run command.
- `mcp-stderr.json`: real server stderr.
- `result.json`: PASS or FAIL, cleanup status, covered features, and unverified surfaces.
- `failure.json`: failure message and stack, when a journey fails.

Require process exit 0, result PASS, cleanup true, and the expected user-visible values in the trace. Supply the PR head as the second argument; rerun after any head change. A successful build or a ready flag is insufficient. The read-only MCP calls must leave canonical file hashes unchanged. Inspect both the action and resulting state. No production boundary is mocked. No claim is made about actual agent value, network-wide egress monitoring, or full product coverage.

## Cleanup

The helper closes only its own MCP client and child transport in `finally`, then removes only its unique scratch directory. It also does so on assertion failure, SIGINT, and SIGTERM. SIGKILL cannot be caught; after a forced kill, inspect the data path in identity.json and remove only that run's temporary directory and child process. It never kills by process name. Inspect `result.json` and confirm the evidence directory still contains the trace after the run.

After reviewing the evidence, remove only install/build outputs created by this run:

```bash
rm -rf node_modules dist
```

Do this only when this run created those directories in an initially clean checkout. Do not delete pre-existing user build outputs. Check `git status --short` and confirm no `.verify-brainbase-*` directory remains. Keep the evidence directory. Simultaneous runs require separate clean checkouts and evidence directories because dependency/build outputs are shared within one checkout.

## Helpers

`scripts/verify.mjs` is executable and accepts a new evidence directory and the expected full head SHA. It does not install dependencies, publish, merge, change host configuration, or register scheduled tasks. Maintain this map with `/maintain-verification-skill` when routes, commands, or tool contracts change.

Claude Code does not auto-discover `.cursor/skills/`. Ask it to read `.cursor/skills/verify-brainbase/SKILL.md` explicitly, then follow Launch from the repository root.
