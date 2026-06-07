# Contributing to Brainbase MCP

Brainbase MCP v1 is a local-first personal onboarding kit. Keep contributions focused on the MCP server, onboarding CLI, local SSOT schemas, tests, and public documentation.

This repository does not contain the internal Brainbase UI, session runtime, workflow mission control, social operations, hosted backend, Infisical setup, or Unson internal data.

## Development Workflow

1. Read the relevant source, tests, and docs before editing.
2. Make the smallest change that satisfies the issue or pull request.
3. Add or update tests for changed behavior.
4. Run the required verification commands.
5. Submit a focused pull request with a clear summary and test evidence.

## Required Checks

Run these before opening or merging a pull request:

```bash
npm run build
npm test
npm audit
npm pack --dry-run --json
```

Use targeted tests while iterating:

```bash
npm test -- tests/cli.test.ts
npm test -- tests/tools.test.ts
```

## Repository Hygiene

Do not commit:

- Personal SSOT data from `~/.brainbase/personal-os/` or any `BRAINBASE_PERSONAL_OS_DIR`.
- Raw meeting notes, logs, transcripts, or private source material.
- UI artifacts, internal workflow/runtime files, or Unson-specific operational data.
- Secrets, tokens, local env files, `.vibepro/`, `dist/`, `node_modules/`, or coverage output.

`npm pack --dry-run --json` should only include the runtime package and public docs.

## Architecture

The v1 package exposes:

- `brainbase-mcp`: stdio MCP server.
- `brainbase`: onboarding and doctor CLI.
- Local canonical files under `~/.brainbase/personal-os/`.
- MCP tools for context, entity listing, search, Personal KG search, and onboarding status.

Prefer deterministic local file loading, explicit schema validation, and fail-loud errors over hidden fallbacks.

## Commit Messages

Use concise Conventional Commits:

```text
feat: add local SSOT import command
fix: emit target-specific MCP install config
test: cover onboarding status gaps
docs: clarify local-only backend scope
```
