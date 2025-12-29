# NocoDB Lightsail インフラストラクチャ

brainbaseの全12プロジェクトで使用するNocoDB環境をAWS Lightsailで構築するTerraform設定。

## 前提条件

- Terraform >= 1.0
- AWS CLI設定済み（`aws configure`で認証情報設定）
- AWS Lightsail利用権限

## クイックスタート

### 1. 変数ファイル作成

```bash
cd terraform/lightsail
cp terraform.tfvars.example terraform.tfvars
```

`terraform.tfvars`を編集し、以下を設定：
- `nocodb_admin_email`: NoCoDB管理者メールアドレス
- `nocodb_admin_password`: NoCoDB管理者パスワード（16文字以上推奨）
- `postgres_password`: PostgreSQLパスワード（16文字以上推奨）

### 2. Terraform初期化

```bash
terraform init
```

### 3. 実行プラン確認

```bash
terraform plan
```

作成されるリソース：
- Lightsailインスタンス（Ubuntu 22.04, medium_3_0バンドル）
- 静的IPアドレス
- ファイアウォールルール（22, 80, 443, 8080ポート）

### 4. デプロイ実行

```bash
terraform apply
```

確認プロンプトで`yes`を入力。

### 5. 出力値確認

```bash
terraform output
```

重要な出力値：
- `static_ip_address`: NocoDB接続用の静的IP
- `ssh_command`: SSH接続コマンド
- `nocodb_url`: NocoDB WebUI URL

## デプロイ後の手順

### 1. SSH接続

```bash
# Terraformの出力値から取得したコマンドを使用
ssh ubuntu@<STATIC_IP>
```

初回接続時、Lightsailコンソールから秘密鍵をダウンロードする必要があります：
1. AWS Lightsailコンソールを開く
2. インスタンス詳細ページ → "SSHキー" タブ
3. デフォルトキーをダウンロード
4. `chmod 400 <downloaded-key>.pem`
5. `ssh -i <downloaded-key>.pem ubuntu@<STATIC_IP>`

### 2. Docker Composeデプロイ

```bash
cd /opt/nocodb
# docker-compose.ymlをアップロード（SCP or Git clone）
docker-compose up -d
```

### 3. NoCoDB初期設定

ブラウザで`http://<STATIC_IP>:8080`にアクセス：
1. 管理者アカウント作成（terraform.tfvarsで設定したメールアドレス）
2. トークン生成（Settings → API Tokens）
3. トークンを`/Users/ksato/workspace/.env`に保存

### 4. 環境変数設定

`/Users/ksato/workspace/.env`に追加：
```bash
NOCODB_URL=http://<STATIC_IP>:8080
NOCODB_TOKEN=<generated-token>
USE_NOCODB=false  # 移行完了までfalse
FALLBACK_TO_AIRTABLE=true
```

## リソース仕様

### Lightsail `medium_3_0` バンドル

| 項目 | 仕様 |
|-----|------|
| RAM | 2GB |
| vCPU | 2コア（専用） |
| SSD | 60GB |
| データ転送 | 3TB/月 |
| 月額料金 | $12 |

### 開放ポート

| ポート | 用途 | 許可CIDR |
|-------|------|---------|
| 22 | SSH | `allowed_ssh_cidrs`（デフォルト: 0.0.0.0/0） |
| 80 | HTTP | 0.0.0.0/0 |
| 443 | HTTPS | 0.0.0.0/0 |
| 8080 | NocoDB API | `allowed_nocodb_cidrs`（デフォルト: 0.0.0.0/0） |

**セキュリティ推奨**: 本番運用時は`allowed_ssh_cidrs`を特定IPに制限すること。

## コスト管理

### 月次コスト

- Lightsail `medium_3_0`: $12/月
- データ転送: 3TB/月まで無料（超過分: $0.09/GB）
- スナップショット: $0.05/GB-月（任意）

### 年間コスト比較

| サービス | 年額 | 削減率 |
|---------|------|-------|
| Airtable (12 bases) | $4,320 | - |
| NocoDB (Lightsail) | $144 | **97%削減** |

## バックアップ戦略

### 日次PostgreSQLバックアップ（自動）

GitHub Actions `.github/workflows/nocodb-backup.yml`で実行：
- スケジュール: 毎日AM 3:00 JST
- 保存先: S3 `s3://brainbase-backups/nocodb/`
- 保持期間: 30日

### 週次スナップショット（手動設定）

Lightsailコンソールから設定：
1. インスタンス詳細ページ → "スナップショット" タブ
2. "自動スナップショットを有効にする"
3. 時刻: 毎週日曜 AM 2:00 JST
4. 保持期間: 4世代

## トラブルシューティング

### SSH接続できない

```bash
# セキュリティグループ確認
terraform show | grep -A 10 aws_lightsail_instance_public_ports

# インスタンス状態確認
aws lightsail get-instance --instance-name brainbase-nocodb
```

### Docker起動失敗

```bash
# SSH接続後
sudo systemctl status docker
sudo journalctl -u docker -f
```

### NoCoDB接続エラー

```bash
# Docker Compose状態確認
cd /opt/nocodb
docker-compose ps
docker-compose logs nocodb
```

## リソース削除

```bash
terraform destroy
```

**注意**: 削除前に必ずPostgreSQLバックアップを取得すること。

## 参考資料

- [Lightsail料金表](https://aws.amazon.com/lightsail/pricing/)
- [NocoDB公式ドキュメント](https://docs.nocodb.com/)
- [Terraform AWS Provider](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
