#!/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Graph API Server - Deploy Script
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#
# 目的: brainbase Graph APIをLightsailにデプロイ
#       ビルド→転送→再起動→ヘルスチェックを自動化
#
# 使い方:
#   ./scripts/deploy-graph-api.sh
#
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -e  # エラー時に即座に終了

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 設定
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LIGHTSAIL_HOST="176.34.20.239"
LIGHTSAIL_USER="ubuntu"
LIGHTSAIL_KEY="$HOME/.ssh/lightsail-brainbase.pem"
REMOTE_DIR="/opt/graph-api"
API_URL="https://graph.brainbase.work"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Graph API デプロイ開始"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 1: 環境変数ファイル確認
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo "📋 Step 1: 環境変数ファイル確認"
if [ ! -f .env.graph-api ]; then
    echo "❌ .env.graph-api が見つかりません"
    echo "   .env.graph-api.example をコピーして作成してください:"
    echo "   cp .env.graph-api.example .env.graph-api"
    exit 1
fi
echo "✅ .env.graph-api 確認完了"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 2: Dockerイメージビルド
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo "🔨 Step 2: Dockerイメージビルド"
docker build -f Dockerfile.graph-api -t brainbase-graph-api:latest .
echo "✅ ビルド完了"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 3: Dockerイメージ保存
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo "💾 Step 3: Dockerイメージ保存"
docker save brainbase-graph-api:latest | gzip > /tmp/graph-api-image.tar.gz
echo "✅ イメージ保存完了 (/tmp/graph-api-image.tar.gz)"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 4: Lightsailに転送
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo "📤 Step 4: Lightsailにファイル転送"

# SSHキー確認
if [ ! -f "$LIGHTSAIL_KEY" ]; then
    echo "❌ SSHキーが見つかりません: $LIGHTSAIL_KEY"
    exit 1
fi

# リモートディレクトリ作成
ssh -i "$LIGHTSAIL_KEY" "$LIGHTSAIL_USER@$LIGHTSAIL_HOST" "mkdir -p $REMOTE_DIR"

# ファイル転送
scp -i "$LIGHTSAIL_KEY" /tmp/graph-api-image.tar.gz "$LIGHTSAIL_USER@$LIGHTSAIL_HOST:$REMOTE_DIR/"
scp -i "$LIGHTSAIL_KEY" docker-compose.graph-api.yml "$LIGHTSAIL_USER@$LIGHTSAIL_HOST:$REMOTE_DIR/docker-compose.yml"
scp -i "$LIGHTSAIL_KEY" .env.graph-api "$LIGHTSAIL_USER@$LIGHTSAIL_HOST:$REMOTE_DIR/.env.graph-api"
scp -i "$LIGHTSAIL_KEY" -r nginx "$LIGHTSAIL_USER@$LIGHTSAIL_HOST:$REMOTE_DIR/"

echo "✅ ファイル転送完了"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 5: Lightsail上でDockerイメージロード＆起動
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo "🔄 Step 5: Lightsail上でコンテナ再起動"

ssh -i "$LIGHTSAIL_KEY" "$LIGHTSAIL_USER@$LIGHTSAIL_HOST" << 'EOF'
cd /opt/graph-api

# 既存コンテナ停止・削除
docker-compose down || true

# Dockerイメージロード
gunzip -c graph-api-image.tar.gz | docker load

# コンテナ起動
docker-compose up -d

# 不要なファイル削除
rm -f graph-api-image.tar.gz

echo "✅ コンテナ起動完了"
EOF

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 6: ヘルスチェック
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo "🩺 Step 6: ヘルスチェック"

# 40秒待機（コンテナ起動待ち）
echo "⏳ 起動待ち（40秒）..."
sleep 40

# ヘルスチェック（最大5回リトライ）
MAX_RETRIES=5
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    echo "🔍 ヘルスチェック試行 $(($RETRY_COUNT + 1))/$MAX_RETRIES"

    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API_URL}/health/ready" || echo "000")

    if [ "$HTTP_CODE" = "200" ]; then
        echo "✅ ヘルスチェック成功！"
        break
    else
        echo "⚠️  ヘルスチェック失敗（HTTPステータス: $HTTP_CODE）"
        if [ $RETRY_COUNT -lt $(($MAX_RETRIES - 1)) ]; then
            echo "   10秒後に再試行..."
            sleep 10
        fi
    fi

    RETRY_COUNT=$(($RETRY_COUNT + 1))
done

if [ "$HTTP_CODE" != "200" ]; then
    echo "❌ ヘルスチェック失敗"
    echo "   Lightsailサーバーのログを確認してください:"
    echo "   ssh -i $LIGHTSAIL_KEY $LIGHTSAIL_USER@$LIGHTSAIL_HOST"
    echo "   cd $REMOTE_DIR && docker-compose logs"
    exit 1
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 完了
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 デプロイ完了！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🌐 Graph API URL: ${API_URL}"
echo "🔍 ヘルスチェック: ${API_URL}/health/ready"
echo "🔐 Device認証: ${API_URL}/device"
echo ""
echo "📋 次のステップ:"
echo "  1. Let's Encrypt証明書取得（初回のみ）:"
echo "     ssh -i $LIGHTSAIL_KEY $LIGHTSAIL_USER@$LIGHTSAIL_HOST"
echo "     cd $REMOTE_DIR"
echo "     docker-compose run --rm certbot certonly \\"
echo "       --webroot --webroot-path=/var/www/certbot \\"
echo "       --email keigo@unson.jp --agree-tos \\"
echo "       -d graph.brainbase.work"
echo "     docker-compose restart nginx"
echo ""
echo "  2. Device Code Flowテスト:"
echo "     BRAINBASE_API_URL=${API_URL} npm run mcp-setup"
echo ""

# ローカルの一時ファイル削除
rm -f /tmp/graph-api-image.tar.gz
