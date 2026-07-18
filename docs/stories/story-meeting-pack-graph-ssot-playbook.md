---
story_id: story-meeting-pack-graph-ssot-playbook
title: Meeting Pack Graph SSOT Playbook
status: active
created_at: 2026-07-01
updated_at: 2026-07-01
---

# Meeting Pack Graph SSOT Playbook

## Story

Meeting Packで議事録、Task、Decision、Graph昇格候補を作る時は、最初に「どのプロジェクトの会議か」を確定する。その後でだけ、Brainbase Graph SSOTからそのprojectに属する人物、組織、既存Decision、RACI、KPI、initiative、用語集を引く。

Graph SSOTは会議内容の事実ソースではない。オンライン会議はTactiq、オフライン会議またはTactiqを使えないオンライン会議はPlaudからMCPで取得したTranscript/Noteが発言・合意・宿題の事実ソースであり、Slack投稿は通知・参照ポインタ・フォールバック証跡に限定する。Graph SSOTは固有名詞、人物同一性、関係、用語、既存プロジェクト文脈を誤らないための補助文脈である。

このStoryでは、その処理順序をDAG PlaybookとしてReview Package ingestに保存する。Graph SSOTが取得できない場合も空扱いにせず、例外分岐として残したうえでHuman Gateに渡す。Projectが一意に確定しない場合は、project scopedなworkflow/runを作らず、pre-ingest blockerとして `project_resolution` と `graph_ssot_playbook.active_exceptions` を返す。

## Invariants

- INV-graph-playbook-001: Project確定前にGraph SSOT contextを引かない。
- INV-graph-playbook-002: Graph SSOT contextはproject scopedで取得し、少なくとも `project`、`person`、`org`、`decision`、`raci_assignment`、`glossary_term`、`kpi`、`initiative` を対象にする。
- INV-graph-playbook-003: `glossary_term` は議事録生成時の重要contextであり、取得対象から外さない。
- INV-graph-playbook-004: Tactiq/Plaud MCPソースが事実ソースであり、Graph SSOTやSlack投稿を発言事実の代替にしない。
- INV-graph-playbook-005: Task作成、Decision昇格、Graph書き込み、外部送信はHuman Gate前に実行しない。
- INV-graph-playbook-006: Graph SSOT取得失敗、空project context、空用語集、複数project候補はPlaybookの例外分岐として明示する。Project未確定の例外はrun作成前に止め、Graph SSOT lookupを呼ばない。
- INV-graph-playbook-007: 同一Review Packageのidempotent replayは既存runを返し、既存payloadを黙って上書きしない。

## DAG

```mermaid
flowchart TD
  source["source_intake<br/>Tactiq/Plaud MCP source"] --> project["project_resolution_gate"]
  project --> graph["project_scoped_graph_context<br/>Graph SSOT"]
  graph --> people["mention_resolution<br/>people/org/service"]
  graph --> glossary["glossary_resolution<br/>glossary_term"]
  people --> note["meeting_note_generation"]
  glossary --> note
  note --> tasks["task_candidate_generation"]
  note --> decisions["decision_candidate_generation"]
  decisions --> promotion["graph_promotion_candidates"]
  tasks --> review["human_review_package"]
  promotion --> review
```

## Exception Branches

- `source_intake.missing_tactiq_or_plaud_transcript`: Tactiq/PlaudのMCP取得物がない。議事録本文の生成品質を保証できないため、証跡不足としてHuman Gateに出す。
- `source_intake.primary_mcp_source_missing`: Slackなどのフォールバック証跡はあるが、会議種別に対応する一次MCPソースがない。オンラインはTactiq、オフラインまたはTactiq不可のオンラインはPlaudを取得してから再生成する。
- `source_intake.source_artifact_hash_missing`: source artifact hashがない。再現性確認が弱いため、snapshot上に残す。
- `project_resolution_gate.missing_project_candidate`: project候補がない。project scoped workflow/runを作らず、Graph SSOTを引かずにpre-ingest blockerとして返す。
- `project_resolution_gate.multiple_project_candidates`: 複数project候補が競合する。project scoped workflow/runを作らず、人間がprojectを確定するまでGraph contextを取得しない。
- `project_scoped_graph_context.graph_ssot_unavailable`: Graph SSOT取得失敗。候補contextにfallbackするが、空結果として扱わない。
- `project_scoped_graph_context.empty_project_context`: projectは確定したがGraph contextが空。SSOT整備不足として残す。
- `glossary_resolution.empty_project_glossary`: 用語集が空。固有名詞・略称の誤読リスクとして残す。
- `meeting_note_generation.graph_context_used_as_fact_source`: Graph contextを発言事実として使った疑い。議事録公開前に止める。
- `human_review_package.graph_write_requires_human_approval`: DecisionやGraph昇格はHuman Gate後にだけ進む。

