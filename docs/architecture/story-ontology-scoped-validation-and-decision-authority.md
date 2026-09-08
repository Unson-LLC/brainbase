# Architecture: scoped ontology validation and decision authority

## センターピン

Snapshot内の全Entityは参照解決に使う。一方、required relationの検証対象は「対象projectに属し、activeなEntity」だけに限定する。実データのauthority欠損は検証器で隠さず、Graph Planでdecider edgeを追加する。

## 境界

- `GraphMaintenanceService.validate`がOntology Kernelへ`required_relation_validation_entity_ids`を渡す。
- Entity-level制約はlocal・external・retiredを含む従来の検証対象を維持し、必須関係だけをactive local Entityへ限定する。
- ID集合は`snapshot.entities`のうち`lifecycle_status === 'active'`のEntityだけから作る。
- `snapshot.external_entities`は型解決のため`entities`へ残すが、検証対象ID集合には入れない。
- active edgeだけをOntology Kernelへ渡す既存契約は維持する。
- `graph_validate`の`required_relation_scope_summary`は、明示的に許可された対象project群のactive・retired・superseded local Entityと、参照解決用external metadata Entityを件数だけで分類する。Entity IDとpayloadは返さない。
- active Decisionのdecider修復はSnapshot -> Dry Run Plan -> Apply receipt -> readback -> validateで行う。

## 失敗時の扱い

- 外部endpointが欠損または権限外なら、既存どおり抑止または構造違反にする。
- active Decisionにdecider edgeがなければ、修正後も`CON-DECISION-DECIDER-001`を返す。
- Graph Planのbase hashまたはversionが変わった場合はApplyしない。
