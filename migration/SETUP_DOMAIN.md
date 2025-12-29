# noco.unson.jp ドメイン設定手順

## 実施済み

✅ DNS設定: noco.unson.jp → 176.34.20.239 (Route 53)

## 次の手順

### 1. Lightsailインスタンスにアクセス

AWS Lightsailコンソールからブラウザベースsshを開く：
```
https://lightsail.aws.amazon.com/ls/webapp/ap-northeast-1/instances/brainbase-nocodb/connect
```

または、SSH鍵を使ってローカルから接続：
```bash
ssh -i ~/.ssh/lightsail-key.pem ubuntu@176.34.20.239
```

### 2. 作業ディレクトリ作成

```bash
mkdir -p ~/nocodb
cd ~/nocodb
```

### 3. docker-compose.yml作成

以下の内容でファイルを作成：

```bash
cat > docker-compose.yml << 'EOF'
# (docker-compose.ymlの内容をここにコピペ)
EOF
```

※ 内容は `migration/docker-compose.yml` を参照

### 4. セットアップスクリプト作成

```bash
cat > setup-nocodb-ssl.sh << 'EOF'
# (setup-nocodb-ssl.shの内容をここにコピペ)
EOF

chmod +x setup-nocodb-ssl.sh
```

※ 内容は `migration/setup-nocodb-ssl.sh` を参照

### 5. セットアップ実行

```bash
./setup-nocodb-ssl.sh
```

### 6. 動作確認

約5-10分後、SSL証明書が自動取得されます。

```bash
# ログ確認
docker-compose logs -f letsencrypt

# NoCoDB動作確認
curl -I https://noco.unson.jp
```

ブラウザで https://noco.unson.jp にアクセス

## トラブルシューティング

### SSL証明書が取得できない場合

```bash
# Let's Encryptログ確認
docker-compose logs letsencrypt

# コンテナ再起動
docker-compose restart letsencrypt
```

### ポート80/443が開いていない場合

Lightsailファイアウォール設定を確認：
- ポート80 (HTTP)
- ポート443 (HTTPS)

```bash
# AWS CLIで確認
aws lightsail get-instance-port-states \
  --profile unson \
  --region ap-northeast-1 \
  --instance-name brainbase-nocodb
```

必要に応じてポート開放：
```bash
aws lightsail open-instance-public-ports \
  --profile unson \
  --region ap-northeast-1 \
  --instance-name brainbase-nocodb \
  --port-info fromPort=443,toPort=443,protocol=tcp
```

## 完了後

- ✅ https://noco.unson.jp でアクセス可能
- ✅ SSL証明書自動更新（90日毎）
- ✅ HTTP → HTTPS自動リダイレクト
