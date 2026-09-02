# Story: 本番artifact差分とGraph検証を同一releaseへ収束する

## 利用者価値

本番に直接入った未正式化の修正を失わずに開発履歴へ戻し、デプロイ済みコード、環境設定、Ontology署名、Graph検証を同じ本番状態として信頼できるようにする。

## 現在の不具合

本番checkoutにはJudgment Resolver関連4ファイルの未コミット修正があり、通常デプロイで失われる。別に、Infisicalから不完全な`ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY`が注入され、Git管理の信頼ストアより優先されるため、署名検証が`signature_invalid`となり`graph_validate`がHTTP 503で停止する。

## 受け入れ条件

- AC-001: 本番4ファイルの差分を、内容とパッチ同一性を維持した正式なGit commitとして保全し、対象テストで意図を確認する。
- AC-002: ホットフィックスをレビュー・CI済みのPRで`develop`へ統合し、Global Codex lifecycle Hook、canonical local UI/API、persistent MCP Host bridge、Lightsail Resolver API/serverの4実行面をその統合SHAへデプロイする。
- AC-003: 4実行面それぞれのcheckoutまたはreconcile receipt、稼働プロセス、version/readinessが同じSHAを示し、Git checkoutを持つ面は`dirty=false`である。
- AC-004: production正本から不完全な`ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY`だけを除去し、秘密鍵と`key_id`は維持する。
- AC-005: 再投影・再起動後、Ontology 1.1.0がGit信頼ストアで署名検証される。
- AC-006: 同一runの本番`graph_validate(project_code=brainbase)`がHTTP 200、`collection_complete=true`、構造違反0件、Ontology違反0件、`valid=true`を返す。
- AC-007: 失敗・503・部分取得・不明を成功として扱わず、保全commitと直前の本番SHAから復旧できる証跡を残す。
- AC-008: 4実行面の反映後に作成した新しいCodexタスクで、同一turnのepisode、Brainbase tool event、complete final、ユーザー向け判断レシートを読み戻し、`proven_active`を確認する。

## 対象外

- Ontologyのfail-closed契約や信頼ストア優先順位をコードで緩めること
- 無関係なGraph Entity、Edge、環境変数の変更
- 本番ホットフィックスと無関係なリファクタリング
