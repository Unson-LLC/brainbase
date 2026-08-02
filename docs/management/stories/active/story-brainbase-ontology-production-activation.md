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
