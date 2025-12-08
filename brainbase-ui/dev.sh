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

# 古い ttyd プロセスをクリーンアップ
echo -e "${YELLOW}古いプロセスをクリーンアップ中...${NC}"
pkill -f "ttyd.*console" 2>/dev/null || true

# サーバー起動
echo -e "${GREEN}サーバーを起動中...${NC}"
echo -e "URL: ${GREEN}http://localhost:3000${NC}"
echo -e "終了: Ctrl+C"
echo ""

npm run dev
