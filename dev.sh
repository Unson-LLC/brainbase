#!/bin/bash
# brainbase-ui 開発サーバー起動スクリプト

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 色定義
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== brainbase-ui 開発サーバー ===${NC}"

# ttyd チェック
if ! command -v ttyd &> /dev/null; then
    echo -e "${RED}Error: ttyd がインストールされていません${NC}"
    echo "インストール: brew install ttyd"
    exit 1
fi

# tmux チェック
if ! command -v tmux &> /dev/null; then
    echo -e "${RED}Error: tmux がインストールされていません${NC}"
    echo "インストール: brew install tmux"
    exit 1
fi

# node_modules チェック
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}依存関係をインストール中...${NC}"
    npm install
fi

# uploads ディレクトリ作成
mkdir -p uploads

# 古いプロセスをクリーンアップ
echo -e "${YELLOW}古いプロセスをクリーンアップ中...${NC}"

# 既存のbrainbase-uiサーバープロセスを確認
EXISTING_PIDS=$(pgrep -f "node.*server.js" || true)
if [ -n "$EXISTING_PIDS" ]; then
    echo -e "${YELLOW}既存のサーバープロセスを停止中...${NC}"
    pkill -f "node.*server.js" 2>/dev/null || true
    sleep 1
fi

# ttydプロセスもクリーンアップ
pkill -f "ttyd.*console" 2>/dev/null || true

# ポートが空くまで待機（最大5秒）
for i in {1..5}; do
    if ! lsof -i:3000 >/dev/null 2>&1; then
        break
    fi
    echo -e "${YELLOW}ポート3000の解放を待機中...${NC}"
    sleep 1
done

# サーバー起動
echo -e "${GREEN}サーバーを起動中...${NC}"
echo -e "URL: ${GREEN}http://localhost:3000${NC}"
echo -e "終了: Ctrl+C"
echo ""

npm run dev
