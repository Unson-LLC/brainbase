#!/bin/bash
# Worktreeでのサーバー起動を防止するチェックスクリプト

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 色定義
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# .gitがファイルかディレクトリかをチェック
if [ -f "$PROJECT_ROOT/.git" ]; then
    # .gitがファイル = worktree
    echo ""
    echo -e "${RED}❌ エラー: worktreeではbrainbaseサーバーを起動できません${NC}"
    echo ""
    echo -e "${YELLOW}理由:${NC}"
    echo "  - 正本とworktreeが同じstate.json、セッションを管理しようとして競合します"
    echo "  - 複数のサーバーが同じttydプロセスを操作し、Claudeセッションがクラッシュします"
    echo ""
    echo -e "${YELLOW}対処方法:${NC}"
    BRAINBASE_ROOT="${WORKSPACE_ROOT:-/path/to/workspace}/projects/brainbase"
    echo "  1. 正本でサーバーを起動してください:"
    echo "     cd $BRAINBASE_ROOT"
    echo "     npm start"
    echo ""
    echo "  2. worktreeではコード変更のみ行ってください"
    echo "  3. 変更後は正本でコミット・テストを実施してください"
    echo ""
    exit 1
fi

# 正本の場合は何もせず終了
exit 0