## Workflow State Machine

- S-001 workflow state transition: `source_intake` から `project_resolution_gate` に進み、単一Projectが確定した時だけ `project_scoped_graph_context` を実行する。
- S-002 workflow state transition: Graph SSOT lookupでは `glossary_term` を必ず含め、`glossary_resolution` を通して議事録生成contextへ渡す。
- S-003 workflow state transition: Graph context取得後、`run_recorded` 前に `project_resolution`、`graph_context`、`graph_ssot_playbook` をrun metadataへ固定する。
- S-004 workflow state transition: `meeting_note_generation` ではTactiq/Plaud MCPソースだけを事実ソースにし、Graph SSOTは固有名詞・人物・関係・用語contextに限定する。
- S-005 workflow state transition: Graph取得成功時だけ `verified_from_graph_ssot` とし、Review Package候補をGraph正本へ自動昇格しない。
- S-006 workflow state transition: Task作成、Decision昇格、Graph書き込み、外部送信は `human_review_package` でpendingに止める。
- S-007 workflow state transition: 同一Packageのreplayは既存runを返し、既存output payloadを上書きしない。
- S-008 workflow state transition: Graph SSOT取得失敗時は `graph_ssot_unavailable` を保存し、候補contextを `candidate_from_review_package` としてHuman Gateへ渡す。
- S-009 workflow state transition: Graph SSOT取得失敗はingest全体の失敗にせず、fallback snapshotとmeeting note payloadを保存する。
- S-010 workflow state transition: Project候補がない、または複数候補が競合する場合は `blocked_invalid_scope` でpre-ingest blockerを返し、Graph SSOT lookupとrun作成を行わない。

## Workflow State Scenarios

- S-001 `workflow state transition`: `source_intake` から `project_resolution_gate` に進み、単一Projectが確定した時だけ `project_scoped_graph_context` を実行する。
- S-002 `workflow state transition`: Graph SSOT lookupでは `glossary_term` を必ず含め、`glossary_resolution` を通して議事録生成contextへ渡す。
- S-003 `workflow state transition`: Graph context取得後、`run_recorded` 前に `project_resolution`、`graph_context`、`graph_ssot_playbook` をrun metadataへ固定する。
- S-004 `workflow state transition`: `meeting_note_generation` ではTactiq/Plaud MCPソースだけを事実ソースにし、Graph SSOTは固有名詞・人物・関係・用語contextに限定する。
- S-005 `workflow state transition`: Graph取得成功時だけ `verified_from_graph_ssot` とし、Review Package候補をGraph正本へ自動昇格しない。
- S-006 `workflow state transition`: Task作成、Decision昇格、Graph書き込み、外部送信は `human_review_package` でpendingに止める。
- S-007 `workflow state transition`: 同一Packageのreplayは既存runを返し、既存output payloadを上書きしない。
- S-008 `workflow state transition`: Graph SSOT取得失敗時は `graph_ssot_unavailable` を保存し、候補contextを `candidate_from_review_package` としてHuman Gateへ渡す。
- S-009 `workflow state transition`: Graph SSOT取得失敗はingest全体の失敗にせず、fallback snapshotとmeeting note payloadを保存する。
- S-010 `workflow state transition`: Project候補がない、または複数候補が競合する場合は `blocked_invalid_scope` でpre-ingest blockerを返し、Graph SSOT lookupとrun作成を行わない。

## Scenario Clauses

- SCN-001: workflow state transition scenario clauseとして、`source_intake` から `project_resolution_gate` に進み、単一Projectが確定した時だけ `project_scoped_graph_context` を実行する。
- SCN-002: workflow state transition scenario clauseとして、Graph SSOT lookupでは `glossary_term` を必ず含め、`glossary_resolution` を通して議事録生成contextへ渡す。
- SCN-003: workflow state transition scenario clauseとして、Graph context取得後、`run_recorded` 前に `project_resolution`、`graph_context`、`graph_ssot_playbook` をrun metadataへ固定する。
- SCN-004: workflow state transition scenario clauseとして、`meeting_note_generation` ではTactiq/Plaud MCPソースだけを事実ソースにし、Graph SSOTは固有名詞・人物・関係・用語contextに限定する。
- SCN-005: workflow state transition scenario clauseとして、Graph取得成功時だけ `verified_from_graph_ssot` とし、Review Package候補をGraph正本へ自動昇格しない。
- SCN-006: workflow state transition scenario clauseとして、Task作成、Decision昇格、Graph書き込み、外部送信は `human_review_package` でpendingに止める。
- SCN-007: workflow state transition scenario clauseとして、同一Packageのreplayは既存runを返し、既存output payloadを上書きしない。
- SCN-008: workflow state transition scenario clauseとして、Graph SSOT取得失敗時は `graph_ssot_unavailable` を保存し、候補contextを `candidate_from_review_package` としてHuman Gateへ渡す。
- SCN-009: workflow state transition scenario clauseとして、Graph SSOT取得失敗はingest全体の失敗にせず、fallback snapshotとmeeting note payloadを保存する。
- SCN-010: workflow state transition scenario clauseとして、Project候補がない、または複数候補が競合する場合は `blocked_invalid_scope` でpre-ingest blockerを返し、Graph SSOT lookupとrun作成を行わない。

