#!/bin/bash
# Worktreeでのサーバー起動時の警告スクリプト

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 色定義
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

EFFECTIVE_PORT="${PORT:-31013}"
IS_TEST_MODE="${BRAINBASE_TEST_MODE:-false}"

# .gitがファイルかディレクトリかをチェック
if [ -f "$PROJECT_ROOT/.git" ]; then
    # .gitがファイル = worktree
    echo ""
    echo -e "${YELLOW}⚠️  Worktree環境でのサーバー起動を検出${NC}"
    echo ""
    if [ "$IS_TEST_MODE" = "true" ]; then
        echo -e "${GREEN}テストモード起動を許可${NC}"
        echo "  - BRAINBASE_TEST_MODE=true のため、worktreeでも安全に起動できます"
        echo "  - セッション管理は無効化されます"
        echo ""
    elif [ "$EFFECTIVE_PORT" = "31013" ]; then
        echo -e "${RED}❌ Worktreeでポート31013は使用禁止${NC}"
        echo ""
        echo "理由:"
        echo "  - 正本とworktreeが同じvar/state.jsonを共有しています"
        echo "  - 正本サーバーと同じ31013を使うと、セッション管理とopen-fileの挙動が競合します"
        echo ""
        echo "使える起動方法:"
        echo -e "  - ${GREEN}BRAINBASE_TEST_MODE=true npm start${NC}"
        echo -e "  - ${GREEN}PORT=31014 npm run dev${NC}"
        echo -e "  - ${GREEN}PORT=31014 npm start${NC}"
        echo ""
        exit 1
    else
        echo -e "${YELLOW}注意事項:${NC}"
        echo "  - 正本とworktreeが同じvar/state.jsonを共有しています"
        echo "  - セッション管理機能を使うなら、正本と別ポートで起動してください"
        echo ""
        echo -e "${GREEN}現在のポート: ${EFFECTIVE_PORT}${NC}"
        echo ""
    fi
fi

# 正本・worktree両方で正常終了
exit 0
