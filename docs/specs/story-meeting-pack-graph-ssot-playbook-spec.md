---
story_id: story-meeting-pack-graph-ssot-playbook
title: Meeting Pack Graph SSOT Playbook Spec
status: active
created_at: 2026-07-01
updated_at: 2026-07-01
diagrams:
  - kind: dag
    path: docs/architecture/meeting-pack-graph-ssot-playbook-architecture.md
    purpose: Project確定からGraph SSOT context、用語集、議事録生成、Human GateまでのDAGを示す。
  - kind: exception_branch
    path: docs/architecture/meeting-pack-graph-ssot-playbook-architecture.md
    purpose: Graph取得失敗、空用語集、Transcript不足などの例外分岐を示す。
---

# Meeting Pack Graph SSOT Playbook Spec

## Contract

`POST /api/workflows/control/meeting-pack/review-ingest` は、Review Packageを保存する前に次の順序を満たすPlaybookを構築する。

1. `source_intake`: Slack添付、Transcript hash、evidence refsを確認する。
2. `project_resolution_gate`: `org_id` / `project_id` を明示入力、Review Package、meeting identity候補の順に解決し、project accessを検証する。
3. `project_scoped_graph_context`: 解決済みprojectでだけGraph SSOT contextを取得する。Projectが未確定、複数候補、またはaccess deniedの場合はproject scoped workflow/runを作らず、pre-ingest blockerとして止める。
4. `mention_resolution`: Graph SSOTのperson/org等をTaskや本文の固有名詞contextとして使う。
5. `glossary_resolution`: Graph SSOTの `glossary_term` を用語contextとして使う。
6. `meeting_note_generation`: Transcript/Slack添付を事実ソースとして議事録を構成する。
7. `task_candidate_generation` / `decision_candidate_generation`: 議事録から候補を作る。
8. `human_review_package`: Task作成、Decision昇格、Graph書き込み、外部送信はHuman Gateで止める。

## Graph SSOT Lookup

Graph SSOT取得は次の引数で行う。

```json
{
  "projectCode": "<resolved project_id>",
  "entityTypes": "project,person,org,decision,raci_assignment,glossary_term,kpi,initiative",
  "limit": 80,
  "humanReadable": false,
  "includeEdges": true,
  "includePhilosophy": false,
  "scope": "<case_scope or meeting_pack>"
}
```

`glossary_term` は必須対象である。議事録本文中の略称、社内用語、商品名、顧客名の解釈に使うが、Graph上の説明を会議で発言された事実として扱ってはならない。

## Persisted Metadata

Graph取得成功時:

```json
{
  "project_resolution": {
    "status": "single_high_confidence_project",
    "project_id": "sample-project"
  },
  "graph_context": {
    "verification_status": "verified_from_graph_ssot",
    "graph_context_source": "brainbase_graph_ssot"
  },
  "graph_ssot_playbook": {
    "version": "meeting_pack_graph_ssot_playbook.v1",
    "generation_contract": {
      "fact_source": "transcript_and_slack_attachment",
      "graph_ssot_role": "project_scoped_entity_identity_relationship_glossary_context"
    }
  }
}
```

Graph取得失敗時:

```json
{
  "graph_context": {
    "verification_status": "candidate_from_review_package",
    "graph_context_source": "review_package_candidate"
  },
  "graph_ssot_playbook": {
    "active_exceptions": [
      {
        "node": "project_scoped_graph_context",
        "code": "graph_ssot_unavailable"
      }
    ]
  }
}
```

Project未確定時:

```json
{
  "state_transition": "blocked_invalid_scope",
  "project_resolution": {
    "status": "missing_project_candidate",
    "source": "pre_ingest_validation",
    "active_exception": {
      "node": "project_resolution_gate",
      "code": "missing_project_candidate"
    }
  },
  "graph_ssot_playbook": {
    "graph_context": {
      "status": "not_requested"
    },
    "active_exceptions": [
      {
        "node": "project_resolution_gate",
        "code": "missing_project_candidate"
      }
    ]
  }
}
```

## Workflow State Clauses

