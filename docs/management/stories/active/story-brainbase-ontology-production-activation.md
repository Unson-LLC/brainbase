---
story_id: story-brainbase-ontology-production-activation
title: Ontology 1.0.0を本番で安全に有効化する
status: active
period: 2026-08
architecture: docs/architecture/story-brainbase-ontology-production-activation.md
spec: docs/specs/brainbase-ontology-production-activation.md
---

# Ontology 1.0.0を本番で安全に有効化する

## Story

BrainbaseのGraph運用責任者として、Ontology 1.0.0を実データ・権限・署名・復旧手順に結合して本番有効化したい。そうすることで、型・関係・制約・推論・変更履歴をcanonical writeで機械検証しつつ、誤った公開をfail closedで止められる。

## 利用文脈

- 誰のため: Brainbase Graphを読み書きする人、agent、canonical write runtime。
- 課題: Ontology 1.0.0の実装が存在しても、本番Graph、公開権限、署名、deploy済みruntimeが同じreleaseへ結合されなければ、安全に有効とは判断できない。
- 望む変化: 監査、修復、authority、署名、rollback、merge、deployを同一release digestとcommit lineageで追跡できる。
- 成果: 本番のcanonical writeが検証済みOntology 1.0.0へfail closedで拘束され、current releaseをAPIと監査証跡から再現できる。
- 事業価値: Graphの意味品質を運用者やagentの暗黙判断に依存させず、不正な組織事実やDecisionが後工程へ流れるリスクを減らす。
- 受け入れ基準: 本番Graph完全監査がcollection completeかつ0 violationである。
- 受け入れ基準: current releaseのdigestと署名receiptが本番runtimeで検証できる。
- 受け入れ基準: deploy後のhealth、version/current API、journal、再監査が合格し、不合格時は直前artifactへrollbackできる。

## 成功指標

| 指標 | 成功条件 |
|---|---|
| Graph品質 | DB-backed完全監査が`collection_complete: true`かつviolation 0件である。 |
| Release整合性 | version指定とcurrent指定のdigestが一致し、Ed25519 receipt検証が合格する。 |
| Runtime有効化 | merged SHAが本番serviceで稼働し、healthと起動後journalにRegistry・署名・DB接続エラーがない。 |
| 復旧可能性 | publication前の`current: null`へ戻す独立演習と、本番rollback手順・責任者が確認済みである。 |

## 人間の判断

2026-08-03、佐藤圭吾が次を承認した。

- 佐藤圭吾をOntology 1.0.0公開scopeの暫定Responsible / Accountable / Applierとする。
- 監査で残った61件を、削除せず、確認済み正本に基づいて修復する。
- 修復後監査、publication authority、署名receipt、ロールバック演習、VibePro Gateがすべて合格した場合のみ本番有効化する。

## 受入条件

- [x] 本番Graphの完全snapshotがOntology 1.0.0に対して0 violationである。
- [x] 修復はexact precondition、transaction、advisory lock、事前backup、事後再監査を持ち、deleteを行わない。
- [x] publication Decisionがversion、release digest、source commit、scope、impact、proposer、deciderを完全にbindする。
- [x] 同一scopeにResponsible、Accountable、ApplierのRACIが存在し、認証actorはapplier personと一致する。
- [x] Ed25519秘密鍵はInfisical productionだけに保存し、repositoryやログへ出さない。公開鍵とkey IDでreceiptを検証できる。
- [x] publisherだけが`current`、receipt、compatibility viewを変更し、source commitの直接の子をpublication commitとする。
- [x] publication commitを戻して`current: null`へ復旧する演習を独立checkoutで行い、`ontology:verify`が合格する。
- [ ] VibePro Gate、CI、merge、production deploy後のcurrent readbackとGraph auditが合格して初めて完了とする。

## 停止条件

署名鍵、actor binding、Decision/RACI、0 violation監査、rollback演習、VibePro Gate、CIのいずれかが未確認または不合格なら、`current`を変更せずNo-Goとする。

## リリース責任

- deploy / readback / observability / support / rollback owner: 佐藤圭吾
- project memberの追加操作: なし
- compatibility: 既存readとlegacy response契約を維持し、canonical writeだけをactive Ontologyへfail closedで結合する
- completion evidence: merged SHA、service health、API digest一致、署名receipt、完全Graph audit 0件、restart後ログ
- rollback target: 初回release直前の`current: null` artifact。Graph修復とgovernance factは保持する
