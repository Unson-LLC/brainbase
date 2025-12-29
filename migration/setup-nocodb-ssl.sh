#!/bin/bash
set -e

echo "=== NocoDB SSL Setup ==="
echo ""

# 1. 既存のコンテナを停止
echo "Step 1: Stopping existing containers..."
if docker ps -q > /dev/null 2>&1; then
    docker compose down 2>/dev/null || true
fi

# 2. .envファイルの作成
echo ""
echo "Step 2: Creating .env file..."
if [ ! -f .env ]; then
    echo "POSTGRES_PASSWORD=$(openssl rand -base64 32)" > .env
    echo "✓ .env file created with random password"
else
    echo "✓ .env file already exists"
fi

# 3. Docker Composeでサービス起動
echo ""
echo "Step 3: Starting services with SSL..."
docker compose up -d

# 4. 起動確認
echo ""
echo "Step 4: Waiting for services to start..."
sleep 10

# 5. ステータス確認
echo ""
echo "=== Service Status ==="
docker compose ps

echo ""
echo "✓ Setup complete!"
echo ""
echo "NocoDB URL: https://noco.unson.jp"
echo "Note: SSL certificate will be automatically obtained within a few minutes."
echo ""
echo "Check logs:"
echo "  docker compose logs -f nocodb"
echo "  docker compose logs -f letsencrypt"
