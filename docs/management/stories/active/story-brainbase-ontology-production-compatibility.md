---
story_id: story-brainbase-ontology-production-compatibility
title: 本番GraphとOntology 1.0.0の互換性を確立する
status: active
period: 2026-08
architecture: docs/architecture/ADR-021-brainbase-ontology-kernel.md
reason: "alternatives considered: 新規ADR作成と既存ADR更新を検討; compatibility impact: 既存Graph表現を互換語彙として受理し公開契約は変更しない; rollback plan: kernelと監査証跡のcommitをrevertして旧判定へ戻す; boundary and scope: ADR-021の既存境界内で構成、データフロー、authority境界を変更しないため追加ADRは不要"
spec: docs/specs/brainbase-ontology-production-compatibility.md
---

# 本番GraphとOntology 1.0.0の互換性を確立する

## Story

BrainbaseのGraphを運用する人として、既存の正当な型・関係・Decision表現をOntology候補で再現可能に監査したい。そうすることで、6,000件超の偽陽性に埋もれず、owner欠落・孤児edge・根拠不足のDecisionという実際に修復すべきデータだけを判断できる。

## 背景と基準値

2026-08-03の本番read-only監査では、7,403 entities / 6,680 edgesに対して6,156件の違反を検出した。主因は、稼働中の`belongs_to_project`始点型、storage型、legacy relation、Decisionのedge表現がOntology 1.0.0候補に未登録だったことである。一方、31件の孤児edge、org ownerを確認できない26 app、Decision authority/scopeの欠損は事実を推測せず残す必要がある。

## 受入条件

- [ ] 本番で実在し、両endpointを確認できた型・relationは`canonical`または`compatibility`として機械可読に分類され、未知語彙違反にならない。
- [ ] `belongs_to_project`は本番で確認した始点型と複数project所属を許容し、既存5,902件のendpoint違反と4件の誤ったcardinality違反を再現fixtureで解消する。
- [ ] `decided` Decisionは有効な判断として扱い、decider personとscope projectをpayloadの架空fieldではなく既存edgeから検証・推論できる。
- [ ] owner orgを確認できないapp、孤児edge、endpoint未確認relationは、互換化によって合格扱いにしない。
- [ ] 変更後kernelを本番snapshotへread-onlyで適用し、違反内訳と収集完全性を記録する。DB障害やpartial collectionは0件扱いにしない。
- [ ] `current`、署名鍵、Decision/RACIのpublication bindingは変更しない。残存違反とauthorityが解消するまで本番有効化はNo-Goを維持する。

旧キーワード互換解決（deprecated）は、名称だけでは登録せず、本番で両endpoint型を確認できた語彙だけを`compatibility`分類へ移す。endpoint未確認の旧relationは未登録のまま残し、移行先を推測しない。

## 成功指標

| 指標 | 成功条件 |
|---|---|
| 偽陽性削減 | 既知の語彙差による偽陽性を95%以上削減する。 |
| 残存違反 | データ修復またはauthority整備が必要な項目として件数別に説明できる。 |
| 検証 | 対象unit/contract test、Ontology verify、VibePro Gateがcurrent HEADに対してpassする。 |

## 検証結果

| 項目 | 結果 |
|---|---|
| production shadow audit | 6,156件から61件へ削減（99.009%） |
| 語彙・relation endpoint・cardinality違反 | 0件 |
| 残存 | 孤立edge 31件、app owner 26件、Decision decider 3件、Decision scope 1件 |
| evidence | `docs/management/audit-artifacts/story-brainbase-ontology-production-compatibility/production-shadow-audit-2026-08-03.json` |
| activation | No-Goを維持 |

## 非対象

| 非対象項目 | 理由 |
|---|---|
| 孤児edgeの削除 | Graph factの変更は別の修復作業として扱う。 |
| app owner、Decision decider/scopeの推測または自動生成 | authorityとscopeを名称や周辺情報から推測しない。 |
| publication Decision/RACIや署名鍵の作成 | publication authorityは別の証跡付き作業で整備する。 |
| `config/ontology/index.json`の`current`変更と本番guard有効化 | 残存違反とauthorityが解消するまでNo-Goを維持する。 |
