---
story_id: story-loop-pack-design-gate-v0
title: Loop Pack Design Gate v0
status: active
created_at: 2026-06-25
updated_at: 2026-06-25
architecture_docs:
  - docs/architecture/loop-pack-design-gate-architecture.md
spec_docs:
  - docs/specs/story-loop-pack-design-gate-v0-spec.md
related_stories:
  - story-mana-meeting-workflow-pack-v0
  - story-mana-meeting-workflow-pack-data-v1
  - story-org-agent-loop-control-v0
---

# Loop Pack Design Gate v0

## 背景

BrainbaseのLoop Packは、単なる自動化テンプレートではない。業務の入力、判断、実行、人間承認、出力、証跡、Graph / Task / Decisionへの昇格候補、学習候補、次回反映までをまとめて扱う業務ループである。

Packを作る段階で設計が弱いままCodex、Claude Code、Eveなどへ実装を投げると、低品質なループが大量に走る。実行前に、ループ設計そのものを批判し、完了条件をルーブリック化し、停止条件と予算を決め、Judge席を置く必要がある。

このStoryは、LOOPER的な「ループ設計レイヤー」をBrainbaseのPack作成フローへ取り込む。ただしBrainbaseの中心は外部runnerではなく、Business Loop Control Planeである。CodexやClaude CodeはPack manifestを作る補助には使えるが、Brainbaseの正本状態を直接書き換えるものではない。

## User Story

Brainbase operatorとして、Meeting Workflow Packのような業務Packを作成する前に、Loop Pack Design Gateで目的、入力、Workflow、Trigger、Human Gate、監査証跡、昇格候補、学習候補、完了ルーブリック、停止条件、予算、Judge席を審査したい。そうすることで、実行してよいLoopだけをWorkflow Mission Controlへ取り込み、設計の弱い自動化が業務正本へ混入しないようにできる。

## Core Concept

```text
Design Layer
  Story / Architecture / Spec / Loop Pack Manifest / Rubric / Design Review

Control Plane
  Role Agent / Workflow Definition / Binding / Trigger / Loop Intent / Run / Human Step / Output / Audit

Runner Layer
  Eve / Codex / Claude Code / Mana / tool calls
```

CodexやClaude Codeに書かせてよいのは、Design Layerの宣言的なPack manifestである。Brainbaseがそのmanifestを検査し、通過したものだけをControl Planeの既存surfaceへcompileする。

## Scope

- Meeting Workflow Packの設計契約をLoop Pack manifestとして表現する。
- DeterministicなDesign Gateでmanifestを審査する。
- Bootstrap時にDesign Review結果を返し、audit logへ残す。
- 設計が不足しているPackは `needs_revision` として扱い、Control Planeへ取り込まない。

## Operator Flow

Pack作成前の確認は、永続化しないpreflight APIで行う。

```text
POST /api/workflows/control/meeting-pack/design-review
  input: org_id, project_id
  output: loop_pack_manifest, loop_pack_design_review
  side effect: なし

POST /api/workflows/control/meeting-pack/bootstrap
  input: org_id, project_id
  output: loop_pack_design_review, meeting_workflow_pack
  side effect: Design Gateがpassした場合だけWorkflow Control recordsとaudit logを書く
```

operatorはまず `design-review` でPack設計の問題を見て、`status=pass` のときだけ `bootstrap` へ進む。

## Engineering Judgment Spine

current_reality: Brainbaseには既にWorkflow Mission ControlのRole Agent、Workflow Definition、Binding、Trigger、Loop Intent、Auditのsurfaceがある。このStoryは新しい実行基盤や正本DBを作るのではなく、Meeting Workflow Packを既存surfaceへ取り込む前のDesign Gateを追加する。

failure_modes: 設計不足のmanifest、Human Gateの抜け、providerを起動してしまうPack作成、証跡がauditに残らないbootstrap、runtime ledgerを直接変えるPack作成を失敗モードとして扱う。

done_evidence: Design Review preflightはno-writeで返り、bootstrapはDesign Gate通過時のみWorkflow Control recordsとaudit logを書く。対象route/service/unit test、typecheck、diff check、VibePro verification recordでHEAD boundに確認する。

release_or_operation: Operatorはまず `design-review` を使い、`status=pass` のPackだけを `bootstrap` する。rollbackはこのcommitのrevertまたは新endpointの利用停止で足り、v0は新collectionや不可逆migrationを持たない。

## Acceptance Criteria

- [ ] Pack manifestは `target_business_process`、`purpose`、`inputs`、`role_agent`、`workflow_templates`、`bindings`、`triggers`、`human_gates`、`outputs`、`audit_evidence`、`promotion_candidates`、`learning_candidates`、`success_metrics`、`completion_rubric`、`stop_conditions`、`budget`、`judge_seats` を持つ。
- [ ] Design Gateは、Pack作成前に目的、入力、Trigger、Human Gate、監査証跡、昇格候補、学習候補、完了ルーブリック、停止条件、予算、Judge席を deterministic に審査する。
- [ ] Design Gateを通過したMeeting Workflow Packだけが、既存の `role_agent_instances`、`workflow_templates`、`workflow_bindings`、`workflow_triggers`、`loop_intents` へ取り込まれる。
- [ ] Bootstrap APIは `loop_pack_design_review` を返し、audit logにもDesign Reviewのdigest、status、rubric、issuesを残す。
- [ ] Design Gateが `needs_revision` の場合、bootstrapはWorkflow Control recordsを書かずにvalidation errorを返す。
- [ ] CodexやClaude Codeが作るものはPack manifestであり、隠れたruntime stateやWorkflow Control ledgerを直接更新する前提にしない。
- [ ] Meeting Workflow Packは、会議前準備から議事録、Task、Decision、Follow-up、Graph昇格候補、学習候補、次回会議準備へ戻るLoop closureを完了ルーブリックに持つ。
- [ ] Design GateはAI judgeではなく、まず deterministic contract gate として実装されている。

## Non-goals

- v0では新しいPack作成UIを実装しない。
- v0ではEve実行やrunner orchestrationを実装しない。
- v0ではWorkflow Mission Controlの永続ledgerに新しいcollectionを追加しない。
- v0ではLLM Councilの実モデル呼び出しを実装しない。
