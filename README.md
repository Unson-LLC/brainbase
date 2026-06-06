# Brainbase Personal Onboarding Kit

Brainbase is a local-first MCP server for handing your personal source of truth to AI coding tools.

The v1 value is narrow by design: create a canonical local SSOT for yourself, your work, relationships, and decisions, then expose it through MCP tools that Codex, Claude, and CodeCode can call.

This repository does not include the internal Brainbase UI, session runtime, xterm transport, workflow mission control, social operations, hosted backend, Infisical setup, or Unson internal data. Those belong in the internal `brainbase-unson` system.

## Agent-assisted Onboarding

Brainbase is designed to be adopted from Codex, Claude Code, or CodeCode. Instead of starting with a long manual seed command, ask your coding agent to run the Brainbase onboarding interview.

```bash
npm install
npm run build
node dist/cli.js onboard:agent
```

Paste the generated protocol into Codex or Claude Code and let it ask which tools you use:

- mail: Gmail, Outlook, Apple Mail, or another mail tool
- calendar: Google Calendar, Outlook Calendar, Apple Calendar, or another calendar
- drive/docs: Google Drive, OneDrive, Dropbox, Notion, local folders, or another document system
- tasks: Notion, Todoist, Linear, GitHub Issues, NocoDB, CSV, or no task tool

After the interview, ask Brainbase to diagnose the local source setup. This does not import source data. It tells the agent which local collector, allowlist, and staging path are needed:

```bash
brainbase onboard:diagnose-sources \
  --email gmail \
  --calendar google-calendar \
  --drive google-drive \
  --drive-folder "<allowed-google-drive-folder-id>" \
  --tasks notion
```

Gmail, Google Calendar, and Google Drive diagnosis uses local GoG-style collection when available. The first pass should be metadata-first. Drive collection requires explicit folder allowlists. If GoG is missing, diagnosis reports `needs_setup` instead of pretending import is ready.

For a Google Workspace local-first adopter with an always-on SSH-accessible Mac mini, Workspace mail/calendar/drive, a secondary Gmail account, local files, and tasks scattered across Calendar and notes, generate the setup plan first:

```bash
brainbase onboard:plan \
  --profile google-workspace-local \
  --host mac-mini \
  --email google-workspace \
  --secondary-email gmail \
  --calendar google-calendar \
  --drive google-drive \
  --drive-folder "<allowed-google-drive-folder-id>" \
  --local-folder "<allowed-local-notes-folder>" \
  --tasks scattered-calendar-notes \
  --inactive-task-tool notion
```

This plan treats the Mac mini as the user's local MCP runtime host, not as a hosted Brainbase backend or server-operations handoff. Google Workspace and Gmail are staged through read-only metadata-first GoG steps. Google Drive and local files are allowlist-first; do not scan the whole Drive or home directory. If Notion was tried and abandoned, keep it as inactive context and extract task candidates from Google Calendar and approved local notes instead.

Then let the coding agent draft candidate facts from the interview. Candidate files are review material only; they do not count as canonical memory:

```bash
brainbase onboard:candidates --write \
  --name "Your Name" \
  --value "What matters in your work" \
  --project "Current project" \
  --relationship "Key Partner|collaborator|Context you want AI tools to remember"
```

Review candidates with the user, then promote only approved facts through `brainbase onboard:seed` or an equivalent explicit promotion flow.

### Register active projects

Brainbase can register active projects from the onboarding interview before any external source is connected. Codex or Claude Code should ask the user about the project goal, current status, their role, key stakeholders, allowed source areas, task sources, and project-specific decision principles. Source references are metadata-only allowlists; this command does not read mail, calendar, drive, task, or local-note content.

```bash
# Dry-run first: show the project registration plan without canonical writes
brainbase onboard:projects \
  --name "Current project" \
  --goal "What this project should achieve" \
  --status "Current state" \
  --role "Your role" \
  --stakeholder "Key Partner|collaborator|Why this person matters" \
  --source "drive|Proposal folder|gdrive-folder-id" \
  --task-source "Calendar follow-ups" \
  --decision-principle "How AI should make tradeoffs in this project"

# After user approval, promote it into canonical SSOT
brainbase onboard:projects --name "Current project" --goal "Approved goal" --write
```

After `--write`, project context is stored in canonical local SSOT and becomes visible through Brainbase MCP `get_context`, `list_entities`, and `search`.

### Import collected sources and extract candidates

Once the diagnosed GoG collectors have produced metadata JSON, complete the value loop locally. Brainbase still never authenticates to a provider; it only normalizes already-collected JSON, derives candidates, and promotes the ones you select.

