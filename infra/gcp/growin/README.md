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

Cloud Runサービス、実際のSecret値、Claude Codeから利用するBrainbase MCPの設定は、アプリのコンテナイメージと接続値が揃う次の段階で配備します。

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