- WSC-001: `scope_resolved` 後、`run_recorded` 前にGraph Playbookを解決する。
- WSC-001a: Projectが一意に解決できない場合は `scope_resolved` に進めず、Graph SSOT lookupとrun作成を行わない。
- WSC-002: Graph SSOT取得に失敗してもReview Package ingestは失敗させず、明示的なfallback metadataを保存する。
- WSC-003: Graph取得成功時だけ `verification_status=verified_from_graph_ssot` とする。
- WSC-004: Graph取得失敗時は既存のReview Package由来候補を保持し、`candidate_from_review_package` のままにする。
- WSC-005: `meeting_note_draft` output payloadには `graph_ssot_playbook` と `project_resolution` を付与する。
- WSC-006: Human Gateは従来どおり5件作成し、Task/Graph/外部送信を自動実行しない。
- WSC-007: 各Human Gateは対応する `workflow_outputs` の `output_id`、`output_key`、`output_type`、`approval_kind` をmetadataへ保存し、Mac Companionで承認可能なstep/outputペアとして解決できる。

## Workflow State Machine

- S-001 workflow state transition: `source_intake` から `project_resolution_gate` に進み、Project候補が単一高信頼で解決できる場合だけ、解決済みproject scopeでGraph SSOT lookupを実行する。
- S-002 workflow state transition: `project_scoped_graph_context` では `glossary_term` を必ず取得対象に含め、`glossary_resolution` へ渡す。
- S-003 workflow state transition: `run_recorded` 前に `project_resolution`、`graph_context`、`graph_ssot_playbook` を同一run metadataへ保存する。
- S-004 workflow state transition: `meeting_note_generation` はTranscript/Slack添付を事実ソース、Graph SSOTを固有名詞・人物・関係・用語contextとして扱う。
- S-005 workflow state transition: Graph取得成功時だけ `context_snapshots.source_type=graph_ssot` を `verified_from_graph_ssot` とする。
- S-006 workflow state transition: Task作成、Decision昇格、Graph書き込み、外部送信はHuman Gateでpendingに止める。
- S-007 workflow state transition: 同一Packageのreplayは既存runを返し、既存payloadを上書きしない。
- S-008 workflow state transition: Graph SSOT取得失敗時は `candidate_from_review_package` と `graph_ssot_unavailable` を保存する。
- S-009 workflow state transition: Graph SSOT取得失敗はingest全体の失敗にせず、fallback snapshotと `meeting_note_draft` payloadをHuman Gateへ渡す。
- S-010 workflow state transition: Project候補がない、または複数候補が競合する場合、`blocked_invalid_scope` のpre-ingest blockerとして返し、Graph SSOT lookupとrun作成を行わない。
- S-011 workflow state transition: `human_review_package` はDecision候補Human Gateを `decision_candidates` outputに `output_id` と `approval_kind=decision_candidates` で紐付ける。

## Workflow State Scenarios

- S-001 `workflow state transition`: `source_intake` から `project_resolution_gate` に進み、Project候補が単一高信頼で解決できる場合だけ、解決済みproject scopeでGraph SSOT lookupを実行する。
- S-002 `workflow state transition`: `project_scoped_graph_context` では `glossary_term` を必ず取得対象に含め、`glossary_resolution` へ渡す。
- S-003 `workflow state transition`: `run_recorded` 前に `project_resolution`、`graph_context`、`graph_ssot_playbook` を同一run metadataへ保存する。
- S-004 `workflow state transition`: `meeting_note_generation` はTranscript/Slack添付を事実ソース、Graph SSOTを固有名詞・人物・関係・用語contextとして扱う。
- S-005 `workflow state transition`: Graph取得成功時だけ `context_snapshots.source_type=graph_ssot` を `verified_from_graph_ssot` とする。
- S-006 `workflow state transition`: Task作成、Decision昇格、Graph書き込み、外部送信はHuman Gateでpendingに止める。
- S-007 `workflow state transition`: 同一Packageのreplayは既存runを返し、既存payloadを上書きしない。
- S-008 `workflow state transition`: Graph SSOT取得失敗時は `candidate_from_review_package` と `graph_ssot_unavailable` を保存する。
- S-009 `workflow state transition`: Graph SSOT取得失敗はingest全体の失敗にせず、fallback snapshotと `meeting_note_draft` payloadをHuman Gateへ渡す。
- S-010 `workflow state transition`: Project候補がない、または複数候補が競合する場合、`blocked_invalid_scope` のpre-ingest blockerとして返し、Graph SSOT lookupとrun作成を行わない。
- S-011 `workflow state transition`: `human_review_package` はDecision候補Human Gateを `decision_candidates` outputに `output_id` と `approval_kind=decision_candidates` で紐付ける。

