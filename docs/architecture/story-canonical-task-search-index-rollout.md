# Architecture: Postgres切替後の検索索引適用

## 決定

初回のNocoDBからPostgresへの行移行と、切替後の加算的な検索索引適用を別workflowにする。

検索索引workflowは次の3段階だけを所有する。

1. 既存Canonical Task基礎schemaを検査する。
2. `pg_trgm`と2本の索引をtransaction外で冪等に適用する。
3. 両索引が`indisvalid`かつ`indisready`であることを検査する。

NocoDB行、Canonical Task本文、writer readinessはこのworkflowの対象外とする。
