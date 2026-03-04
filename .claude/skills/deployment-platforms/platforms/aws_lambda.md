# AWS Lambda デプロイ標準手法

サーバーレス関数（Node.js/Python）のAWS Lambdaへのデプロイ手順。

---

## 前提条件

- [ ] AWS CLI インストール済み（`aws --version`）
- [ ] AWS認証設定済み（`~/.aws/credentials` または IAM Role）
- [ ] Lambda関数が作成済み（または初回デプロイ）
- [ ] デプロイパッケージ作成済み（zip形式）

---

## デプロイ手順

### Step 1: ビルド

```bash
# Node.js例
cd functions/{function-name}
npm install --production
npm run build

# Python例
cd functions/{function-name}
pip install -r requirements.txt -t .
```

### Step 2: パッケージング

```bash
# Node.js
zip -r bundle.zip . -x "*.git*" -x "node_modules/.cache/*"

# Python
zip -r bundle.zip . -x "*.git*" -x "__pycache__/*"
```

### Step 3: Lambda関数更新

```bash
aws lambda update-function-code \
  --function-name {function-name} \
  --zip-file fileb://bundle.zip \
  --region ap-northeast-1
```

### Step 4: 環境変数更新（必要時）

```bash
aws lambda update-function-configuration \
  --function-name {function-name} \
  --environment Variables="{KEY1=value1,KEY2=value2}" \
  --region ap-northeast-1
```

### Step 5: デプロイ検証

```bash
# Lambda関数バージョン確認
aws lambda get-function --function-name {function-name} --region ap-northeast-1

# テスト実行
aws lambda invoke \
  --function-name {function-name} \
  --payload '{"test": true}' \
  --region ap-northeast-1 \
  response.json

# レスポンス確認
cat response.json
```

---

## 複数ワークスペースデプロイ（mana例）

manaのような複数ワークスペース構成の場合：

```bash
#!/bin/bash
# deploy.sh

WORKSPACES=("baao" "unson" "tech-knight")

for workspace in "${WORKSPACES[@]}"; do
  echo "Deploying ${workspace}..."

  aws lambda update-function-code \
    --function-name mana-${workspace} \
    --zip-file fileb://dist/bundle.zip \
    --region ap-northeast-1

  echo "✅ ${workspace} deployed"
done

echo "🎉 All workspaces deployed"
```

参照: `@mana-deployment` Skill

---

## 環境変数管理

### Secrets Manager使用（推奨）

```bash
# Secret取得
aws secretsmanager get-secret-value \
  --secret-id {secret-name} \
  --region ap-northeast-1 \
  --query SecretString \
  --output text

# Lambda環境変数に設定
aws lambda update-function-configuration \
  --function-name {function-name} \
  --environment Variables="{SECRET_KEY=$(aws secretsmanager get-secret-value --secret-id {secret-name} --query SecretString --output text)}"
```

### 環境変数直接設定（非推奨）

```bash
# .env.productionから読み込み
source .env.production

aws lambda update-function-configuration \
  --function-name {function-name} \
  --environment Variables="{KEY1=${KEY1},KEY2=${KEY2}}"
```

---

## デプロイチェックリスト

- [ ] ビルド成功（`npm run build` / `pip install`）
- [ ] パッケージサイズ確認（<50MB unzipped, <250MB zipped）
- [ ] 環境変数設定済み（Secrets Manager推奨）
- [ ] IAM Role権限確認（Lambda実行ロール）
- [ ] VPC設定確認（必要な場合）
- [ ] タイムアウト設定確認（デフォルト3秒→必要に応じて延長）
- [ ] メモリ設定確認（128MB〜10GB）
- [ ] CloudWatch Logs有効化確認

---

## トラブルシューティング

### エラー: "ResourceConflictException"

**原因**: 別のデプロイが進行中

**対処**:
```bash
# 進行中のデプロイ確認
aws lambda get-function --function-name {function-name}

# 数分待ってから再実行
```

### エラー: "RequestEntityTooLargeException"

**原因**: パッケージサイズ超過（>250MB）

**対処**:
```bash
# 不要ファイル除外
zip -r bundle.zip . -x "*.git*" -x "node_modules/.cache/*" -x "tests/*"

# または Lambda Layers使用
aws lambda publish-layer-version \
  --layer-name {layer-name} \
  --zip-file fileb://layer.zip
```

### エラー: Lambda関数実行エラー

**対処**:
```bash
# CloudWatch Logsで確認
aws logs tail /aws/lambda/{function-name} --follow

# 直前のエラーログ取得
aws logs filter-log-events \
  --log-group-name /aws/lambda/{function-name} \
  --filter-pattern "ERROR"
```

---

## Event(type=ship)記録例

```yaml
event:
  type: ship
  timestamp: 2026-02-08T12:00:00Z
  platform: aws-lambda
  function_name: mana-baao
  version: v1.2.3
  region: ap-northeast-1
  deployment_time: 45s
  package_size: 12.5MB
  result: success
  metrics:
    - cold_start_duration: 1.2s
    - warm_start_duration: 120ms
    - memory_used: 128MB
```

---

## 参考リンク

- [AWS Lambda Developer Guide](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html)
- [AWS CLI Lambda Command Reference](https://docs.aws.amazon.com/cli/latest/reference/lambda/)
- brainbase Skills: `@mana-deployment`

---

**Last Updated**: 2026-02-08
