# Architecture: Project Provisioning v1

`ProjectProvisioningService` が状態遷移とstep順序を所有します。HTTP APIとCLIとSkillは薄い入口であり、直接SQLや独自Graph writerを呼び出しません。

永続層は `project_registry`、`project_provisioning_runs`、`project_provisioning_steps` です。Graph stepは既存の `GraphMaintenanceService` を、権限stepは `AuthGrantService` を使用します。外部GitHub操作はRepository Bootstrap adapterが存在するときだけ実行し、存在しなければfail-closedにします。本番Graph/GitHub writerの実行はこのPRの対象外であり、契約テストではfake/adapter doubleを使います。

3表は `app.organization_id` による `ENABLE/FORCE ROW LEVEL SECURITY` で分離します。Repositoryは各トランザクションで組織コンテキストを設定し、組織指定のない実行時Catalog読込はRegistryへ到達させません。移行未適用時はRegistryを`unavailable`として扱い、既存のローカルCatalogを組織membershipや権限根拠にせず、正式なCLI/API/MCPの応答へ未確認状態を残します。`/api/health`と`/api/config/integrity`も同じadapterでRegistry schemaの実在を確認し、legacy設定だけが読める状態をhealthyにしません。Registry由来の行を既存Catalogへ重ねる場合も、既存aliasを保持し、Repository情報をCatalog metadataへ投影します。

適用順は Registry → Graph → Auth Grants → Repository boundary です。すべてのPlanはManifestと差分全体の`manifest_plan_approval`を必須とし、Repository作成・公開・広域Grantは追加Gateにします。Human GateはBearer認証済み人物が専用`approve` APIでPlanの完全一致scopeを承認し、Manifest fingerprintへ束縛した不変Receiptとして保存します。`apply`リクエスト自身から承認を自己申告することはできません。

完了判定では各stepのReceiptだけを信用せず、Registry、組織別の実行時Catalog、Graph validation、全Auth Grant、Repositoryの現状態を改めて読戻します。Catalog adapterが未接続、Registryがunavailable、または一つでも不一致・取得不能なら`active`へ遷移しません。ロールバックで完了済みの外部事実を消さず、`partial_failed`からforward-onlyで再開します。

正式なProject Catalogの入口は認証済みCLI/API/MCPです。CLIはProject Provisioningのcheck/plan/approve/apply/status/verify/resumeを呼び、APIは`/api/config/projects`、`/api/brainbase`、`/api/brainbase/projects`を提供し、MCPは`brainbase_projects`を提供します。各面はproject grantを認証コンテキストと設定スコープの積集合で絞り、`source.status`やstatus envelopeでloaded・confirmed empty・unavailable/errorを区別します。未認証・取得不能・Registry unavailableはlegacy topologyへfail-openせず、readback未確認として扱います。

`GET /api/config`は個人のWorkspace Setup用legacy topologyであり、組織Catalogやアクセス権の根拠ではありません。Workspace SetupとConnected-world Onboardingは別Capabilityです。サーバー側の`session.create`/static endpointとSession Launch Pickerはretiredかつ到達不能で、Project Provisioningの正式入口でもProject Catalog consumerでもありません。移行期間中は旧NocoDB `EVENTS.START_TASK`から互換導線としてFocusEngineModalへ到達し得ますが、エンジン選択後（Modal不在時は直ちに）Codex移行案内へfail-closedし、session APIを呼びません。ブラウザの正式Project Catalog consumerはWorkspace Setupだけです。desktop/mobileの旧`EVENTS.CREATE_SESSION`導線もCodex移行案内を表示し、Pickerを開かずsession APIを呼びません。タスクとworktreeの作成・所有はCodex app/CLIが担います。

プロセス終了でrunが`applying`に残った場合、通常の`apply`は再取得しません。明示的な`resume`だけが、最終更新から5分を超えたstale runを原子的に再claimできます。これにより稼働中runとの二重実行を避けつつ、クラッシュ後の復旧経路を保ちます。

CLIの更新系HTTPはBearerだけでCSRFを迂回しません。CLI自身が同一sessionのCSRF tokenを取得し、Bearer、session ID、CSRF tokenを揃えて専用APIへ送ります。

## PR分割境界

この変更は、Manifest契約、状態機械、永続化、Graph・Auth Grant・Repositoryのadapter、API/CLI、実行時Catalog接続、Capability文書、テストを一つの縦断スライスとして扱います。途中で分割すると、Registryへ登録してもアクセス判定へ反映されない、または入口だけ存在して永続化・読戻しが成立しない中間状態になるためです。外部GitHubの本番作成、Production DBへのmigration適用、Workspace Setup、Connected-world OnboardingはこのPRに含めません。

## 証拠境界

Graph writerおよびGitHub writerの現行テストはfake/adapter doubleによる契約確認です。本番Graph/GitHub writesとproduction E2EはこのPRの対象外であり、実行済みの証拠として扱いません。`active`判定で要求するreadbackは、利用可能なRegistry・Graph validation・Auth Grant・Repository boundary・runtime catalogの各結果を個別に確認します。
