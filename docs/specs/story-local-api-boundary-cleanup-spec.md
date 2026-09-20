# ローカルAPI境界整理のSpec

- `CanonicalTaskApiClient`の接続先は明示`baseUrl`、`BRAINBASE_TASK_API_BASE_URL`、`BRAINBASE_API_URL`の順。未指定・空白・不正URLは通信前に拒否する。
- 接続先はHTTP(S)のoriginまたはpath prefix。URL内の資格情報、query、fragmentを拒否する。リモートHTTPは拒否し、loopback HTTPは明示指定時のみ許可する。
- 本番URL、localhostのいずれにも暗黙fallbackしない。既存のBearer、ページ送り、expected_version、Idempotency-Keyは変更しない。
- runtime文書の`com.brainbase.ui` / `BRAINBASE_UI_RUNTIME_ROOT`は既存インストールの識別子として説明する。renameによる二重起動・接続先変更は行わない。
- 保存データの件数差を未移行件数と解釈しない。31013を停止する前には利用者・ルーティン・MCP依存を個別確認する。

検証: `tests/server/scripts/canonical-task-api-client.test.js`、関連運用script/preflightテスト、文書参照・YAML構文、独立レビュー、CI。HTTP実機確認はGETのみで、401は未利用・成功と判定しない。
