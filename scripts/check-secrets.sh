#!/bin/bash
# OSS公開前の機密情報チェックスクリプト
# Usage: ./scripts/check-secrets.sh

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "🔍 OSS Safety Check - Scanning for sensitive information..."
echo ""

# カラー出力
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

# 除外パターン（.gitignoreに含まれるファイルはスキップ）
EXCLUDE_DIRS="node_modules|.git|dist|build|coverage|test-results|.worktrees"
EXCLUDE_FILES="state.json|*.log|*.tmp|SCREENSHOT_REQUEST.md|SCREENSHOT_REQUEST_SLACK.md|MIGRATION_2025-12-31.md|dashboard-implementation-prompt.md"

# チェック関数
check_pattern() {
    local pattern=$1
    local description=$2
    local severity=$3  # "error" or "warning"

    echo "Checking: $description"

    # grepで検索（除外パターンを考慮）
    local results=$(grep -r -n -I \
        --exclude-dir={node_modules,.git,dist,build,coverage,test-results,.worktrees,.claude} \
        --exclude="state.json" \
        --exclude="*.log" \
        --exclude="*.tmp" \
        --exclude="check-secrets.sh" \
        --exclude="SECURITY.md" \
        --exclude="LICENSE" \
        --exclude="ttyd_index.html" \
        --exclude="dev.sh" \
        --exclude="SCREENSHOT_REQUEST.md" \
        --exclude="SCREENSHOT_REQUEST_SLACK.md" \
        --exclude="MIGRATION_2025-12-31.md" \
        --exclude="dashboard-implementation-prompt.md" \
        --exclude="OSS_DIRECTORY_STRUCTURE.md" \
        -E "$pattern" . 2>/dev/null || true)

    if [ -n "$results" ]; then
        if [ "$severity" == "error" ]; then
            echo -e "${RED}✗ FOUND (ERROR):${NC}"
            echo "$results"
            echo ""
            ERRORS=$((ERRORS + 1))
        else
            echo -e "${YELLOW}⚠ FOUND (WARNING):${NC}"
            echo "$results"
            echo ""
            WARNINGS=$((WARNINGS + 1))
        fi
    else
        echo -e "${GREEN}✓ OK${NC}"
        echo ""
    fi
}

echo "=========================================="
echo "Critical Checks (MUST FIX before OSS)"
echo "=========================================="
echo ""

# 1. 個人名チェック（日本語）
check_pattern "佐藤|さとう|サトウ" "Personal names (Japanese - Sato)" "error"
check_pattern "川合|かわい|カワイ" "Personal names (Japanese - Kawai)" "error"
check_pattern "渡邉|渡辺|わたなべ|ワタナベ" "Personal names (Japanese - Watanabe)" "error"
check_pattern "星野|ほしの|ホシノ" "Personal names (Japanese - Hoshino)" "error"

# 2. 個人名チェック（英語）
check_pattern "Keigo|keigo|KEIGO" "Personal names (English - Keigo)" "error"
check_pattern "Sato|sato(?!r)" "Personal names (English - Sato)" "error"
check_pattern "Kawai|kawai|KAWAI" "Personal names (English - Kawai)" "error"
check_pattern "Watanabe|watanabe|WATANABE" "Personal names (English - Watanabe)" "error"
check_pattern "Hoshino|hoshino|HOSHINO" "Personal names (English - Hoshino)" "error"

# 3. 個人メールアドレス
check_pattern "[a-zA-Z0-9._%+-]+@(unson\.co\.jp|gmail\.com|yahoo\.co\.jp)" "Personal email addresses" "error"

# 4. 絶対パス（/Users/ksato/）
check_pattern "/Users/ksato" "Hardcoded absolute paths (/Users/ksato)" "error"
check_pattern "/Users/[a-z]+/" "Hardcoded absolute paths (/Users/*/)" "error"

# 5. AWS認証情報
check_pattern "aws_access_key|aws_secret_key|AWS_ACCESS_KEY|AWS_SECRET_KEY" "AWS credentials" "error"
check_pattern "AKIA[0-9A-Z]{16}" "AWS Access Key ID pattern" "error"

# 6. APIキー・トークン
check_pattern "sk-[a-zA-Z0-9]{48}" "OpenAI API keys" "error"
check_pattern "ghp_[a-zA-Z0-9]{36}" "GitHub Personal Access Tokens" "error"

echo "=========================================="
echo "Warning Checks (Review recommended)"
echo "=========================================="
echo ""

# 7. 会社名・プロジェクト名（サンプルとして許容される場合もあるが要確認）
check_pattern "Company (Eta|Epsilon)" "Real company names in samples" "warning"

# 8. Slackワークスペース固有情報
check_pattern "C[0-9A-Z]{10}" "Slack channel IDs" "warning"
check_pattern "U[0-9A-Z]{10}" "Slack user IDs" "warning"

# 9. 他のパスパターン
check_pattern "/Users/[^/]+/workspace" "Workspace paths" "warning"

echo "=========================================="
echo "Summary"
echo "=========================================="
echo ""

if [ $ERRORS -gt 0 ]; then
    echo -e "${RED}✗ FAILED: Found $ERRORS critical issue(s)${NC}"
    echo "Please fix all errors before OSS release."
    exit 1
elif [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}⚠ WARNINGS: Found $WARNINGS potential issue(s)${NC}"
    echo "Please review warnings before OSS release."
    exit 0
else
    echo -e "${GREEN}✓ PASSED: No sensitive information detected${NC}"
    exit 0
fi
