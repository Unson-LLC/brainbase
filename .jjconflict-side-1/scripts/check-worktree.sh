#!/bin/bash
# Worktreeでのサーバー起動時の警告スクリプト

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 色定義
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# .gitがファイルかディレクトリかをチェック
if [ -f "$PROJECT_ROOT/.git" ]; then
    # .gitがファイル = worktree
    echo ""
    echo -e "${YELLOW}⚠️  Worktree環境でのサーバー起動を検出${NC}"
    echo ""
    echo -e "${YELLOW}注意事項:${NC}"
    echo "  - 正本とworktreeが同じvar/state.jsonを共有しています"
    echo "  - セッション管理機能を使用すると競合が発生します"
    echo ""
    echo -e "${GREEN}推奨: テストモードで起動${NC}"
    echo "  テストモードではセッション管理が無効化され、UI検証・E2Eテストが安全に実行できます"
    echo ""
    echo "  起動コマンド:"
    echo -e "    ${GREEN}BRAINBASE_TEST_MODE=true npm start${NC}"
    echo ""
    echo "  または、package.jsonに追加されたスクリプトを使用:"
    echo -e "    ${GREEN}npm run test:server${NC}"
    echo ""
    # exit 1を削除 → 起動は許可、ただし警告を表示
fi

# 正本・worktree両方で正常終了
exit 0
