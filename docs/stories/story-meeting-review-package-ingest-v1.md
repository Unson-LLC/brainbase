---
story_id: story-meeting-review-package-ingest-v1
title: Meeting Review Package Ingest v1
status: active
created_at: 2026-06-25
updated_at: 2026-06-25
architecture_docs:
  - docs/architecture/meeting-review-package-ingest-architecture.md
spec_docs:
  - docs/specs/story-meeting-review-package-ingest-v1-spec.md
related_stories:
  - story-mana-meeting-workflow-pack-data-v1
  - story-meeting-workflow-calendar-input-v1
  - story-meeting-workflow-pack-cockpit-ui-v1
  - story-brainbase-workflow-mission-control
---

# Meeting Review Package Ingest v1

## 背景

Meeting Workflow Pack は、Role Agent、Workflow Template、Binding、Trigger、Loop Intent までは Brainbase の Workflow Control に載った。次に必要なのは Cloudflare/computer 接続ではなく、実会議から生成した Review Package を `workflow_runs`、`workflow_outputs`、`workflow_human_steps`、`workflow_audit_logs` に載せ、最初の業務ループを人間確認まで進めることである。

この Story は Cloudflare/computer を接続しない。Codex が生成した Review Package を一時的な実行結果候補として取り込み、Brainbase 側に判断、出力、承認待ち、証跡を残す。Cloudflare/computer は後続 Story で同じ出力契約に差し替える。

## User Story

Brainbase operator として、Mana の実会議から作った Review Package を Workflow Mission Control に取り込みたい。そうすることで、議事録ドラフト、Task 候補、Decision 候補、フォローアップ文面、Graph / Learning 昇格候補を、人間承認待ちの業務ループとして一画面で確認できる。

## Scope

- `POST /api/workflows/control/meeting-pack/review-ingest` を追加する。
- 入力は JSON の Review Package とし、API はローカルファイルパスを直接読む責務を持たない。
- `meeting_identity.candidate_org_id`、`meeting_identity.candidate_project_id`、`meeting_identity.case_scope` を Brainbase 側の業務スコープとして正規化する。
- Review Package に必要な output payload key と `loop_intent_ids` が揃っており、各 Loop Intent が同じ org / project の既存 Loop Intent であることを検証する。
- Codex 生成物は `runner.type=codex_generated_package` として記録し、Cloudflare/computer 実行済みとは扱わない。
- 取り込みは単一の `meeting_review_package_ingest` run として記録し、各 output に対応する Loop Intent と evidence を紐付ける。
- 1件のHuman Gateを承認しても残りの承認待ちをMission Control上に残し、全Human Gate承認後だけrunを閉じる。
- 1件のHuman GateがRejectされた場合はReview Package run全体を `cancelled/closed` とし、残りのpending stepも停止して後続Approveで `success/closed` に戻さない。
- 既存のmanual run / rerun APIから `meeting-review-package-ingest` workflowを実行して、Review Packageなしの成功runを作ることを禁止する。
- Tech Knight / UnitedホテルDX案件のReview Package fixtureを再実行可能なsmoke入力として残す。
- Task 作成、Decision / Graph 昇格、Slack / Gmail 送信、Learning promotion は実行しない。

## Current Reality

- Manaの会議ループは、Calendar/Slack/議事録候補を人間が見て判断している段階で、Cloudflare/computerの実runner接続はまだない。
- 既存のWorkflow Mission Controlには `workflow_runs`、context snapshots、outputs、human steps、audit logs があり、最初の一周はこの既存面へCodex生成Packageを載せるのが最短である。
- Graph SSOTやTask Storeへ直書きすると、候補と正本の境界が壊れるため、v1は承認待ち候補として止める。

## Acceptance Criteria

