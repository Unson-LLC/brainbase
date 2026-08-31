# Growin専用Brainbase Google Cloud基盤

Growin専用Brainbaseの本番基盤をTerraformで管理します。雲孫が利用しているBrainbase環境とは、Google Cloudプロジェクト・ネットワーク・データベース・保存領域・権限を分離します。

## この段階で作るもの

- 専用VPCとプライベートサブネット
- プライベートIPのみのCloud SQL for PostgreSQL 16
- コンテナ保存用Artifact Registry
- 原本ファイル用と監査証跡用のCloud Storage
- 非同期取り込み用Pub/Subとデッドレター用トピック
- 実行・取り込み・配備を分離したサービスアカウント
- Secret Managerの格納先（値そのものはTerraformへ保存しない）

Cloud RunのAPI・MCP・DBマイグレーションJobまで配備済みです。Claude Codeでは、利用者共通のMCP設定へ追加せず、Growin専用設定だけを読む隔離ランチャーを使います。

```bash
scripts/growin/run-claude-isolated.sh
```

このランチャーは初回にGrowin専用APIのDevice Code Flowを開始し、GrowinのGoogle Workspaceで本人確認します。取得した個人JWTは`~/.brainbase/growin/tokens.json`へ`0600`で保存し、MCPからGraph APIまで同じ本人情報を伝播します。共通Bearerは移行期間だけ`hybrid`モードで受け付け、個人認証の確認後に`brainbase-jwt`へ切り替えて廃止します。

認証プロバイダーはBrainbase人物・権限から分離されています。Growin環境ではGoogle Workspaceを選択し、確認済みの`growin.jp`メールアドレスをBrainbase人物へ対応付けます。将来Microsoft Entra IDやパスキーへ切り替えても、人物ID・案件権限・監査モデルは変えません。`--strict-mcp-config`により、雲孫を含む利用者設定・プロジェクト設定のMCPを読みません。終了時に一時設定を削除します。

個人認証を有効化する前に、Google CloudでOAuthクライアントを作り、クライアントID・シークレットをSecret Managerへ登録します。利用者は、確認済みのGoogle Workspaceメールアドレスを`auth_identities`でBrainbase人物へ対応付け、`auth_grants`で権限を付与します。メールアドレスが未確認の人物は推測して登録しません。

初期Graphの投入とリモートE2Eは次の順で実行します。秘密値は標準出力へ表示しません。

```bash
export BRAINBASE_SERVICE_TOKEN_SECRET="$(gcloud secrets versions access latest \
  --secret=brainbase-service-token-secret --project=brainbase-505912 \
  --account=k.sato.unson@gmail.com)"
node scripts/growin/seed-initial-graph.mjs
unset BRAINBASE_SERVICE_TOKEN_SECRET
scripts/growin/verify-remote-e2e.sh
```

## 初期化

Terraform state用バケットは事前に一度だけ作成します。

```bash
gcloud storage buckets create gs://brainbase-505912-terraform-state \
  --project=brainbase-505912 \
  --location=asia-northeast1 \
  --uniform-bucket-level-access \
  --public-access-prevention

gcloud storage buckets update gs://brainbase-505912-terraform-state --versioning

terraform init \
  -backend-config=bucket=brainbase-505912-terraform-state \
  -backend-config=prefix=growin/foundation
```

## 差分確認と適用

```bash
terraform plan -out=growin.tfplan
terraform apply growin.tfplan
```

## セキュリティ上の前提

- Cloud SQLに公開IPを持たせません。
- バケットへの公開アクセスを禁止します。
- アプリ・取り込み・配備の権限を分け、必要な権限だけを付与します。
- パスワードやAPIキーはTerraform stateやGitへ保存しません。
- Cloud SQLは高可用性構成、日次バックアップ、7日間の任意時点復旧を有効にします。
