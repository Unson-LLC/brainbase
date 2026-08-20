# Brainbase 個人オンボーディングキット

Brainbaseは、自分が承認した仕事の前提をCodex、Claude Code、CodeCodeへ渡すための、ローカル優先のMCPサーバーです。

最初の目標は情報源をすべて接続することではありません。自分、仕事、関係者、判断基準の最小文脈を保存し、10分以内に「同じ前提を説明し直さず役立つ出力」を確認することです。

Brainbaseの中核仮説は、個人や会社の知性は単なる情報量ではなく、**何を根拠に、誰が、どのように判断し、その結果から判断をどう更新してきたか**に宿るというものです。Knowledgeは最終目的ではなくEvidenceであり、Brainbaseは判断能力を外在化し、人間とAIが再利用できる形で残すことを目指します。詳しくは [Brainbase Core Philosophy](docs/core-philosophy.md) を参照してください。

Ontology 2.0.0は、ローカルファイルへ持ち運べる意味契約に、Relation Registryで管理する正規エンティティ間のIDエッジを追加します。ホスト型Brainbaseを必要とせず、型、関係語彙、検証制約、決定論的な判断推論、バージョン移行を定義します。履歴解釈として0.0.0と1.0.0も選択できます。

このリポジトリに、社内BrainbaseのUI、セッション実行基盤、xterm転送、ワークフロー管制、SNS運用、ホスト型バックエンド、Infisical設定、雲孫の社内データは含みません。それらは社内版`brainbase-unson`の範囲です。

## マニュアル

Read the public onboarding manual at [brainbase.pages.dev](https://brainbase.pages.dev/). It guides users through five phases: choose one real use case, register approved work context, prove the first value, add only necessary sources, and operationalize Skills, routines, and MCP.

For the shortest safe path, open [10分で試す](https://brainbase.pages.dev/guide/quick-start). It keeps the first prompt, MCP setup, optional Judgment Host setup, verification, and interruption recovery in one resumable checklist.

The manual is the best starting point for first-time users. It explains Brainbase concepts, the first onboarding flow, MCP registration, project context setup, source onboarding, daily routines, and CLI reference.

## エージェントと始める

BrainbaseはCodex、Claude Code、CodeCodeから導入できます。最初に目指すのは接続設定ではなく、自分の文脈を使った役立つ出力です。

```bash
npm install
npm run build
npm run onboard:start -- --target codex
```

`onboard:start`は日本語の初回導入コマンドです。最小ディレクトリだけを作り、本人、プロジェクト、関係者、判断、メール、カレンダー、ドライブ、タスクの事実は、利用者が承認するまで保存しません。通常表示は次の一手だけに絞り、全項目は`--details`で確認できます。

公開CLIをインストール済みなら、次の5ステップです。

```bash
brainbase onboard:start --target codex
# 表示された onboard:seed を確認して実行
brainbase onboard:install --target codex --dry-run
# 設定を承認・反映し、Codexを再起動
# 新しいCodexでBrainbaseのresolve_entity/get_context/searchを使って実際の依頼を試す
```

リポジトリをcloneした場合も、`npm run onboard:start -- --target codex`から同じ順序で進めます。

利用者がBrainbaseの導入を依頼したら、エージェントはチェックリストを返すだけでなく、この公開CLIを実行します。承認された最小文脈を保存し、MCP設定を反映した新しい実エージェントで`resolve_entity`、`get_context`、`search`を使って現実の依頼へ回答します。その実回答を見た本人が「役立った」と判断して初めて初回価値です。`ready: true`、`cli_sample_ready`、CLIの処理時間、合成ペルソナ評価、Skillsやルーティンの生成、`onboard:install --dry-run`だけでは導入完了ではありません。

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

Optionally preview the saved context locally. This is not an onboarding completion signal:

```bash
brainbase onboard:demo --scenario "Draft the first note I should send to Key Partner about Current project"
```

`onboard:demo` reads only locally saved, approved facts. It does not call an LLM, an agent, or a hosted backend. Its result is only a preview. Continue through MCP installation, restart the selected agent, make a real request using `resolve_entity`, `get_context`, and `search`, and ask the user whether that actual answer was useful.

After the demo, keep onboarding open: the preview is not the first-value gate. Continue until a real agent uses Brainbase and the human user confirms that the result was useful.

After seed, install and verify MCP before asking for the human value judgment:

```bash
brainbase onboard:install --target codex --dry-run
brainbase doctor
# restart Codex, use resolve_entity/get_context/search for the real request, then ask whether it was useful
```

The recommended order is public skills, `ohayo` / `oyasumi` / `retro` routines registered paused or confirmation-gated, real MCP config merge after approving the dry-run snippet, source allowlist / import / candidate review decisions, then `doctor` plus MCP `resolve_entity` / `get_context` / `search` verification from a fresh agent session.

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
npm run onboard:seed -- --name "Your Name" --value "What should not be re-explained"
```

See the manual for the complete onboarding and operating model.
