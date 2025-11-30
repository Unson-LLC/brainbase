#!/bin/bash
# brainbase メタデータ整合性チェック（Stop hook）

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_FILE="$WORKSPACE_ROOT/.claude/hooks/state/metadata-check.log"

# 発火ログ
echo "[$(date '+%Y-%m-%d %H:%M:%S')] check-metadata.sh fired" >> "$LOG_FILE"

# チェック実行（エラーがあれば終了コード1）
node "$WORKSPACE_ROOT/_codex/common/ops/scripts/check-metadata-integrity.js" >> "$LOG_FILE" 2>&1

exit_code=$?

if [ $exit_code -ne 0 ]; then
    echo ""
    echo "⚠️  メタデータの整合性に問題があります。修正してください。"
fi

exit $exit_code