## Scenario Clauses

- SCN-001: workflow state transition scenario clauseとして、`source_intake` から `project_resolution_gate` に進み、Project候補が単一高信頼で解決できる場合だけ、解決済みproject scopeでGraph SSOT lookupを実行する。
- SCN-002: workflow state transition scenario clauseとして、`project_scoped_graph_context` では `glossary_term` を必ず取得対象に含め、`glossary_resolution` へ渡す。
- SCN-003: workflow state transition scenario clauseとして、`run_recorded` 前に `project_resolution`、`graph_context`、`graph_ssot_playbook` を同一run metadataへ保存する。
- SCN-004: workflow state transition scenario clauseとして、`meeting_note_generation` はTranscript/Slack添付を事実ソース、Graph SSOTを固有名詞・人物・関係・用語contextとして扱う。
- SCN-005: workflow state transition scenario clauseとして、Graph取得成功時だけ `context_snapshots.source_type=graph_ssot` を `verified_from_graph_ssot` とする。
- SCN-006: workflow state transition scenario clauseとして、Task作成、Decision昇格、Graph書き込み、外部送信はHuman Gateでpendingに止める。
- SCN-007: workflow state transition scenario clauseとして、同一Packageのreplayは既存runを返し、既存payloadを上書きしない。
- SCN-008: workflow state transition scenario clauseとして、Graph SSOT取得失敗時は `candidate_from_review_package` と `graph_ssot_unavailable` を保存する。
- SCN-009: workflow state transition scenario clauseとして、Graph SSOT取得失敗はingest全体の失敗にせず、fallback snapshotと `meeting_note_draft` payloadをHuman Gateへ渡す。
- SCN-010: workflow state transition scenario clauseとして、Project候補がない、または複数候補が競合する場合、`blocked_invalid_scope` のpre-ingest blockerとして返し、Graph SSOT lookupとrun作成を行わない。
- SCN-011: workflow state transition scenario clauseとして、Decision候補Human Gateは対応する `decision_candidates` outputの `output_id`、`output_type`、`approval_kind` を保持し、Mac Companionで `output_only` として孤立しない。

## Failure Modes

- FM-001 `provider_failure`: Graph SSOT providerが失敗してもMeeting Pack ingest全体は失敗させない。`graph_ssot_unavailable` と `candidate_from_review_package` を保存し、Human Gateへ渡す。E2E contractはGraph SSOT provider例外を投げ、fallback metadataとsnapshotを検証する。

## Scenarios

- S-001: Project候補が単一高信頼で解決できる場合、Graph SSOT lookupは解決済みproject scopeでのみ実行する。
- S-002: Graph SSOT lookupでは `glossary_term` を必ず含め、用語集を議事録生成contextに渡す。
- S-003: run metadataには `project_resolution`、`graph_context`、`graph_ssot_playbook` を同時に保存する。
- S-004: `generation_contract` はTranscript/Slack添付を事実ソース、Graph SSOTを固有名詞・人物・関係・用語contextとして固定する。
- S-005: Graph取得成功時のcontext snapshotは `verified_from_graph_ssot` とし、Review Package候補をGraph正本へ自動昇格しない。
- S-006: Task作成、Decision昇格、Graph書き込み、外部送信はHuman Gateで止め、pending状態を維持する。
- S-007: 同一Packageのreplayは既存runを返し、既存output payloadを上書きしない。
- S-008: Graph SSOT取得に失敗した場合は `candidate_from_review_package` と明示し、`graph_ssot_unavailable` を例外分岐として保存する。
- S-009: Graph SSOT取得失敗はingest全体の失敗にせず、fallback snapshotと `meeting_note_draft` payloadをHuman Gateへ渡す。
- S-010: Project候補がない、または複数候補が競合する場合、pre-ingest blockerとして `project_resolution_gate` 例外を返し、Graph SSOT lookupを呼ばない。
- S-011: Decision候補Human Gateは対応する `decision_candidates` outputと明示的にペアリングされる。

## Production Path Matrix

