---
story_id: story-graph-person-supersession-ontology
title: 人物の統合履歴をsuperseded_by Edgeとして検証可能にする
status: active
period: 2026-08
architecture: docs/architecture/story-graph-person-supersession-ontology.md
spec: docs/specs/graph-person-supersession-ontology.md
---

# 人物の統合履歴をsuperseded_by Edgeとして検証可能にする

## Story

Graph運用責任者として、誤生成された人物からcanonical人物への統合履歴を、型付きの`superseded_by` Edgeとして保存・検証したい。そうすることで、旧IDを削除せず監査可能なまま通常利用から除外し、移行先をpayload文字列ではなくGraph関係として解決できる。

## 人間の判断

2026-08-21、佐藤圭吾はBatch 1の差分確認後、Ontology 1.1.0へ`superseded_by: person -> person`を追加し、既存の`per_ -> per_ota_shi` Edgeを正式な関係として検証可能にする方針を承認した。

## 受入条件

- [ ] Ontology 1.1.0が1.0.0からのadditive minor releaseとして登録される。
- [ ] `superseded_by`は`person`から`person`だけを許可し、他のendpointを拒否する。
- [ ] 1.0.0の既存語彙・制約を削除または狭窄しない。
- [ ] 提案release、署名Receipt、current viewのdigestとcommit lineageを既存publisherで検証できる。
- [ ] 本番のBatch 1 Edgeが1.1.0でrelation/endpoints違反を出さず、既存の別種の品質課題は解消済みと誤報しない。

## 停止条件

Decision/RACI、署名鍵、VibePro Gate、CI、稼働SHA、Receiptまたは本番読戻しのいずれかが不成立なら、1.1.0をcurrentへ変更しない。

## Rollout

1. proposed 1.1.0をmerge・deployし、本番Registryがversion指定で解決できることを確認する。
2. release digestとsource commitへ拘束したGraph Decisionを作成し、既存RACI authorityで署名Receiptを発行する。
3. publication commitをVibePro Gate経由でmerge・deployする。
4. current 1.1.0、署名、稼働SHA、Batch 1 Edgeの検証結果をreadbackする。

## Rollback

publication commitを戻し、currentとcompatibility viewを署名済み1.0.0へ復旧する。Batch 1のGraph Entity/Edgeと監査Receiptは削除しない。