```bash
# 1. Import collected provider JSON (metadata-first; bodies and file contents are dropped)
gog gmail search "newer_than:90d" --json > /tmp/gmail.json
brainbase onboard:import --source gmail --from /tmp/gmail.json
brainbase onboard:import --source calendar --from /tmp/calendar.json
brainbase onboard:import --source drive --from /tmp/drive.json
brainbase onboard:import --source local --from /tmp/local-notes.json

# 2. Extract reviewable candidates from sources/ (deterministic; exclude your own address)
brainbase onboard:extract --self-email you@example.com --write

# 3. Review the extracted candidate file, then promote only selected ids (dry-run by default)
brainbase onboard:apply --from <candidate-file> --select <id> --write
brainbase doctor
```

`onboard:import` and `onboard:extract` never write canonical SSOT. Only `onboard:apply --write` promotes selected candidates into `graph.json`, `personal-kg.jsonl`, `relationships.json`, and `decisions.jsonl`.

### Register the daily operating routines

Loading context once is not enough; the operating loop runs every day. Generate personal-scoped morning (`ohayo`), end-of-day (`oyasumi`), and weekly retrospective (`retro`) routines for whichever coding agent you run. Brainbase prints the definition; your agent registers it with its own scheduler. The routines are scoped to your own connected sources and local Brainbase MCP context — they are not the internal Unson operations.

```bash
# Codex host (emits per-file automation.toml documents)
brainbase onboard:routines --target codex --cwd /path/to/brainbase \
  --ohayo-hour 7 --oyasumi-hour 22 --retro-dow FRI --retro-hour 17

# Claude Code host (emits scheduled-task definitions with cron + prompt)
brainbase onboard:routines --target claude --cwd /path/to/brainbase

# Only some routines, written to a file
brainbase onboard:routines --target codex --routines ohayo,retro --out ./routines.toml
```

`onboard:routines` is generation-only and dry-run by default: it prints definitions, writes a file only with `--out`, never registers a live scheduler, and never writes canonical SSOT.

### Public onboarding skillsを生成する

Brainbaseには、コーディングエージェント向けの公開safeな最小skillsも入っています。これは内部Brainbase運用skillsではなく、個人オンボーディング、ソース取り込み、候補レビュー、日次ルーティンのための日本語instructionsです。

```bash
# Codex-compatible skill paths に合わせて表示
brainbase onboard:skills --target codex

# Claude Code project skill paths に合わせて表示
brainbase onboard:skills --target claude

# portableなSKILL.mdをreview用ディレクトリへ書き出す
brainbase onboard:skills --target portable --out ./brainbase-skills

# 一部のskillsだけ生成する
brainbase onboard:skills --target codex --skills brainbase-source-import,brainbase-candidate-review
```

標準のpublic skill ids:

- `brainbase-personal-onboarding`
- `brainbase-source-import`
- `brainbase-candidate-review`
- `brainbase-daily-routines`

`onboard:skills` はgeneration-onlyで、defaultはdry-runです。`--out` のときだけファイルを書き、既存の `SKILL.md` はoverwriteしません。live Codex / Claude Code configurationもcanonical SSOTも変更しません。

`onboard:recommend` remains available when you only want connector guidance:

```bash
brainbase onboard:recommend \
  --email gmail \
  --calendar google-calendar \
  --drive google-drive \
  --tasks notion
```

External sources are staged as secondary material:

```text
~/.brainbase/personal-os/
  sources/
    gmail/
    calendar/
    drive/
    tasks/
  candidates/
```

Do not paste OAuth tokens, passwords, API keys, or refresh tokens into chat. Imported mail, calendar, drive, and task material stays under `sources/` until reviewed. Only approved candidates should be promoted into `graph.json`, `relationships.json`, `personal-kg.jsonl`, or `decisions.jsonl`.

## 30 Minute Setup

