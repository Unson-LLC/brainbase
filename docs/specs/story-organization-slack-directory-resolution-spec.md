# Spec: 組織Slackディレクトリ接続の解決

## 入力

- `organization_id`
- 任意の検索語、または登録対象のSlack user ID

## 振る舞い

1. `organizations.workspace_id`と、その組織の有効な`auth_grants.slack_workspace_id`を重複なく候補化する。
2. `organization_id`から有効な`tenant_id`を解決する。
3. 解決した`tenant_id`をPostgreSQLのRLS文脈へ設定し、同じテナントかつ候補workspaceに一致する有効なSlack接続を検索する。
4. 接続がちょうど1件で、`users:read`と`users:read.email`を含む場合だけSlack APIを呼ぶ。
5. 一覧・既存メンバーのメール補完・新規登録は同じ解決結果を使う。
6. 新規登録では解決したworkspace IDを権限レコードに保存する。

## 不変条件

- 他組織だけに紐づくworkspaceは検索対象にしない。
- `tenant_id`を解決できない場合、または組織との対応が一致しない場合はDB検索前に失敗する。
- 接続の曖昧さを暗黙選択で解消しない。
- Slack API由来のメールアドレスを小文字に正規化する。
