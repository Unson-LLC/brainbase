# Architecture: Project Catalog ProjectのGraph subject projection

## 境界

`project_code`は認可・実行scopeであり、Decisionの業務対象ではない。業務対象は`governs` Edgeで表す。

Phase 0.3は汎用作成操作を公開せず、次の二つだけを追加する。

1. `materialize_project_subject`: `catalog_project_id === entity_id`を必須にし、Project型の最小projectionを対象scopeへversion 1で生成する。
2. `link_decision_project_subject`: Decisionの認可scope内に投影したactive Projectを`governs`で接続する。

両操作は同一Planに入れられる。Plan engineはmaterialize後のProjectを後続linkから参照する。Applyは既存のSnapshot置換、Human Gate、Receipt、rollback機構を使う。

## 安全条件

- materializeは`expected_version=0`のみ。既存IDは競合として停止する。
- 呼び出し元は`catalog_project_id`だけを指定する。`entity_id`、`name`、`catalog_version`、`source_ref`はサーバーが認証済みProject Catalog正本へ束縛し、自己申告値を採用しない。
- Catalog sourceが欠落・無効、対象がactive catalogにない、actor grant外、`name`または正の`catalog_version`がない場合はPlan作成前にfail closedする。
- Project payloadは`name`、`catalog_project_id`、`catalog_version`、`source_ref`の最小項目だけを許可する。
- Decision接続はPlanに束縛されたHuman Gateを必須とする。
- Projectは業務対象のprojectionとしてDecisionと同じ認可scopeへ置く。Catalog上の所属を`project_code`へ転用しない。
- cross-tenant Product用`link_decision_subject`は独立したまま維持する。
