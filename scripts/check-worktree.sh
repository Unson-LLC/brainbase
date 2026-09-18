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
CURRENT_BRANCH="$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"

# .gitがファイルかディレクトリかをチェック
if [ -f "$PROJECT_ROOT/.git" ]; then
    # .gitがファイル = worktree
    echo ""
    echo -e "${YELLOW}⚠️  Worktree環境でのサーバー起動を検出${NC}"
    echo ""
    if [ "$IS_TEST_MODE" = "true" ]; then
        echo -e "${GREEN}テストモード起動を許可${NC}"
        echo "  - テスト用設定で起動します"
        echo "  - ポート・BRAINBASE_VAR_DIR（保存先）・外部接続先の分離は別途確認してください"
        echo ""
    elif [ "$EFFECTIVE_PORT" = "31013" ]; then
        echo -e "${RED}❌ Worktreeでポート31013は使用禁止${NC}"
        echo ""
        echo "理由:"
        echo "  - 正本とworktreeで同じPORTを使用できません"
        echo "  - BRAINBASE_VAR_DIR（実行時の保存先）が正本とworktreeで分離されていることを確認してください"
        echo ""
        echo "使える起動方法:"
        echo -e "  - ${GREEN}BRAINBASE_TEST_MODE=true npm start${NC}"
        echo -e "  - ${GREEN}PORT=31014 npm run dev${NC}"
        echo -e "  - ${GREEN}PORT=31014 npm start${NC}"
        echo ""
        exit 1
    else
        echo -e "${YELLOW}注意事項:${NC}"
        echo "  - 現在のPORT=${EFFECTIVE_PORT}です。正本と別ポートで起動してください"
        echo "  - BRAINBASE_VAR_DIR（実行時の保存先）が正本とworktreeで分離されていることを確認してください"
        echo ""
        echo -e "${GREEN}現在のポート: ${EFFECTIVE_PORT}${NC}"
        echo ""
    fi
fi

if [ "$IS_TEST_MODE" != "true" ] && [ "$EFFECTIVE_PORT" = "31013" ] && [ "$CURRENT_BRANCH" != "develop" ]; then
    echo ""
    echo -e "${RED}❌ ポート31013は develop ブランチ専用です${NC}"
    echo ""
    echo "現在のブランチ: ${CURRENT_BRANCH:-unknown}"
    echo ""
    echo "使える起動方法:"
    echo -e "  - ${GREEN}git checkout develop && npm start${NC}"
    echo -e "  - ${GREEN}PORT=31014 npm run dev${NC}"
    echo -e "  - ${GREEN}PORT=31014 npm start${NC}"
    echo ""
    exit 1
fi

# 正本・worktree両方で正常終了
exit 0
