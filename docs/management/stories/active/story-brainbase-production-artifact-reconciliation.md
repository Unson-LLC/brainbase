# Story: 本番artifact差分とGraph検証を同一releaseへ収束する

## 利用者価値

本番に直接入った未正式化の修正を失わずに開発履歴へ戻し、デプロイ済みコード、環境設定、Ontology署名、Graph検証を同じ本番状態として信頼できるようにする。

## 現在の不具合

本番checkoutにはJudgment Resolver関連4ファイルの未コミット修正があり、通常デプロイで失われる。別に、Infisicalから不完全な`ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY`が注入され、Git管理の信頼ストアより優先されるため、署名検証が`signature_invalid`となり`graph_validate`がHTTP 503で停止する。

## 受け入れ条件

このStoryは、前進デプロイ元を確定する「PR・マージ準備」と、マージ済みSHAを実環境へ反映する「本番完了」の2段階で判定する。PR作成前に本番を未マージSHAへ変更してはならない。

PR・マージ準備では、本番差分と正式commitのパッチ同一性、回帰テスト、4面の退避・切替・readback・rollback手順がレビュー可能で、CIを開始できること。PR成果物には`production_execution_status=not_run`を表示し、ここでは本番反映済みとは判定しない。

本番完了では、PRを`develop`へマージした後、AC-001〜AC-008の本番退避、4面反映、設定修復、Graph検証、rollback証跡、fresh task実証を同じ実行記録へ残すこと。

- AC-001: 本番4ファイルの差分を、内容とパッチ同一性を維持した正式なGit commitとして保全し、対象テストで意図を確認する。反映前に本番側でも対象4ファイルだけのstatus、patch、content hash、旧SHAを退避し、その差分を専用rollback branchのclean commitとして保存する。対象外の差分が1件でもあれば停止する。
- AC-002: ホットフィックスをレビュー・CI済みのPRで`develop`へ統合し、global Hook checkout、ローカル`:31013`、常駐MCP、本番Lightsailの4面をその統合SHAへ揃える。
- AC-003: 4面それぞれのcheckout・稼働プロセス・version/readinessが同じSHAを示し、対象checkoutは`dirty=false`である。
- AC-004: production正本から不完全な`ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY`だけを除去し、秘密鍵と`key_id`は維持する。この除去はforward-only incident remediationであり、コードやランタイムをrollbackしても不正overrideを復活させない。rollback後も正本を再取得し、秘密鍵・`key_id`の同一性、公開鍵overrideの不在、Lightsail環境ファイルの再投影を読戻す。
- AC-005: 再投影・再起動後、Ontology 1.1.0がGit信頼ストアで署名検証される。
- AC-006: 通常の認可scope付き検証は従来互換を保ち、同一runの本番`graph_validate(project_code=brainbase, strict_collection=true)`がHTTP 200、`collection_complete=true`、構造違反0件、Ontology違反0件、抑止されたEdge 0件、`valid=true`を返す。
- AC-007: PR成果物は`production_execution_status=not_run`を明示する。失敗・503・部分取得・不明を成功として扱わず、途中失敗は秘密値を含まない失敗Receiptへ失敗工程・変更有無・rollback要否を残し、専用rollback commitから旧SHA＋ホットフィックスの実効内容を`dirty=false`で復旧できる証跡を残す。rollback時も公開鍵override除去はforward-onlyとして維持し、秘密鍵・`key_id`と再投影済みLightsail設定の読戻しを必須にする。
- AC-008: 4面の切替前状態とglobal Hookファイルを個別に保全し、反映後のfresh taskでJudgment episodeとowner auditを実証する。失敗時は正本runbookの順序で4面を復旧する。

## 対象外

- Ontologyのfail-closed契約や信頼ストア優先順位をコードで緩めること
- 無関係なGraph Entity、Edge、環境変数の変更
- 本番ホットフィックスと無関係なリファクタリング
