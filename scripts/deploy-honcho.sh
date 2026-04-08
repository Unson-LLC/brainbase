#!/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Honcho Memory Server - Deploy Script
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#
# 目的: Honcho Memory ServerをLightsailにデプロイ
#       リポジトリクローン→設定転送→ビルド→起動→ヘルスチェック
#
# 使い方:
#   ./scripts/deploy-honcho.sh          # 初回セットアップ + デプロイ
#   ./scripts/deploy-honcho.sh update   # 更新のみ（git pull + rebuild）
#
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -e

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 設定
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LIGHTSAIL_HOST="176.34.20.239"
LIGHTSAIL_USER="ubuntu"
LIGHTSAIL_KEY="$HOME/.ssh/lightsail-brainbase.pem"
REMOTE_DIR="/home/ubuntu/honcho"
HONCHO_REPO="https://github.com/plastic-labs/honcho.git"
API_URL="http://127.0.0.1:8000"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧠 Honcho Memory Server デプロイ開始"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 0: 環境変数ファイル確認
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo "📋 Step 0: 環境変数ファイル確認"
if [ ! -f .env.honcho ]; then
    echo "❌ .env.honcho が見つかりません"
    echo "   .env.honcho.example をコピーして作成してください:"
    echo "   cp .env.honcho.example .env.honcho"
    exit 1
fi
echo "✅ .env.honcho 確認完了"

# SSHキー確認
if [ ! -f "$LIGHTSAIL_KEY" ]; then
    echo "❌ SSHキーが見つかりません: $LIGHTSAIL_KEY"
    exit 1
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 1: リモートディレクトリ準備 + Honchoリポジトリ
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo "📂 Step 1: リモート準備"

if [ "$1" = "update" ]; then
    echo "🔄 更新モード: git pull のみ"
    ssh -i "$LIGHTSAIL_KEY" "$LIGHTSAIL_USER@$LIGHTSAIL_HOST" << EOF
cd $REMOTE_DIR/repo && git pull origin main
EOF
else
    echo "🆕 初回セットアップ: リポジトリクローン"
    ssh -i "$LIGHTSAIL_KEY" "$LIGHTSAIL_USER@$LIGHTSAIL_HOST" << EOF
mkdir -p $REMOTE_DIR
if [ ! -d "$REMOTE_DIR/repo" ]; then
    git clone $HONCHO_REPO $REMOTE_DIR/repo
    echo "✅ リポジトリクローン完了"
else
    cd $REMOTE_DIR/repo && git pull origin main
    echo "✅ リポジトリ更新完了"
fi
EOF
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 2: 設定ファイル転送
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo "📤 Step 2: 設定ファイル転送"

scp -i "$LIGHTSAIL_KEY" config/docker-compose.honcho.yml "$LIGHTSAIL_USER@$LIGHTSAIL_HOST:$REMOTE_DIR/docker-compose.yml"
scp -i "$LIGHTSAIL_KEY" .env.honcho "$LIGHTSAIL_USER@$LIGHTSAIL_HOST:$REMOTE_DIR/.env.honcho"

echo "✅ 設定ファイル転送完了"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 3: Dockerビルド＆起動
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo "🔄 Step 3: Dockerビルド＆起動"

ssh -i "$LIGHTSAIL_KEY" "$LIGHTSAIL_USER@$LIGHTSAIL_HOST" << 'EOF'
cd /home/ubuntu/honcho

# .env.honchoの変数を読み込み（docker-compose用）
export $(grep -v '^#' .env.honcho | xargs)

# 既存コンテナ停止
docker compose down || true

# ビルド＆起動
docker compose up -d --build

echo "✅ コンテナ起動完了"
docker compose ps
EOF

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 4: ヘルスチェック
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo "🩺 Step 4: ヘルスチェック"

echo "⏳ 起動待ち（30秒）..."
sleep 30

MAX_RETRIES=5
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    echo "🔍 ヘルスチェック試行 $(($RETRY_COUNT + 1))/$MAX_RETRIES"

    HTTP_CODE=$(ssh -i "$LIGHTSAIL_KEY" "$LIGHTSAIL_USER@$LIGHTSAIL_HOST" \
        "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/docs" 2>/dev/null || echo "000")

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
    echo "   cd $REMOTE_DIR && docker compose logs"
    exit 1
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 完了
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Honcho デプロイ完了！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🧠 Honcho API: http://127.0.0.1:8000 (Lightsail内部)"
echo "📚 API Docs:   http://127.0.0.1:8000/docs"
echo ""
echo "📋 brainbase側の設定:"
echo "  HONCHO_API_URL=http://127.0.0.1:8000"
echo ""
echo "🔧 ログ確認:"
echo "  ssh -i $LIGHTSAIL_KEY $LIGHTSAIL_USER@$LIGHTSAIL_HOST"
echo "  cd $REMOTE_DIR && docker compose logs -f"
echo ""