- [ ] ac:1 Review Package ingest API は、許可された `org_id` / `project_id` の operator だけが呼び出せる。
- [ ] ac:2 `org_id` / `project_id` は明示入力を優先し、なければ `meeting_identity.candidate_org_id` / `candidate_project_id` から補う。
- [ ] ac:3 `case_scope`、Calendar event、Slack source、Graph context、transcript hash は run metadata と context snapshot に残る。
- [ ] ac:4 `loop_intent_ids` は既存 Loop Intent と照合され、project mismatch や missing は書き込み前に拒否される。
- [ ] ac:5 取り込み run は `status=waiting_human`、`closure_state=open`、`action_required=approve`、`human_waiting=true` になる。
- [ ] ac:6 `workflow_outputs` には議事録ドラフト、Task 候補、Decision 候補、フォローアップ文面、Graph / Learning 昇格候補が保存される。
- [ ] ac:7 各 output は `package_id`、`loop_intent_id`、`write_back_target`、`evidence_refs`、`requires_human_approval=true` を持つ。
- [ ] ac:8 `workflow_human_steps` には meeting note publish、task create、decision / graph promotion、follow-up external send、learning / promotion confirmation の pending step が作られる。
- [ ] ac:9 取り込みは `package_id + org_id + project_id` で冪等になり、再実行しても run / output / human step を重複作成しない。
- [ ] ac:10 Audit log は ingest した package、run、output、human step、loop intent、runner type、state transition を記録する。
- [ ] ac:11 Cloudflare/computer 接続は後続 Story とし、この Story では Cloudflare/computer 成功や外部runner実行済みを名乗らない。
- [ ] ac:12 1件のHuman Gateを承認しても review run は `waiting_human` のまま残り、全Human Gate承認後だけ `success/closed` になる。
- [ ] ac:13 Tech Knight / UnitedホテルDX案件のReview Package fixtureを再実行でき、`/workflows` で承認待ちrunとして確認できる。
- [ ] ac:14 `meeting-review-package-ingest` workflow は既存のmanual run / rerun APIから実行できず、Review Packageなしの `success/closed` runを作らない。
- [ ] ac:15 Review PackageのHuman GateがRejectされた場合はrunが `cancelled/closed` で止まり、残りのpending stepは停止され、後続Approveで成功扱いにならない。

## Done Evidence

- API/service testで、正常取り込み、冪等、scope/loop intent/payload validation、approval progression、transaction rollbackを確認する。
- E2E contractで、S-001/S-003/S-004/S-005/S-006/S-007/S-008/S-009を含む実行可能なassertionを確認する。
- `/workflows` UI smokeで、Review Package runが `waiting_human` として見え、5つのApproveボタンが出ること、Review Package専用runに汎用Run/Rerun操作が出ないことを確認する。
- UnitedホテルDX fixtureを再実行し、5 outputs、5 human steps、context hash、auditが作られることを確認する。

## Failure Modes

- `org_id` / `project_id` が解決不能、またはactorがprojectにアクセスできない場合は `blocked_invalid_scope` として書かない。
- required payload keyが欠落している場合は `blocked_invalid_review_package` として書かない。
- required `loop_intent_ids` が欠落、存在しない、別project所属の場合は `blocked_loop_intent_mismatch` として書かない。
- 永続化途中で失敗した場合はtransaction rollbackし、run/output/human step/auditの部分書きを残さない。
- 1件だけHuman Gateを承認した場合はrunを閉じず、残りpending approvalsをMission Controlに表示し続ける。
- 1件のHuman GateをRejectした場合はrunを `cancelled/closed` にし、残りpending approvalsを停止して、後続Approveで `success/closed` に戻さない。
- 既存のmanual run / rerun導線からReview Package ingest workflowが呼ばれた場合は、validation errorで拒否し、追加run/output/human stepを作らない。

## Operator / Rollback

- Operatorの入口は `/workflows` の `Meeting Review Package Ingest` runであり、Mac CompanionやCloudflare/computer接続前でもWebのWorkflow Mission Controlで承認待ちを確認できる。
- v1のrollbackは外部副作用の取り消しではない。v1は外部送信、Task作成、Graph昇格を実行しないため、誤取り込み時は対象package_idのrun/output/human step/auditを運用手順で無効化または再取り込み対象外にする。
- Release noteでは「Cloudflare/computer未接続」「Codex生成Packageの候補取り込み」「全write-backはHuman Gate以降」と明記する。

## State Transitions

- `package_received`: Review Package JSON を受け取る。
- `scope_resolved`: org / project / case scope を決定する。
- `loop_intents_verified`: 既存 Loop Intent と照合する。
- `run_recorded`: ingest run と context snapshot を作成する。
- `outputs_recorded`: output 候補を保存する。
- `human_steps_recorded`: Human Gate を pending として作成する。
- `waiting_human`: operator の承認待ちとして停止する。
- `blocked_invalid_scope`: project / org / case scope が解決できない。
- `blocked_invalid_review_package`: output payload key が欠落している。
- `blocked_loop_intent_mismatch`: Loop Intent が存在しない、または別 project に属する。
- `idempotent_replay`: 同じ package が既に取り込まれているため既存 run を返す。
- `approval_progressed`: 一部のHuman Gateが承認され、残りの承認待ちを維持する。
- `approvals_completed`: すべてのHuman Gateが承認され、review runを閉じる。
- `approval_rejected`: いずれかのHuman GateがRejectされ、review runをcancelledとして閉じる。

## Non-goals

- Cloudflare/computer agent の実行。
- Mana への書き戻し。
- Task Store への task 作成。
- Graph SSOT への Decision 昇格。
- Slack / Gmail / Google への外部送信。
- Review Package の自然言語 Markdown パース。
