# Architecture: Project Provisioning Graph Preflight

`ProjectProvisioningService.check`を、Registry・Graph・Grant・Repositoryへ書き込む前の唯一の衝突判定点として維持します。Graphの同一ID確認は通常のRLS queryだけに依存せず、完全一致IDだけを照会する`SECURITY DEFINER`関数を追加します。

限定関数は、呼出元が提示した`entity_id`について、DBセッションの`app.organization_id`と同一組織ならProject subjectの互換性判定に必要な最小projectionだけを返します。組織コンテキスト未設定時は拒否します。別組織の場合は`other_organization`という衝突区分だけを返し、所有組織、project名、payloadを返しません。関数本体は`projects.organization_id`へ結合し、`search_path`を固定し、PUBLIC実行権限を剥奪します。

Repositoryは限定関数の結果と、既存のRLS-scoped display name／alias検索を別々に扱います。Serviceは同一IDの結果を次のように判定します。

- 不在: 新規作成候補として継続
- 同一組織・完全一致・既存scopeへアクセス可能: 再利用候補として継続
- 別組織: 情報を開示せず同一ID衝突
- 同一組織・identity不一致: Graph identity衝突
- 同一組織・scopeアクセスなし: 権限を自動拡張せずscope衝突

planは再利用元scopeとentity versionを保存します。applyはRegistry書込前に限定関数を再実行し、承認済みplan、現在のsubject、適用者のscopeが一致しない場合はrunを`planned`のまま拒否します。Graph stepの`assertCompatibleProjectSubject`とGraph Maintenanceのtenant guardも最終防御として残します。

Graph新規作成後にGrantやRepositoryで失敗したrunは、再開時点では自分が作成したsubjectを観測します。この場合だけ、Graph stepが`completed`であり、新規作成用のplan/apply/validation Receiptが揃い、Graphから再取得したapply Receiptのplan ID・apply Receipt ID・対象project scope・`project-provisioning:{run_id}:graph` idempotency keyと、対象subjectのCatalog version・sourceがすべて一致することを確認して再開します。`already_materialized` Receipt、別run/planのReceipt、改変されたReceipt、別scopeのsubjectはこの例外に含めず、従来どおり明示scopeを要求します。

再利用した場合の最終verifyは、Graph step receiptの再利用元scopeとversionを限定関数で再読込し、そのscope自体をvalidateします。対象の空scopeだけを検証してactive化することはありません。これによりcheck後・Graph step後の変更をどちらもfail-closedにします。

## 後方互換性

配備前の`project-provisioning-plan.v1`に`graph_project_subject`がない場合は、applyがclaimやRegistry書込を行う前に同じ限定readbackを実行します。identityが不在、完全一致かつ既存scopeへアクセス可能、または当該runの完了済みGraph新規作成Receiptと対象scopeが一致する場合だけ、今回の実行中に使うpreflightとして補完します。不整合、別組織、scope不足は書込前に拒否します。

## 変更境界

- `server/sql/project-provisioning-schema.sql`: 限定readback関数
- `server/sql/info-ssot-readback.sql`: 関数とsecurity contractのreadback
- `server/services/project-provisioning/project-provisioning-repository.js`: ID probe
- `server/services/project-provisioning/project-provisioning-service.js`: 書込前の互換性・scope判定
- 対象unit／PostgreSQL統合試験

自動rehome、所有権移管、Graph payloadの自動修正は行いません。

## 検証

限定readback関数、Repository、Service、HTTP/CLIの各境界を単体試験で確認します。実PostgreSQL統合試験では、不在、同一組織での再利用、identity不一致、別組織、scope不足、競合時の一括rollback、step Receiptの不変性を区別し、書込件数と最終readbackを検証します。