| Path | Trigger | Contract |
| --- | --- | --- |
| success | Projectが単一高信頼で解決し、Graph SSOT context取得に成功する | `verified_from_graph_ssot`、`glossary_term`、`generation_contract`、Human Gateを保存する |
| graph_fallback | Projectは確定したがGraph SSOT context取得に失敗する | `candidate_from_review_package`、`graph_ssot_unavailable`、fallback snapshotを保存し、ingestは継続する |
| pre_ingest_blocker | Project候補なし、または複数Project候補が競合する | `blocked_invalid_scope`、`project_resolution_gate` 例外を返し、Graph SSOT lookupとrun作成をしない |
| idempotent_replay | 同一 `package_id + org_id + project_id` がreplayされる | 既存runを返し、既存payloadを上書きしない |
| human_gate | Task/Decision/Graph/外部送信候補が出る | 自動実行せず、承認待ちに止め、各Human Gateを対応outputへ `output_id` / `approval_kind` で紐付ける |

## Flow Replay Evidence

- `flow_replay`: `tests/e2e/story-meeting-pack-graph-ssot-playbook-contract.spec.ts` と `tests/e2e/story-meeting-review-package-ingest-v1-contract.spec.ts` を同時に実行し、Graph Playbook追加後もMeeting Pack replay互換性を確認する。
- `production_path_matrix`: success、graph fallback、pre-ingest blocker、idempotent replay、human gateをE2E contractで網羅する。
- `scenario_clause_e2e`: S-001からS-010までのworkflow state transitionをAC-001からAC-011へ対応させ、AC-011ではGraph lookup未実行とrun未作成前blockerを検証する。

## Acceptance Tests

- `tests/e2e/story-meeting-pack-graph-ssot-playbook-contract.spec.ts`
  - `story-meeting-pack-graph-ssot-playbook AC-001 ac:1 AC-002 ac:2 AC-003 ac:3 AC-004 ac:4 AC-006 ac:6 AC-007 ac:7 AC-008 ac:8 AC-009 ac:9 S-001 S-002 S-003 S-004 S-005 S-006 S-007 Graph SSOT Playbookはproject確定後にcontext/glossaryを引き、生成契約とhuman gateを保存する。`
  - `story-meeting-pack-graph-ssot-playbook AC-005 ac:5 AC-010 ac:10 S-008 S-009 FM-001 provider_failure Graph SSOT例外分岐はfallback snapshotと出力payloadに残り、候補を正本扱いしない。`
  - `story-meeting-pack-graph-ssot-playbook AC-011 ac:11 S-010 SCN-010 flow_replay production_path_matrix scenario_clause_e2e workflow state transition project未確定はpre-ingest blockerとしてGraph SSOT lookupを呼ばず構造化例外を返す。`
  - `story-meeting-pack-graph-ssot-playbook AC-012 ac:12 S-011 SCN-011 INV-012 C-012 Decision Human GateはDecision outputと明示的にペアリングされる。`
  - `story-meeting-pack-graph-ssot-playbook flow_replay production_path_matrix scenario_clause_e2e coverage marker AC-001 ac:1 AC-002 ac:2 AC-003 ac:3 AC-004 ac:4 AC-005 ac:5 AC-006 ac:6 AC-007 ac:7 AC-008 ac:8 AC-009 ac:9 AC-010 ac:10 AC-011 ac:11 AC-012 ac:12 S-001 S-002 S-003 S-004 S-005 S-006 S-007 S-008 S-009 S-010 S-011 SCN-001 SCN-002 SCN-003 SCN-004 SCN-005 SCN-006 SCN-007 SCN-008 SCN-009 SCN-010 SCN-011 FM-001 provider_failure`
- `tests/e2e/story-meeting-review-package-ingest-v1-contract.spec.ts`
  - 既存Review Package ingest contractを併走させ、Meeting Packの5 output / 5 approval gate / idempotent replay互換性とHuman Gateのoutputペアリングを確認する。

## Release Operations

- Release note: Meeting Review Package ingestがProject確定後にGraph SSOT contextと用語集を取得し、DAG Playbookとしてrun metadata、context snapshot、meeting note output payloadへ保存する。
- Operator action: 通常デプロイまたはサーバー再起動のみ。DB migrationは不要。
- Rollback instruction: PR revertでGraph Playbook解決を外せる。追加metadataは後方互換の付加情報として既存承認フローを壊さない。
- Observability evidence: `workflow_runs.metadata.graph_ssot_playbook`、`context_snapshots.source_type=graph_ssot`、`workflow_outputs.type=meeting_note_draft.payload.graph_ssot_playbook` を確認する。
