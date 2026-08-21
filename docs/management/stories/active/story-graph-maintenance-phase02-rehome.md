# Story: Graph Maintenance Phase 0.2 cross-scope rehome

## 利用者価値

Graph管理者として、Decisionを別project scopeへ移すとき、認可scopeと業務上の所属関係を矛盾させず、dry-run差分を確認してから安全に適用・復元したい。

## 背景

現行`move_scope`はEntityとincident Edgeの`project_code`だけを変更し、active `belongs_to_project`の接続先を旧Projectのまま残す。単一project Snapshotは別scopeのcanonical Project entityを解決できないため、現行PlanをApplyすると新しい構造不整合を作り得る。

## 受け入れ条件

- [x] AC-001: Snapshotは要求された全project codeを同一organizationかつcallerの全project scopeで検証し、複合scope hashを返す。未紐付け・別tenant・scope不足はfail closedになる。
- [x] AC-002: `rehome_entity`はEntityをtarget scopeへ移し、旧active `belongs_to_project` Edgeをretireし、target Project entityへの新active Edgeを作る。すべてのversionとexpected versionを検証する。
- [x] AC-003: active `belongs_to_project`はsource Entity、Edge、target Project entityの`project_code`が一致しないPlanを拒否する。既存baseline違反は増やさない。
- [x] AC-004: Applyはbeforeの全scope hashをlock下で確認し、afterを単一transactionでreadbackする。Rollbackは作成Edgeを削除して全scopeのrows/hashを完全復元する。
- [x] AC-005: `aitle`と`unson`のorganization紐付けは明示的・冪等なmigrationで行い、未知projectを一括で割り当てない。
- [x] AC-006: REST/MCPは複合scopeと`rehome_entity`契約を公開し、利用者scope外のtargetをHTTP送信前またはservice transaction開始時に構造化拒否する。

## 非対象

- DecisionからIntentへのtype transition
- Ontology 1.2.0の公開
- Batch 2の本番Apply
