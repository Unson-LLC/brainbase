# Architecture: Project Provisioning v1

`ProjectProvisioningService` が状態遷移とstep順序を所有します。HTTP APIとCLIとSkillは薄い入口であり、直接SQLやGraph書き込みを行いません。

永続層は `project_registry`、`project_provisioning_runs`、`project_provisioning_steps` です。Graph stepは既存の `GraphMaintenanceService` を、権限stepは `AuthGrantService` を使用します。外部GitHub操作はRepository Bootstrap adapterが存在するときだけ実行し、存在しなければfail-closedにします。

3表は `app.organization_id` による `ENABLE/FORCE ROW LEVEL SECURITY` で分離します。Repositoryは各トランザクションで組織コンテキストを設定し、組織指定のない実行時Catalog読込はRegistryへ到達させません。移行未適用時はRegistryを`unavailable`として扱い、既存のローカルCatalogを組織membershipや権限根拠にせず空の選択可能一覧を返します。`/api/health`と`/api/config/integrity`も同じadapterでRegistry schemaの実在を確認し、legacy設定だけが読める状態をhealthyにしません。Registry由来の行を既存Catalogへ重ねる場合も、既存aliasを保持し、Repository情報をGitHub selector用metadataへ投影します。

適用順は Registry → Graph → Auth Grants → Repository boundary です。すべてのPlanはManifestと差分全体の`manifest_plan_approval`を必須とし、Repository作成・公開・広域Grantは追加Gateにします。Human GateはBearer認証済み人物が専用`approve` APIでPlanの完全一致scopeを承認し、Manifest fingerprintへ束縛した不変Receiptとして保存します。`apply`リクエスト自身から承認を自己申告することはできません。

完了判定では各stepのReceiptだけを信用せず、Registry、組織別の実行時Catalog、Graph validation、全Auth Grant、Repositoryの現状態を改めて読戻します。Catalog adapterが未接続、Registryがunavailable、または一つでも不一致・取得不能なら`active`へ遷移しません。ロールバックで完了済みの外部事実を消さず、`partial_failed`からforward-onlyで再開します。

`GET /api/config`はローカルパスを含むWorkspace Setup用のlegacy topology面として維持します。セッション選択UIはここからローカルパスだけを読み、認証済み`GET /api/config/projects`から組織・Grantで絞られた実行時Project Catalogを取得して選択肢を確定します。Grantはproject ID、明示alias、GitHub repository名の完全一致だけを許可し、prefix一致で別projectへ拡張しません。`GET /api/brainbase/projects`も同じ認証済みCatalog面です。Registry unavailable時はlegacyへ退避しても`source.status: unavailable`を応答へ残し、確認済み成功へ丸めません。UIはCatalogの認証失敗・取得不能時にlegacy選択肢を残さず、選択可能一覧をfail-closedにします。Registryには存在してもWorkspace Setupにローカルpathがないprojectは、推測pathで起動せず「ワークスペース設定が必要」な無効選択肢として表示します。

プロセス終了でrunが`applying`に残った場合、通常の`apply`は再取得しません。明示的な`resume`だけが、最終更新から5分を超えたstale runを原子的に再claimできます。これにより稼働中runとの二重実行を避けつつ、クラッシュ後の復旧経路を保ちます。

CLIの更新系HTTPはBearerだけでCSRFを迂回しません。CLI自身が同一sessionのCSRF tokenを取得し、Bearer、session ID、CSRF tokenを揃えて専用APIへ送ります。

## PR分割境界

この変更は、Manifest契約、状態機械、永続化、Graph・Auth Grant・Repositoryのadapter、API/CLI、実行時Catalog接続、Capability文書、テストを一つの縦断スライスとして扱います。途中で分割すると、Registryへ登録してもアクセス判定へ反映されない、または入口だけ存在して永続化・読戻しが成立しない中間状態になるためです。外部GitHubの本番作成、Production DBへのmigration適用、Workspace Setup、Connected-world OnboardingはこのPRに含めません。
