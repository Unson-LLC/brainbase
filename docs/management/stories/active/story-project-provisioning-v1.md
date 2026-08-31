# Story: Project Provisioning v1

新しいプロジェクトの責任者として、Manifestを一度確認した後は、Project Registry・Graph・権限の登録を再開可能な一連の処理として実行したい。途中失敗や二重実行が起きても、何が完了し何が未完了かをReceiptから判断できるようにするため。

## 受け入れ条件

- checkは書き込みを行わず、project codeの衝突を返す。
- planはManifest fingerprint、step、Human Gate、rollback boundaryを永続化する。
- applyはplannedからapplyingを経てactiveまたはpartial_failedへ遷移する。
- resumeはcompleted stepを保持し、未完了stepから再開する。
- Graphは既存Graph Maintenanceのsnapshot、plan、apply、receipt、validateを通す。
- Auth Grantは専用サービスを通し、既存の有効なGrantへ明示されたproject codeだけを追加する。
- local_pathはManifestで拒否し、Workspace Setupと分離する。
- Repository Bootstrapは専用adapterに分離し、create・public化はHuman Gateとreadbackを必須にする。
- Human GateはBearer認証済み人物の専用approve操作でManifest fingerprintへ束縛し、apply本文からの自己申告を受け付けない。
- link_existingを含む全PlanでManifestとPlan全体のHuman Gate承認前に書き込みを開始しない。
- active遷移前にRegistry・Graph・全Auth Grant・Repositoryを実読戻しし、未確認や不一致を成功扱いにしない。
- Project Registryを実行時Project Catalogへ接続し、登録後のアクセス判定へ反映する。
- Project Grantはproject ID・明示alias・GitHub repository名の完全一致だけで判定し、prefix一致で権限を拡張しない。
- 実行時Catalogの認証失敗・取得不能時はセッション選択肢を空にし、legacy一覧へfail-openしない。
- Registry登録済みでもローカルpath未設定のprojectは「ワークスペース設定が必要」と表示し、推測pathで起動しない。
- healthとintegrityはRegistry schemaの利用可能性を実行時Catalog経由で確認する。
- Workspace SetupとConnected-world Onboardingは別Capabilityとして境界を保つ。
