# Story: 跨プロジェクトEdgeの参照整合性を正しく検証する

## 利用者価値

Graph管理者として、プロジェクト単位のSnapshotを検証するとき、同じ組織内の正式なEntityを参照するEdgeを誤って孤立扱いせず、本当に欠損・権限外・別テナントの参照は引き続き閉じたまま確認したい。

## 背景

現在のGraph maintenance Snapshotは、EdgeのendpointがDBに存在することを確認してEdgeを残す一方、Snapshotの`entities`には選択したprojectのEntityしか収録しない。そのため、同じorganization内の別projectにある正式なendpointを参照するEdgeは、構造検証で`orphan`になる。

人物Entityの再作成やEdgeの付け替えではなく、Snapshotの参照モデルと検証境界を修復する。`entities`は変更対象scopeの正本、跨project endpointはpayloadを含まない参照専用metadataとして扱う。

## 受け入れ条件

- [ ] AC-001: callerが参照先projectへ明示アクセスでき、endpointがsourceと同じorganizationに属する場合、通常EdgeをSnapshotへ保持し、構造検証で孤立扱いしない。
- [ ] AC-002: 跨project endpointはpayloadを複製せず、`reference_scope: same_organization`を持つmetadata-only `external_entities`として表現する。`entities`と変更可能project scopeは暗黙に広げない。
- [ ] AC-003: 参照先projectが権限外、endpointが欠損、またはorganizationが異なる通常EdgeはSnapshotへ公開せず、識別子を含まない抑止件数と理由を返す。
- [ ] AC-004: 既存のcanonical cross-tenant `governs`契約は維持し、旧Snapshotのscope markerなし`external_entities`もcross-tenantとしてfail closedに検証する。
- [ ] AC-005: Snapshot再読込時にsame-organization参照をorganization・project access・versionまで再検証し、driftをhashへ反映する。

## 検証対象

- 同一組織・権限ありの跨project参照が`orphans: 0`になる。
- 権限外または欠損endpointを持つEdgeは公開されない。
- 抑止された通常Edgeは、endpoint IDを漏らさず件数と理由だけを監査できる。
- 非canonical cross-tenant Edgeは`cross_tenant_edge`のまま拒否される。
- markerなしの旧cross-tenant Snapshot互換性を維持する。

## 非対象

- Entityの再作成、統合、project移動
- Edge IDまたはendpoint IDのデータ更新
- 任意のcross-tenant Edge許可
- 本番Graphへの直接Apply
