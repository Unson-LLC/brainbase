---
story_id: story-loop-pack-design-gate-v0
title: Loop Pack Design Gate v0 Spec
status: active
created_at: 2026-06-25
updated_at: 2026-06-25
diagrams:
  - kind: flow
    path: docs/architecture/loop-pack-design-gate-architecture.md
    purpose: design-review preflight、bootstrap write path、Design Gate、Workflow Control compile境界のflowを示す。
  - kind: state
    path: docs/architecture/loop-pack-design-gate-architecture.md
    purpose: manifest draft、pass、needs_revision、compiled、audit recordedの状態遷移を示す。
---

# Loop Pack Design Gate v0 Spec

## 契約

Loop Pack Design Gate v0は、BrainbaseがPackをWorkflow Mission Control recordsへcompileする前に、宣言的なLoop Pack Manifestを審査する。Gateはdeterministicに動き、LLM呼び出しに依存しない。

## 不変条件

- INV-001: Codex、Claude Code、Cloudflare/computerはBrainbaseのSSOTではない。
- INV-002: Pack manifestはpurpose、inputs、workflows、bindings、triggers、human gates、outputs、audit evidence、promotion candidates、learning candidates、success metrics、completion rubric、stop conditions、budget、judge seatsを定義しなければならない。
- INV-003: Design Gateに失敗したPackは `role_agent_instances`、`workflow_templates`、`workflow_bindings`、`workflow_triggers`、`loop_intents` を書いてはならない。
- INV-004: Meeting Workflow Pack bootstrapは `loop_pack_design_review` を返さなければならない。
- INV-005: Meeting Workflow Pack bootstrapのauditにはDesign Reviewのstatusとdigestが残る。
- INV-006: external send、Task creation、Graph / Decision promotionの副作用前にはHuman approvalが必要である。
- INV-007: Design Gate結果は自由文の雰囲気ではなく、構造化されたmanifest fieldsから導出される。
- INV-008: GateはLoop Pack用の第二runtime databaseを導入しない。
- INV-009: `POST /api/workflows/control/meeting-pack/design-review` はWorkflow Control recordsを永続化せずにDesign Reviewを返す。

## シナリオ

### S-001: Meeting Pack design reviewが通る

Given Meeting Workflow Pack manifestが対象業務、目的、入力、5つのWorkflow Definition、binding、trigger、Human Gate、audit evidence、promotion candidate、learning candidate、success metric、completion rubric、stop condition、budget、judge seatを持つ。
When Brainbaseがmanifestを審査する。
Then Design Gateは `status=pass` を返す。

### S-002: Bootstrapがdesign review evidenceを保存する

Given Meeting Workflow Pack design reviewが通っている。
When operatorが `POST /api/workflows/control/meeting-pack/bootstrap` を呼ぶ。
Then Brainbaseは既存のWorkflow Control recordsを書き、`loop_pack_design_review` を返す。
And audit logsにはreview digestとstatusが残る。

### S-002a: Preflight design reviewは副作用を持たない

Given operatorがimport前にMeeting Workflow Packを確認したい。
When operatorが `org_id` と `project_id` 付きで `POST /api/workflows/control/meeting-pack/design-review` を呼ぶ。
Then Brainbaseは `loop_pack_manifest` と `loop_pack_design_review` を返す。
And BrainbaseはRole Agent、Workflow Definition、Binding、Trigger、Loop Intent、audit recordsを書かない。

### S-003: Completion rubricがないPack importは止まる

Given Loop Pack manifestに `completion_rubric` がない。
When Brainbaseがmanifestを審査する。
Then Design Gateは `status=needs_revision` を返す。
And bootstrapはWorkflow Control recordsを書いてはならない。

### S-004: 危険な副作用はPack importを止める

Given PackがHuman Gate protectionなしにGraph promotion、Task creation、external send outputを持つ。
When Brainbaseがmanifestを審査する。
Then Design Gateは `unsafe_side_effect` 付きで `status=needs_revision` を返す。

### S-005: Direct runtime mutationはPack作成として受け付けない

Given CodexまたはClaude CodeがPackをdraftする。
When Packがimportされる。
Then Brainbaseは宣言的manifestとreview resultだけを受け付ける。
And hidden runtime ledger mutationをsource of truthとして受け付けない。

## Diagrams

- kind: flow
  path: `docs/architecture/loop-pack-design-gate-architecture.md`
  purpose: `design-review` のno-write preflight、`bootstrap` のwrite path、Design Gate、Workflow Control compile境界を示す。
- kind: state
  path: `docs/architecture/loop-pack-design-gate-architecture.md`
  purpose: Pack manifest draft、`pass`、`needs_revision`、compiled、audit recorded の状態遷移を示す。

## Failure Mode Coverage

- FM-001 schema_failure: manifestの必須sectionやHuman Gate protectionが欠ける場合、Design Gateは `needs_revision` を返し、bootstrapはControl Plane recordを書かない。
- FM-002 provider_failure: Pack bootstrapはrunner/providerを起動しない。外部providerやMana/Cloudflare/computer実行の失敗はPack作成時の依存にしない。
- FM-003 evidence_lifecycle_regression: bootstrap auditはDesign Reviewのstatus、digest、issues、rubricを保持し、PR Gateの証跡はHEAD boundなVibePro verification recordで再構成できる。

## Verification

- `npm run test:run -- tests/server/services/loop-pack-design-gate.test.js`
- `npm run test:run -- tests/server/services/workflow-org-agent-control.test.js tests/server/routes/workflows.test.js`
- `npm run typecheck`
- `git diff --check`
