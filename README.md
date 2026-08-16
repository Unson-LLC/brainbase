# Brainbase Personal Onboarding Kit

Brainbase is a local-first MCP server for handing your personal source of truth to AI coding tools.

The v1 value is narrow by design: create a canonical local SSOT for yourself, your work, relationships, and decisions, then expose it through MCP tools that Codex, Claude, and CodeCode can call.

Ontology 1.0.0 adds a portable semantic contract on top of those local files. It defines types, relation vocabulary, validation constraints, deterministic decision inference, and version-evolution guidance without requiring a hosted Brainbase service.

This repository does not include the internal Brainbase UI, session runtime, xterm transport, workflow mission control, social operations, hosted backend, Infisical setup, or Unson internal data. Those belong in the internal `brainbase-unson` system.

## Manual

Read the public onboarding manual at [brainbase.pages.dev](https://brainbase.pages.dev/). It guides users through five phases: choose one real use case, register approved work context, prove the first value, add only necessary sources, and operationalize Skills, routines, and MCP.

For the shortest safe path, open [10分で試す](https://brainbase.pages.dev/guide/quick-start). It keeps the first prompt, MCP setup, optional Judgment Host setup, verification, and interruption recovery in one resumable checklist.

The manual is the best starting point for first-time users. It explains Brainbase concepts, the first onboarding flow, MCP registration, project context setup, source onboarding, daily routines, and CLI reference.

## Agent-assisted Onboarding

Brainbase is designed to be adopted from Codex, Claude Code, or CodeCode. The first onboarding goal is a useful answer from your own context, not connector setup.

```bash
npm install
npm run build
npm run onboard:start -- --target codex
```

`onboard:start` is the Japanese first-run entrypoint for agent-assisted onboarding. It creates the minimum Personal OS directory, but it does not save self, project, relationship, decision, mail, calendar, drive, or task facts until the user approves them. It asks Codex or Claude Code what context you do not want to explain repeatedly, then shows the first prompt to try, the expected value, the minimum seed command, `onboard:demo`, project registration, optional source diagnosis, candidate review, MCP install, and `doctor`. The demo command appears before source diagnosis.

If the user says "I want to onboard Brainbase", the agent should run this flow instead of returning a checklist. The expected sequence is: build if needed, run `onboard:start`, ask for the smallest context the user wants Brainbase to remember, seed only approved facts, then run `onboard:demo` with a real request. The agent must show the prompt, sample result, what the user no longer had to explain, and the still-unfinished operationalization work. `ready: true`, `first_value_demo_ready`, generated skills, generated routines, and `onboard:install --dry-run` are not completion signals by themselves.

For a Google Workspace / Google Drive / local-notes setup, pass the known answers and let the command surface what still needs approval:

```bash
node dist/cli.js onboard:start \
  --target codex \
  --name "Your Name" \
  --project "Current project" \
  --goal "What this project should achieve" \
  --status "Current state" \
  --role "Your role" \
  --email gmail \
  --calendar google-calendar \
  --drive google-drive \
  --drive-folder "<allowed-google-drive-folder-id>" \
  --tasks scattered-calendar-notes
```

The output is intentionally command-ready for Codex and Claude Code. It keeps OAuth tokens out of chat, starts with metadata-first collection, requires Drive/local folder allowlists, and keeps `sources/` plus `candidates/` as secondary material until the user approves canonical writes.

If you only want the raw interview protocol, use:

```bash
node dist/cli.js onboard:agent
```

Paste the generated protocol into Codex or Claude Code. The agent should first ask what you do not want to explain repeatedly:

- a work premise
- a key relationship
- a decision principle
- an active project

Then approve the smallest facts that should become canonical local SSOT and seed them explicitly:

```bash
brainbase onboard:init
brainbase onboard:seed \
  --name "Your Name" \
  --value "What should not be re-explained" \
  --project "Current project" \
  --relationship "Key Partner|collaborator|Context you want AI tools to remember"
```

Run the first value demo with a real request. This is the onboarding completion signal:

```bash
brainbase onboard:demo --scenario "Draft the first note I should send to Key Partner about Current project"
```

`onboard:demo` reads only locally saved, approved facts. It does not call an LLM, hosted backend, or raw source collector. If it returns `ready: true`, the agent still needs to show the try-this prompt, sample result, and plain-language value: the user did not have to explain the saved work premise or person context again.

After the demo, keep onboarding open until the operationalization checklist is either completed or explicitly deferred:

```bash
brainbase onboard:skills --target codex
brainbase onboard:routines --target codex --cwd /path/to/brainbase
brainbase onboard:install --target codex --dry-run
brainbase doctor
```

The recommended order is public skills, `ohayo` / `oyasumi` / `retro` routines registered paused or confirmation-gated, real MCP config merge after approving the dry-run snippet, source allowlist / import / candidate review decisions, then `doctor` plus MCP `get_context` / `search` verification from a fresh agent session.

The commands above are still safe by default. `onboard:skills` and `onboard:routines` generate output unless you provide an explicit `--out`, and `onboard:install --dry-run` is only a preview. Do not treat those generated artifacts as installed until the user approves file writes, scheduler registration, and live config changes.

Preview the MCP config before merging it into the real agent config:

```bash
brainbase onboard:install --target codex --dry-run
brainbase doctor
```

Source setup is optional follow-up work. After the demo, ask Brainbase to diagnose the local source setup only when the demo shows that more context is needed or when you want to import existing tools:

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

Candidate files are also optional post-demo review material. They do not count as canonical memory:

```bash
brainbase onboard:candidates --write \
  --name "Your Name" \
  --value "What should not be re-explained" \
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
node dist/cli.js onboard:demo --scenario "Draft the first note I should send to Key Partner about Current project"
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

Brainbase CLI and MCP readers coordinate canonical updates with a local process lock and recover interrupted multi-file writes before reading. Code that opens the four canonical files directly does not participate in that lock, so concurrent raw filesystem reads are outside the atomic consistency guarantee. Use the Brainbase CLI or MCP tools when another Brainbase process may be writing.
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
- `onboarding_status`: reports seeded areas, first value demo readiness, missing setup, and local connection status.
- `get_ontology`: returns the immutable bundled Ontology 1.0.0 release without reading Personal OS files.
- `audit_ontology`: audits canonical local files and distinguishes verified violations from unavailable input.
- `infer_decisions`: derives active, superseded, and conflicting decisions from explicit rules.
- `ontology_impact`: explains compatibility, migration, and rollback from an earlier ontology version.

## Portable Ontology 1.0.0

Inspect the semantic contract and audit your local canonical files:

```bash
brainbase ontology:show
brainbase ontology:audit
brainbase ontology:audit --ontology-version 0.0.0
```

`ontology:audit` exits non-zero when an error-level violation exists or when a canonical file cannot be verified. It never reports an unavailable or malformed source as zero violations. Warnings, such as a relationship whose person is not yet present in the Graph, remain visible but do not block approved writes.
Use `--ontology-version 0.0.0` to interpret a pre-kernel snapshot without retroactively applying the 1.0.0 `effectiveAt`, supersession, conflict, or validation rules. The selected version is included in audit and inference results; unsupported versions fail explicitly.

Decision evolution is opt-in, read-compatible, and write-gated. Existing decision rows remain readable. New rows may add `topic`, `supersedes`, and `effectiveAt`; only an explicit `supersedes` reference makes an older decision inactive. Multiple active decisions with the same explicit `topic` are reported as a conflict instead of being silently resolved.

Before enabling 1.0.0 writes, back up the Personal OS directory, capture the current MCP client configuration and launch command, and run the read-only `brainbase ontology:audit --ontology-version 1.0.0`. Existing rows remain readable, but error-level semantic violations must be reviewed before `onboard:seed`, `onboard:projects --write`, or `onboard:apply --write` can change canonical files. For the first npm release, rollback means running `npm uninstall -g @unson/brainbase-mcp`, restoring the captured MCP client configuration and launch command, and restarting the client. For later upgrades, reinstall the last known working package version instead. Restore the pre-upgrade Personal OS backup only if reviewed repairs changed canonical files.

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
brainbase onboard:demo
brainbase onboard:install --target codex --dry-run
brainbase onboard:import --source gmail --from /tmp/gmail.json
brainbase onboard:extract --self-email you@example.com --write
brainbase onboard:apply --from <candidate-file> --select <id> --write
brainbase onboard:projects --name "Current project" --goal "What this project should achieve"
brainbase onboard:routines --target codex --cwd /path/to/brainbase
brainbase onboard:skills --target codex
brainbase ontology:show
brainbase ontology:audit
brainbase judgment:install --target codex --dry-run
brainbase doctor
```

Local checkout equivalents:

```bash
npm run build
node dist/cli.js onboard:agent
node dist/cli.js onboard:demo --scenario "Draft the first note I should send to Key Partner about Current project"
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
node dist/cli.js judgment:install --target codex --dry-run
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

## Judgment Resolver Host for Codex

Brainbase includes a local Judgment Resolver core and a Codex lifecycle Host adapter. The Host starts one portable episode at `UserPromptSubmit`, appends ordered tool events at `PostToolUse`, and finalizes the same episode at `Stop`. It builds one canonical context, adopts exactly one receipt for the turn, and gives the model only the selected judgment nodes and audit contract to follow. The full route receipt remains in the local journal instead of being injected into model context. It does not call a hosted Brainbase service, require a secret, or check project access.

Preview the Codex `UserPromptSubmit`, `PostToolUse`, and `Stop` hook snippet:

```bash
brainbase judgment:install --target codex --dry-run
```

Review and merge all three printed event bindings into `~/.codex/hooks.json`. The command is preview-only unless `--output` is provided; it never merges into or overwrites an existing config. To save a new snippet file before reviewing it:

```bash
brainbase judgment:install --target codex --output /tmp/brainbase-judgment-hooks.json
```

Preserve unrelated hooks, then verify the installed bindings and start a new Codex task:

```bash
brainbase doctor --dir ~/.brainbase/personal-os --judgment-hooks ~/.codex/hooks.json
```

After installation, the Host instructs the AI to begin every user-facing response with an exact owner-visible audit line such as:

```text
🧠 判断参照: 直前の「ログイン後の白画面を直して」を参照 → 実装依頼として継続 ✓
```

The line identifies the concrete current or prior user statement used as judgment evidence and the decision made from it. The excerpt is collapsed to one line, limited to 26 Unicode characters, and redacts secret-like assignments and token formats. For example, a question may show `「この仕組みを説明して」を参照 → 質問として回答 ✓`; an unresolved follow-up shows `⚠️ 判断参照: 「それでいい」の対象を特定できず → 確認質問` instead of looking like a successful resolution.

Judgment evidence and knowledge-call evidence are separate. A `🧠 判断参照` line says which request the Resolver judged; it never proves that an MCP lookup happened. The Host emits `📚` only after an actual successful portable MCP call and emits `⚠️` for `isError`, malformed, or empty CallToolResult envelopes. The portable mappings are `get_context` → routing (`Brainbase参照先`), `search` → search (`Brainbase検索`), and `search_personal_kg` → retrieval (`Brainbase取得`). Source selection and exclusions appear only when the tool result contains them. When a turn requires no knowledge lookup and none occurred, the exact audit is `📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓`; a knowledge-required turn cannot use that line to satisfy retrieval.

Detailed receipts, ordered tool events, the final event snapshot, and the exact owner-visible line are journaled together under `~/.brainbase/personal-os/judgment-journal/`, keyed by session and turn. Replayed tool events with the same `tool_use_id` and content are idempotent; conflicting reuse, corrupt journals, and a `Stop` without a matching active episode fail loudly. Only one receipt is adopted for a turn, and later duplicate hook calls reuse the stored line instead of rendering a possibly different summary. The line reports Resolver judgment evidence; it does not claim that Personal OS knowledge was already retrieved.

At `Stop`, the Host verifies that all expected audit lines appear at the beginning, exactly once, and in journal order. The first repairable failure returns one bounded block instruction and binds the non-audit answer body by digest. If the active repair changes that body or still omits the required audit contract, the hook exits nonzero with `judgment_stop_repair_exhausted` instead of completing the episode.

Every turn is judged, including questions and follow-up instructions. If a follow-up has no usable referent, the receipt selects clarification and the AI asks what the user meant; it does not refuse merely because classification or project context is incomplete. A receipt is judgment evidence, not permission to write files, send messages, deploy, purchase, or perform any other external effect. Normal host permissions and user approvals still apply.

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

The v1 MCP surface contains the five original context/onboarding tools plus the additive Ontology 1.0.0 tools: `get_ontology`, `audit_ontology`, `infer_decisions`, and `ontology_impact`.

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

### Maintainer release operation

Scoped package publication is configured as public. Configure the repository Actions secret `NPM_TOKEN`, then normally publish a version-bumped merge from the reviewed `develop` history. The merge trigger plans the version delta automatically. For the first `0.1.0` publication or recovery, dispatch the same package-wide serialized workflow from the GitHub CLI. `NPM_TOKEN` must be authorized to publish `@unson/brainbase-mcp`.

```bash
RELEASE_REF="${RELEASE_REF:-develop}"
gh workflow run npm-publish.yml --repo Unson-LLC/brainbase --ref develop -f release_ref="$RELEASE_REF"
```

Dispatch the reviewed ref once and retain the Actions run URL as release evidence. Do not rerun a failed first-publication attempt until its failure phase is known: if it stopped before registry mutation, revert or correct the reviewed release change before a new dispatch; if npm already contains the version, treat that version as immutable and use the verification or version-bump recovery path below.

Direct local `release:publish` is rejected because it would bypass the package-wide Actions concurrency queue. The CLI requires a runner-issued GitHub OIDC attestation for the exact upstream workflow on `refs/heads/develop` and the current run, so caller-set Actions environment variables or the same workflow path on another ref are not sufficient. Local `release:plan`, `release:validate`, and `release:verify` remain available for credential-free diagnosis; all registry mutation goes through the workflow above.

The validation CLI rejects dirty checkouts and commits outside the trusted ref, then runs build, test, production dependency audit, creates the real tarball without an npm credential, and stamps its manifest with the exact reviewed `gitHead` before hashing it. Publication requires the matching proof, rechecks both SHA-256 and npm-compatible SHA-512 integrity, publishes that same tarball with lifecycle scripts disabled, and compares registry `dist.integrity` with the validated artifact. It is idempotent: it publishes an absent version, or verifies that an existing immutable version has the same Git commit and bytes. It also reconciles the appropriate npm dist-tag. The workflow runs validation in a read-only job with no OIDC or npm credential, then transfers the immutable artifact to a separately permissioned publication job with npm provenance. The publish CLI requires the upstream GitHub Actions context and the workflow serialization marker, so supported mutation paths share one package queue. Its manual `release_ref` input is restricted to commits reachable from `develop` and is used for the first publication or recovery. `release:verify` is read-only and fails if metadata or dist-tags do not match.

Publication is complete only after the Actions `validate` and `publish` jobs pass, the npm registry reports the expected version, `gitHead`, `dist.integrity`, and dist-tag, and the matching GitHub Release targets the reviewed release commit. Retain those registry values, the GitHub Release URL, and the Actions run URL together; a green workflow or GitHub Release alone is insufficient. If `NPM_TOKEN` is absent or the workflow is disabled, read-only local CLI operations still work, but the npm release remains incomplete.

npm versions are immutable. Before publication, fix the cause and rerun the same reviewed ref. After a faulty publication, deprecate that version, keep users on the last known-good pinned version, and release a reviewed version bump; never overwrite the published bytes. Any manual dist-tag rollback requires a separate registry metadata and support review.
