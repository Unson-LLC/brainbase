---
story_id: story-external-runner-adapter-contract-v0
title: Eve Runtime Adapter Contract v0
status: active
created_at: 2026-06-15
updated_at: 2026-06-19
architecture_docs:
  - docs/architecture/external-runner-adapter-contract-architecture.md
spec_docs:
  - docs/specs/story-external-runner-adapter-contract-v0-spec.md
---

# Eve Runtime Adapter Contract v0

## 背景

BrainbaseのLearning Loopは新しく作るものではなく、すでにWorkflow Mission Control、Candidate Store / Personal KG、Graph SSOT、VibePro / Judgment DAGを土台として持っている。

EveはBrainbaseの中心ではなく、Role Agentを実行する外部ランタイムである。BrainbaseはBusiness Loop Control Planeとして、正本、承認、証跡、学習候補、判断DAGの責務を持ち続ける。

## User Story

Brainbase operatorとして、営業・マーケ・バックオフィス・開発などのRole Agent実行結果をEveから受け取りたい。なぜなら、外部runnerを入れ替えても、会社の判断資産と学習ループをBrainbase側に残したいから。

## Acceptance Criteria

- [ ] ac:1 `external_runner.v0` は `runner.type=eve` とEve trace参照を必須にする。
- [ ] ac:2 Eve実行結果はWorkflow Mission Controlのrun/context/human step/output/auditへ決定的に写る。
- [ ] ac:3 Role Agent、Workflow選択理由、Judgment DAG trace、停止条件、人間承認者が保存される。
- [ ] ac:4 Learning CandidateはGraph SSOTへ直昇格せず、Candidate Storeまたはdeferred auditとして残る。
- [ ] ac:5 外部送信・公開・契約・Graph昇格が必要な結果は人間承認待ちとして表現できる。
- [ ] ac:6 同じproject内の同じEve run idの再送は重複実行ではなく冪等なduplicateとして扱い、別projectの同一Eve run idは別runとして扱う。
- [ ] ac:7 既存Workflow IDを指定する場合、WorkflowのprojectとEve payloadのprojectが一致しないrunは保存前に拒否する。
- [ ] ac:8 service/internal credential以外の外部runner requestは、payloadのowner/cost owner/approval ownerを認証主体本人以外へ委任できない。
- [ ] ac:9 Mermaid図は既存ビューアで構文エラーにならない。

## Workflow State Scenarios

- `workflow state transition`: Eve `completed` statusはBrainbase `workflow_runs.status=success`、`closure_state=closed`、`action_required=none`へ遷移する。
- `workflow state transition`: Eve `approval_required` または `waiting_human` statusはBrainbase `workflow_runs.status=waiting_human`、`closure_state=open`、`action_required=approve`へ遷移し、`human_steps` を必須にする。
- `workflow state transition`: Eve `cancelled` statusはBrainbase `workflow_runs.status=cancelled`、`closure_state=closed`へ遷移する。
- `workflow state transition`: v0で未定義のEve statusは保存前に拒否する。
- `workflow retry matrix`: 同一 `run.project_id + runner.type + external_run_id` の再送は新規runを作らず、既存runを返すduplicateへ遷移する。別projectの同一 `external_run_id` はduplicate replayせず、project境界をまたがない。
- `workflow rollback guard`: `run.workflow_id` が既存Workflowと衝突した場合、既存Workflowのprojectとpayload projectが一致しないrunは保存前に拒否し、Workflow Mission Controlの既存run一覧へ混入させない。
- `workflow rollback guard`: `run.workflow_id` 未指定時にBrainbaseが生成するfallback Workflow IDはprojectごとに分離し、同じEve agent / external_run_idでも別projectのrunを既存Workflowへ混入させない。
- `workflow ownership guard`: service/internal credential以外の外部runner requestでは、`loop_control.owner_id`、`cost_owner_id`、`approval_owner_id` が認証主体本人と一致しないpayloadを保存前に拒否する。
- `workflow ownership guard`: service/internal credential以外の外部runner requestでは、Learning Candidateの暗黙 `actor_person_id` を認証済みpersonへ固定し、runner agentを人間本人の代理actorとして保存しない。
- `workflow rollback guard`: Learning CandidateはGraph SSOTへ直接昇格せず、Candidate Store保存またはdeferred auditへ遷移する。Candidate Store write失敗時もdeferred auditとして残し、duplicate replayで見える状態を保つ。

## Failure Modes

- `schema_failure`: contract必須項目、Eve trace、round evidence、stop condition、redaction、promotion policy、未定義status、空のhuman promptの違反は保存前に拒否する。
- `auth_denied`: `/api/external-runner` は `workflowAuthGuard` 配下で登録し、未認証の外部runner ingestをWorkflow Mission Controlへ入れない。
- `delegation_denied`: bearerなどの非service credentialは、payloadだけで別人をWorkflow owner、cost owner、approval ownerへ設定できない。
- `compatibility_guard`: 既存の `/api/sessions/report_activity` CSRF例外はローカルhook/CLI telemetry用であり、Eve Runtime Adapterのserver-to-server ingest境界とは分離して維持する。

## 非目標

- BrainbaseをEveへ置き換えない。
- Eveの全機能をBrainbase内に再実装しない。
- Learning Candidateを外部runner判断だけでGraph SSOTへ昇格しない。
- `/api/sessions/report_activity` のローカルhook/CLI telemetry契約は変更しない。
