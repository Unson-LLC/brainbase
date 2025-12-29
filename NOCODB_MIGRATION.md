# NocoDB移行ガイド

brainbaseの全12プロジェクトのデータ管理基盤をAirtableからNocoDBに移行するための完全ガイド。

## 目次

1. [移行の概要](#移行の概要)
2. [事前準備](#事前準備)
3. [Phase 1: Lightsail環境構築](#phase-1-lightsail環境構築)
4. [Phase 2: NocoDB + PostgreSQLセットアップ](#phase-2-nocodb--postgresqlセットアップ)
5. [Phase 3: データ移行](#phase-3-データ移行)
6. [Phase 4: mana統合更新](#phase-4-mana統合更新)
7. [Phase 5: テスト](#phase-5-テスト)
8. [Phase 6: 本番カットオーバー](#phase-6-本番カットオーバー)
9. [ロールバック手順](#ロールバック手順)
10. [トラブルシューティング](#トラブルシューティング)

## 移行の概要

### 目的

- **コスト削減**: Airtable $4,320/年 → NocoDB $144/年（**97%削減**）
- **API制限解消**: Airtableの月間1,000リクエスト制限を撤廃
- **自律運用**: 自己ホストによる完全なデータ管理権限

### アーキテクチャ

```
Airtable (12 bases)
    ↓ 移行
NocoDB (AWS Lightsail)
    ├── PostgreSQL 15 (データストレージ)
    ├── Docker Compose (オーケストレーション)
    └── S3 (日次バックアップ)

mana (Slack Bot)
    ├── Hybrid Client (NocoDB優先、Airtableフォールバック)
    └── ゼロダウンタイム移行
```

### 移行対象12ベース

1. SalesTailor (app8uhkD8PcnxPvVx)
2. Zeims (appg1DeWomuFuYnri)
3. BAAO (appCysQGZowfOd58i)
4. NCOM (appQwscGj355IMsfS)
5. Senrigan (appDd7TdJf1t23PCm)
6. DialogAI (appLXuHKJGitc6CGd)
7. eve-topi (appXLSkrAKrykJJQm)
8. HP Sales (appXvthGPhEO1ZEOv)
9. SmartFront (appsticSxr1PQsZam)
10. Aitle (appvZv4ybVDsBXtvC)
11. Mywa (appJeMbMQcz507E9g)
12. BackOffice (appxybW7Hn5qjaIwP)

## 事前準備

### 必要なツール

```bash
# Terraform
brew install terraform

# AWS CLI
brew install awscli
aws configure  # Lightsail用のAWS認証情報設定

# Python 3.13+（brainbase共通仮想環境）
source /Users/ksato/workspace/.venv/bin/activate
pip install -r migration/requirements.txt
```

### 環境変数設定

`/Users/ksato/workspace/.env`に以下を追加：

```bash
# NocoDB設定
NOCODB_URL=http://<LIGHTSAIL_IP>:8080
NOCODB_TOKEN=<generated-token>
USE_NOCODB=false  # 移行完了までfalse
FALLBACK_TO_AIRTABLE=true

# Airtable設定（移行期間中は保持）
AIRTABLE_API_KEY=<existing-key>

# PostgreSQL設定
POSTGRES_PASSWORD=<secure-password-16-chars>

# NocoDB管理者設定
NOCODB_ADMIN_EMAIL=admin@example.com
NOCODB_ADMIN_PASSWORD=<secure-password-16-chars>

# バックアップ設定
AWS_ACCESS_KEY_ID=<your-key>
AWS_SECRET_ACCESS_KEY=<your-secret>
BACKUP_S3_BUCKET=brainbase-backups
```

## Phase 1: Lightsail環境構築

### 1.1 Terraform設定

```bash
cd terraform/lightsail

# 変数ファイル作成
cp terraform.tfvars.example terraform.tfvars

# terraform.tfvarsを編集
# - nocodb_admin_email
# - nocodb_admin_password
# - postgres_password

# Terraform初期化
terraform init

# 実行プラン確認
terraform plan

# デプロイ実行
terraform apply
```

### 1.2 出力値確認

```bash
terraform output

# 重要な出力値:
# - static_ip_address: NocoDB接続用の静的IP
# - ssh_command: SSH接続コマンド
# - nocodb_url: NocoDB WebUI URL
```

### 1.3 SSH接続確認

```bash
# Lightsailコンソールから秘密鍵をダウンロード
# AWS Console → Lightsail → インスタンス → SSHキー

chmod 400 ~/Downloads/lightsail-key.pem
ssh -i ~/Downloads/lightsail-key.pem ubuntu@<STATIC_IP>
```

**想定時間**: 30分

## Phase 2: NocoDB + PostgreSQLセットアップ

### 2.1 Docker Composeデプロイ

```bash
# SSHでLightsailに接続後
cd /opt/nocodb

# .envファイル作成
cp .env.example .env
# .envを編集（POSTGRES_PASSWORD等）

# Docker Composeファイルをアップロード
# ローカルから: scp -i <key> docker-compose.yml ubuntu@<IP>:/opt/nocodb/

# NocoDB起動
docker-compose up -d

# 起動確認
docker-compose ps
docker-compose logs -f nocodb
```

### 2.2 NocoDB初期設定

1. ブラウザで `http://<STATIC_IP>:8080` にアクセス
2. 管理者アカウント作成（terraform.tfvarsで設定したメールアドレス）
3. Settings → API Tokens → トークン生成
4. トークンを `/Users/ksato/workspace/.env` の `NOCODB_TOKEN` に保存

### 2.3 バックアップスクリプト設定

```bash
# SSHでLightsailに接続後
cd /opt/nocodb

# バックアップスクリプトをアップロード
# ローカルから: scp -i <key> scripts/backup-nocodb.sh ubuntu@<IP>:/opt/nocodb/scripts/

# 実行権限付与
chmod +x scripts/backup-nocodb.sh

# テスト実行
./scripts/backup-nocodb.sh
```

**想定時間**: 30分

## Phase 3: データ移行

### 3.1 移行スクリプト実行

```bash
# ローカル環境（brainbase共通仮想環境）
cd migration
source /Users/ksato/workspace/.venv/bin/activate

# 依存パッケージインストール
pip install -r requirements.txt

# 移行スクリプト実行
python airtable-to-nocodb.py
```

### 3.2 移行レポート確認

```bash
# 移行完了後、migration_report.jsonが生成される
cat migration/migration_report.json

# 重要な確認項目:
# - total_records: 移行されたレコード数
# - manual_migration_fields: 手動再作成が必要なフィールド（Formulaフィールド）
# - errors: エラーリスト
```

### 3.3 Formulaフィールド手動再作成

移行レポートの`manual_migration_fields`に記載された26のFormulaフィールドを手動で再作成：

1. NocoDBのWebUIでテーブルを開く
2. フィールド追加 → Formula を選択
3. Airtableの式をNocoDBの式に変換
4. テストデータで動作確認

**想定時間**: 4時間（26フィールド × 10分）

**想定時間（スクリプト実行）**: 1-2時間

## Phase 4: mana統合更新

### 4.1 環境変数設定

```bash
# /Users/ksato/workspace/.envに以下を設定
USE_NOCODB=true  # NocoDB優先に切り替え
FALLBACK_TO_AIRTABLE=true  # エラー時はAirtableフォールバック
NOCODB_URL=http://<STATIC_IP>:8080
NOCODB_TOKEN=<generated-token>
```

### 4.2 Lambda環境変数更新

```bash
# mana-unson
aws lambda update-function-configuration \
  --function-name mana-unson \
  --environment Variables="{USE_NOCODB=true,NOCODB_URL=http://<IP>:8080,NOCODB_TOKEN=<token>,FALLBACK_TO_AIRTABLE=true}"

# mana-salestailor
aws lambda update-function-configuration \
  --function-name mana-salestailor \
  --environment Variables="{USE_NOCODB=true,NOCODB_URL=http://<IP>:8080,NOCODB_TOKEN=<token>,FALLBACK_TO_AIRTABLE=true}"

# mana-techknight
aws lambda update-function-configuration \
  --function-name mana-techknight \
  --environment Variables="{USE_NOCODB=true,NOCODB_URL=http://<IP>:8080,NOCODB_TOKEN=<token>,FALLBACK_TO_AIRTABLE=true}"
```

### 4.3 manaデプロイ

```bash
cd /Users/ksato/workspace/mana/api

# Lambdaパッケージ作成
npm install
zip -r lambda-deployment.zip .

# Lambda関数更新
aws lambda update-function-code \
  --function-name mana-unson \
  --zip-file fileb://lambda-deployment.zip

# 同様にmana-salestailor、mana-techknightも更新
```

**想定時間**: 1時間

## Phase 5: テスト

### 5.1 データ整合性検証

```bash
# 移行スクリプト実行時の検証
python migration/airtable-to-nocodb.py --verify-only

# レコード数比較
# - Airtableのレコード数: migration_report.json の total_records
# - NocoDBのレコード数: NocoDB WebUIで各テーブル確認
```

### 5.2 mana E2Eテスト（Slackから）

Slackで以下のコマンドを実行：

```
# タスク一覧取得
@mana タスク一覧

# タスク作成
@mana タスク作成 「テストタスク」 担当: @k.sato 期限: 2025-01-10

# タスク更新
@mana タスク更新 [task_id] ステータス: 完了

# マイルストーン確認
@mana マイルストーン一覧
```

**期待結果**:
- 全コマンドが正常動作
- NocoDBからデータ取得成功（ログで確認）
- エラー時はAirtableフォールバック（ログで確認）

### 5.3 パフォーマンステスト

```bash
# API応答時間測定
curl -w "\nTime: %{time_total}s\n" \
  -H "xc-token: $NOCODB_TOKEN" \
  "http://<STATIC_IP>:8080/api/v1/db/data/noco/<PROJECT_ID>/Milestones"

# 目標: <500ms (P95)
```

### 5.4 フォールバック機構テスト

```bash
# NocoDBを一時停止
ssh ubuntu@<IP> "cd /opt/nocodb && docker-compose stop nocodb"

# Slackでmanaコマンド実行
# → Airtableフォールバックが動作することを確認

# NocoDBを再起動
ssh ubuntu@<IP> "cd /opt/nocodb && docker-compose start nocodb"
```

**想定時間**: 2時間

## Phase 6: 本番カットオーバー

### 段階的移行スケジュール

| 期間 | 設定 | 説明 |
|-----|------|------|
| Day 1-2 | `USE_NOCODB=true`, `FALLBACK_TO_AIRTABLE=true` | NocoDB優先、Airtable待機 |
| Day 3-5 | `USE_NOCODB=true`, `FALLBACK_TO_AIRTABLE=false` | NoCoDB単独運用、監視強化 |
| Day 6-7 | Airtable完全停止確認 | Airtableサブスクリプション解約検討 |

### 6.1 CloudWatch監視設定

```bash
# Lambda関数のエラー監視
aws cloudwatch put-metric-alarm \
  --alarm-name mana-nocodb-errors \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1
```

### 6.2 コストモニタリング

```bash
# Lightsail月額料金確認
aws lightsail get-instances --query 'instances[?name==`brainbase-nocodb`].bundleId'

# 期待値: medium_3_0 ($12/月)
```

**想定時間**: 7日間（段階的移行）

## ロールバック手順

### 緊急ロールバック（5分で完了）

```bash
# 1. 環境変数を即座に切り戻し
export USE_NOCODB=false

# 2. Lambda環境変数更新
aws lambda update-function-configuration \
  --function-name mana-unson \
  --environment Variables="{USE_NOCODB=false}"

# 同様に全Lambda関数を更新

# 3. mana再起動（自動的にAirtableに戻る）
```

### データ復元（PostgreSQLから）

```bash
# S3からバックアップダウンロード
aws s3 cp s3://brainbase-backups/nocodb/nocodb_backup_YYYYMMDD_HHMMSS.sql.gz .

# PostgreSQL復元
gunzip nocodb_backup_YYYYMMDD_HHMMSS.sql.gz
ssh ubuntu@<IP> "cd /opt/nocodb && docker exec -i nocodb-postgres psql -U nocodb -d nocodb" < nocodb_backup_YYYYMMDD_HHMMSS.sql
```

## トラブルシューティング

### NocoDB接続エラー

```bash
# Docker状態確認
docker-compose ps

# ログ確認
docker-compose logs nocodb

# PostgreSQL接続確認
docker exec nocodb-postgres pg_isready -U nocodb
```

### データ不整合

```bash
# レコード数比較スクリプト実行
python migration/verify-migration.py

# 差分があるテーブルを再移行
python migration/airtable-to-nocodb.py --table <TABLE_NAME>
```

### manaコマンドエラー

```bash
# CloudWatchログ確認
aws logs tail /aws/lambda/mana-unson --follow

# Hybrid Clientメトリクス確認
# Lambda実行後、ログに出力される metrics オブジェクトを確認
# - nocodbRequests: NocoDBリクエスト数
# - fallbackActivations: フォールバック発動回数
```

## 完了チェックリスト

- [ ] Phase 1: Lightsail環境構築完了
- [ ] Phase 2: NocoDB + PostgreSQL起動確認
- [ ] Phase 3: 全12ベースのデータ移行完了
- [ ] Phase 3: 26 Formulaフィールド手動再作成完了
- [ ] Phase 4: mana環境変数設定完了
- [ ] Phase 4: Lambda関数デプロイ完了
- [ ] Phase 5: データ整合性検証完了（レコード数一致）
- [ ] Phase 5: mana E2Eテスト合格
- [ ] Phase 5: パフォーマンステスト合格（<500ms）
- [ ] Phase 6: 7日間安定運用確認
- [ ] バックアップ自動化設定完了
- [ ] CloudWatch監視設定完了
- [ ] Airtableサブスクリプション解約

## サポート

問題が発生した場合：

1. **ログ確認**: CloudWatch Logs → `/aws/lambda/mana-*`
2. **Slack通知**: バックアップ失敗時は自動通知
3. **緊急ロールバック**: 上記の手順で即座にAirtableに戻す

---

最終更新: 2025-12-29
