# Brainbase Personal Onboarding Kit

Brainbase is a local-first MCP server for handing your personal source of truth to AI coding tools.

The v1 value is narrow by design: create a canonical local SSOT for yourself, your work, relationships, and decisions, then expose it through MCP tools that Codex, Claude, and CodeCode can call.

This repository does not include the internal Brainbase UI, session runtime, xterm transport, workflow mission control, social operations, hosted backend, Infisical setup, or Unson internal data. Those belong in the internal `brainbase-unson` system.

## 30 Minute Setup

```bash
npm install
npm run build
npm run onboard:init
npm run onboard:seed -- --name "Your Name" --value "What matters in your work" --project "Current project"
npm run onboard:install -- --target codex --dry-run
```

The default data directory is:

```text
~/.brainbase/personal-os/
```

It contains the canonical local SSOT:

- `graph.json`: people, organizations, projects, and relationship entities.
- `personal-kg.jsonl`: values, judgment criteria, experiences, and personal context.
- `relationships.json`: relationship context that should survive across tools.
- `decisions.jsonl`: decision records and principles.
- `sources/`: optional raw notes, logs, or minutes. MCP tools prefer canonical files over these raw materials.
- `schemas/`: generated schema references for the local files.

Override the directory with:

```bash
BRAINBASE_PERSONAL_OS_DIR=/path/to/personal-os brainbase-mcp
```

## MCP Tools

- `get_context`: returns initial AI context from the local Graph and Personal KG.
- `list_entities`: lists `person`, `org`, `project`, `relationship`, and `decision` entities.
- `search`: searches canonical Graph and Personal KG data.
- `search_personal_kg`: searches owner-local Personal KG only.
- `onboarding_status`: reports seeded areas, missing setup, and local connection status.

## CLI

After building, the package exposes two binaries:

```bash
brainbase-mcp
brainbase
```

Common commands:

```bash
brainbase onboard:init
brainbase onboard:seed
brainbase onboard:install --target codex --dry-run
brainbase doctor
```

Non-interactive seed example:

```bash
brainbase onboard:seed \
  --name "Your Name" \
  --value "Clear ownership and durable decisions" \
  --decision-principle "Prefer canonical facts over chat memory" \
  --project "Personal AI operating system" \
  --relationship "Key Partner|collaborator|Works with me on AI adoption"
```

## Install MCP Config

Dry-run output:

```bash
brainbase onboard:install --target codex --dry-run
brainbase onboard:install --target claude --dry-run
brainbase onboard:install --target codecode --dry-run
```

The command prints a valid MCP server config. Use `--output /path/to/config.json` when you want Brainbase to write a config file.

## Hosted Backends

v1 does not support hosted Brainbase backends, Unson APIs, Infisical-managed secrets, bb.unson.jp sync, or Lightsail sync.

Future hosted behavior should be separated behind an explicit option such as:

```bash
BRAINBASE_BACKEND=hosted
```

Local MCP mode requires no secrets.

## Development

```bash
npm install
npm run build
npm test
npm pack --dry-run
```