## Failure Modes

- FM-001 `provider_failure`: Graph SSOT providerが失敗してもMeeting Pack ingest全体は失敗させない。`graph_ssot_unavailable` と `candidate_from_review_package` を保存し、Human Gateへ渡す。

## Production Path Matrix

| Path | Trigger | Required behavior |
| --- | --- | --- |
| success | Projectが単一高信頼で解決し、Graph SSOT contextを取得できる | project scoped Graph context、用語集、generation contract、Human Gateを保存する |
| graph_fallback | Projectは確定したがGraph SSOT context取得に失敗する | `graph_ssot_unavailable` と `candidate_from_review_package` を保存し、ingestは継続する |
| pre_ingest_blocker | Project候補なし、または複数Project候補が競合する | `blocked_invalid_scope` を返し、Graph lookupとrun作成をしない |
| idempotent_replay | 同一 `package_id + org_id + project_id` が再投入される | 既存runを返し、既存payloadを上書きしない |
| human_gate | Task/Decision/Graph/外部送信候補が生成される | 自動実行せず、承認待ちのHuman Gateに止める |

## Flow Replay Evidence

- `flow_replay`: 既存Review Package ingest contractとGraph SSOT Playbook contractを同時に実行し、従来の5 output / 5 approval gate / idempotent replay互換性を確認する。
- `production_path_matrix`: success、graph fallback、pre-ingest blocker、idempotent replay、human gateの本番経路をE2E contractで検証する。
- `scenario_clause_e2e`: S-001からS-010までのworkflow state transitionを `tests/e2e/story-meeting-pack-graph-ssot-playbook-contract.spec.ts` のAC-001からAC-011に対応させる。

## Acceptance Criteria

- AC-001: Review Package ingestはProject確定後にGraph SSOT contextを取得する。
- AC-002: Graph SSOT取得時の `entityTypes` に `glossary_term` を含める。
- AC-003: run metadataに `project_resolution` と `graph_ssot_playbook` を保存する。
- AC-004: `context_snapshots.source_type=graph_ssot` にはGraph取得成功時 `verification_status=verified_from_graph_ssot` を保存する。
- AC-005: Graph SSOTが利用できない場合は `verification_status=candidate_from_review_package` を維持し、`active_exceptions` に `graph_ssot_unavailable` を残す。
- AC-006: `meeting_note_draft` payloadにはPlaybookとGraph context statusを付与する。
- AC-007: Graph SSOT contextは議事録の事実ソースではなく、固有名詞、人物同一性、関係、用語のcontextであることを `generation_contract` に残す。
- AC-008: Task/Decision/Graph/外部送信のHuman Gateは維持する。
- AC-009: 同一Packageのidempotent replayは既存runを返し、既存payloadを上書きしない。
- AC-010: Graph SSOT context取得失敗はingest失敗ではなく、明示的な例外分岐としてHuman Gateへ渡す。
- AC-011: Project未確定時はGraph SSOT lookupを呼ばず、pre-ingest blockerとして `project_resolution_gate` の例外を返す。
- AC-012: Decision候補Human Gateは対応する `decision_candidates` outputの `output_id` / `approval_kind` を保持し、Mac Companionで `output_only` にならない。

## Verification

- Unit/E2E: `BRAINBASE_E2E_REUSE_SERVER=true npm run test:e2e -- tests/e2e/story-meeting-review-package-ingest-v1-contract.spec.ts`
- Lint: `npx eslint server/services/meeting-automation/meeting-automation-service.js tests/e2e/story-meeting-review-package-ingest-v1-contract.spec.ts`
- VibePro: `vibepro spec fingerprint/write/drift`, `vibepro story diagnose --run-graphify`, `vibepro pr prepare`