```bash
npm install
npm run build
npm run onboard:init
npm run onboard:seed -- --name "Your Name" --value "What matters in your work" --project "Current project" --relationship "Key Partner|collaborator|Context you want AI tools to remember"
npm run doctor
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
- `sources/`: optional raw notes, logs, mail, calendar, drive, and task exports. MCP tools prefer canonical files over these raw materials.
- `candidates/`: staging area for extracted facts before user approval.
- `schemas/`: generated schema references for the local files.

For a local checkout, launch the built MCP server with:

```bash
BRAINBASE_PERSONAL_OS_DIR=/path/to/personal-os npm start
```

The generated MCP client config uses the same idea explicitly: your current Node executable plus this checkout's built `dist/index.js`.

When installed as a package, you can launch it with:

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

When installed as a package, Brainbase exposes two binaries:

```bash
brainbase-mcp
brainbase
```

For local checkout onboarding, run commands through `npm run ...` until the package is installed or linked. `onboard:install` writes a config that launches the built MCP entrypoint with your current Node executable, so the generated config works without guessing whether `brainbase-mcp` is on `PATH`.

Installed package commands:

```bash
brainbase onboard:init
brainbase onboard:seed
brainbase onboard:install --target codex --dry-run
brainbase onboard:import --source gmail --from /tmp/gmail.json
brainbase onboard:extract --self-email you@example.com --write
brainbase onboard:apply --from <candidate-file> --select <id> --write
brainbase onboard:projects --name "Current project" --goal "What this project should achieve"
brainbase onboard:routines --target codex --cwd /path/to/brainbase
brainbase onboard:skills --target codex
brainbase doctor
```

Local checkout equivalents:

```bash
npm run build
node dist/cli.js onboard:agent
node dist/cli.js onboard:plan --profile google-workspace-local --host mac-mini --email google-workspace --secondary-email gmail --calendar google-calendar --drive google-drive --drive-folder "<folder-id>" --local-folder "<notes-folder>" --tasks scattered-calendar-notes --inactive-task-tool notion
node dist/cli.js onboard:diagnose-sources --email gmail --calendar google-calendar --drive google-drive --drive-folder "<folder-id>" --tasks notion
node dist/cli.js onboard:candidates --write --name "Your Name" --project "Current project"
node dist/cli.js onboard:projects --name "Current project" --goal "What this project should achieve"
node dist/cli.js onboard:import --source gmail --from /tmp/gmail.json
node dist/cli.js onboard:extract --self-email you@example.com --write
node dist/cli.js onboard:apply --from <candidate-file> --select <id> --write
node dist/cli.js onboard:routines --target codex --cwd "$(pwd)"
node dist/cli.js onboard:skills --target codex
node dist/cli.js onboard:recommend --email gmail --calendar google-calendar --drive google-drive --tasks notion
npm run onboard:init
npm run onboard:seed -- --name "Your Name"
npm run onboard:install -- --target codex --dry-run
npm run doctor
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
npm run onboard:install -- --target codex --dry-run
npm run onboard:install -- --target claude --dry-run
npm run onboard:install -- --target codecode --dry-run
```

The command prints a valid MCP server config snippet. Use `--output /path/to/new-snippet-file` when you want Brainbase to write the generated snippet.

`--output` intentionally creates a new snippet file and refuses to overwrite an existing file. It does not merge into existing Codex, Claude, or CodeCode config files. Review the snippet, then paste or merge it into the target client config yourself so existing MCP servers and client settings are preserved.

Codex output is TOML for `~/.codex/config.toml` style configuration:

```toml
[mcp_servers.brainbase]
command = "/path/to/node"
args = ["/path/to/brainbase/dist/index.js"]

[mcp_servers.brainbase.env]
BRAINBASE_PERSONAL_OS_DIR = "/path/to/personal-os"
```

Claude and CodeCode output use the standard MCP `mcpServers` JSON shape:

```json
{
  "mcpServers": {
    "brainbase": {
      "command": "/path/to/node",
      "args": ["/path/to/brainbase/dist/index.js"],
      "env": {
        "BRAINBASE_PERSONAL_OS_DIR": "/path/to/personal-os"
      }
    }
  }
}
```

Choose a temporary snippet path when using `--output`; do not point it at a live client config unless you have already moved the old file aside.

## Migration From Prior Brainbase Repos

This repository is intentionally replaced as the external Personal Onboarding Kit. It is not a compatible continuation of the previous internal Brainbase UI/runtime package.

Use this repo when you want:

- Local personal SSOT under `~/.brainbase/personal-os/`.
- MCP access from Codex, Claude, or CodeCode.
- No hosted backend, no Infisical requirement, and no Unson internal data.

Keep or pin the internal `brainbase-unson` system when you need:

- Brainbase UI, session runtime, terminal/xterm transport, workflow mission control, or social operations.
- bb.unson.jp, Lightsail, Graph API, JWT/API-token flows, or hosted sync.
- Legacy Graph API MCP tools such as `get_entity`.
- VibePro runtime or internal 31013 operation surfaces.

The v1 MCP tool surface is intentionally limited to `get_context`, `list_entities`, `search`, `search_personal_kg`, and `onboarding_status`.

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

Scoped package publication is configured as public. After verification, publish with:

```bash
npm publish --access public
```
