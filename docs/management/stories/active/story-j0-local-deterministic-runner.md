---
story_id: story-j0-local-deterministic-runner
title: J0 ローカル決定論的ランナーと不変run記録
status: active
category: architecture
spec: docs/specs/j0-local-deterministic-runner.md
architecture: docs/architecture/story-j0-local-deterministic-runner.md
canonical_story_path: docs/management/stories/active/story-j0-local-deterministic-runner.md
created_at: 2026-08-21
updated_at: 2026-08-21
---

# J0 ローカル決定論的ランナーと不変run記録

## Intent

Brainbase OSSの利用者として、検証済みJudgment DAGを明示的なrunner登録だけで安定した順序に実行し、DAG version、入力、依存出力、node出力、実行順を一つの不変run記録として読み戻したい。これにより、隠れた状態や組織固有runtimeへ依存せず、後続の永続化・replay・評価を構築できる。

## 受け入れ基準

- [x] AC-001: `JudgmentDAGRunRequest`、runner登録、runner入力、node実行記録、run記録をreadonlyな公開型として`./judgment-dag`から提供する。
- [x] AC-002: DAG構造と全nodeに必要なrunner登録を、runnerを一度も呼ぶ前にfail-closedで検証する。欠落runnerはmachine-readable errorになり、invalid DAGのvalidator error code/detailsは無改変で保持する。
- [x] AC-003: `validateJudgmentDAG`が返す安定したtopological orderで各nodeを一度だけ実行し、runnerへ渡すdependency outputsはそのnodeが宣言した直接依存だけに限定する。
- [x] AC-004: DAG、run input、dependency outputs、runner outputsを実行境界でJSON snapshot化し、callerまたはrunnerによる後続mutationが返却済みrun記録を変更しない。非JSON値と循環値は実行前またはnode境界で拒否する。
- [x] AC-005: 成功runは実行開始前にsnapshotしたcaller指定`run_id`、DAG ID/version、runner version、execution order、nodeごとのinput/output contractと出力を含むdeep-frozenな記録を返し、同じDAG・入力・runnerに対して同値になる。
- [ ] AC-006: 既存J0契約、package deep import互換、MCP/CLI起動面を壊さず、対象unit・公開consumer smoke・full test・build・typecheckが通る（回帰証拠は揃っているが、VibePro独立review 21 role未完のためGate完了・Story完了にはしていない）。

## 境界

- runner callbackは外部副作用を行わないlocal deterministic実装を対象とする。権限付与や副作用安全性の証拠にはしない。
- human / agent / committee / external runnerの待機、承認、再試行、取消、idempotencyはG0側の後続Storyとする。
- filesystem/database artifact store、historical replay、version比較、outcome attachment、evaluation scoring、評価event-set immutabilityはR1側の後続Storyとする。
- `input_contract` / `output_contract`は既存の契約参照文字列として記録する。このStoryで任意schema registryやpayload schema validationを新設しない。
- MCP tool、CLI command、HTTP route、database、tenant、secret、production deploy、customer dataを変更しない。

## 完了証拠

Red→Greenの対象unit、公開subpath consumer、既存J0回帰、full test、build、typecheckを同一HEADへ結び付ける。現時点のregression evidenceは揃っているが、VibePro独立review 21 roleが未記録のためGateはpendingとし、Storyを完了扱いにしない。PR作成とmergeはGateがcurrent HEADで成立した後に別判断する。
