# Architecture: same-organization cross-project endpoint references

## 決定

プロジェクト単位Snapshotの`entities`は変更対象scopeのまま維持する。同じorganization内の別projectにあるendpointは、payloadを持たない`external_entities`へ追加し、`reference_scope: same_organization`で既存cross-tenant参照と区別する。

既存Snapshotの`external_entities`に`reference_scope`がない場合は、後方互換のため`cross_tenant`として扱う。これにより、過去のcross-tenant Snapshotを通常の跨project参照として誤って緩和しない。

## データフロー

1. `loadSnapshot`は明示指定されたprojectのEntityとEdgeを取得する。
2. Edge endpointのうち`entities`にないIDを、callerのproject scopeかつsourceと同一organizationに限定してmetadata-onlyで取得する。
3. 両endpointが`entities`、same-organization参照、または既存のcanonical cross-tenant参照として解決できるEdgeだけを残す。
4. 除外した通常Edgeは、endpoint ID・project・organizationを含まない`suppression_summary`の件数と理由で監査可能にする。
5. same-organization参照とcross-tenant参照をIDで重複排除し、`external_entities`へ安定順で収録する。
6. `validateGraphSnapshot`はsame-organization参照を通常の参照整合性にだけ使用し、cross-tenant参照にだけcanonical `governs`制約を適用する。
7. Snapshot imageの再読込では、same-organization参照は同一organizationとproject access、cross-tenant参照は従来どおりCEO・別organization・両project accessを再確認する。

## 不変条件

- `entities`は明示された変更対象projectだけを含む。
- `external_entities`は参照整合性とversion readbackのためのmetadata-only projectionであり、payloadを含めない。
- same-organization参照はcallerの明示project accessなしに公開しない。
- cross-tenant参照は`decision -> product / governs`、CEO、双方project scope、restricted sensitivityの既存契約を維持する。
- markerなしexternal endpointはcross-tenantとして扱い、安全側へ倒す。
- 欠損・権限外endpointを持つEdgeは、修復前データを削除せずSnapshotから隠す。
- 隠した通常Edgeの監査証跡は集約値だけとし、endpoint識別子や所属scopeを漏らさない。
- canonical cross-tenant endpointが欠損・権限外ならSnapshot全体をfail closedにする。
- `suppression_summary`導入前のPlanとHuman Gateは自動補完しない。現在のSnapshotからPlanを再生成し、識別子なしの抑止集計を確認して再承認する。
- Graph maintenance serviceがEntity参照解決で使う`person`・`product`・`member_of`はwriter inventoryで明示し、未申告語彙の検出はfail closedを維持する。

## 採用しなかった案

### endpointを`entities`へ追加する

暗黙に変更対象project scopeとpayloadの範囲を広げ、`includeProjectCodes`の明示契約を壊すため採用しない。

### 個人KGから人物Entityを再作成する

正式Entityは既に存在し、原因はSnapshot参照解決の不整合である。重複Entityを作るため採用しない。

## 展開と確認

1. Unit testでsame-organization・権限外・cross-tenant互換とwriter inventoryの許可語彙を固定する。
2. Graph maintenance service/engineを同一SHAで展開する。
3. 本番反映後に`graph_validate(project_code=brainbase)`を読み戻し、既存8件のfalse orphanが解消し、新しい権限漏れがないことを確認する。

導入前に未適用だったPlanは破棄し、導入後のSnapshotで再Plan・再承認する。旧Gateを新しい抑止状態へ暗黙に流用しない。

手順3は未デプロイのPRでは完了扱いにしない。
