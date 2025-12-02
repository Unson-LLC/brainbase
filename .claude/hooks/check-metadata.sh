#!/bin/bash
# brainbase メタデータ整合性チェック（Stop hook）

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_FILE="$WORKSPACE_ROOT/.claude/hooks/state/metadata-check.log"
TMP_OUTPUT="/tmp/metadata-check-output.txt"

# 発火ログ
echo "[$(date '+%Y-%m-%d %H:%M:%S')] check-metadata.sh fired" >> "$LOG_FILE"

# チェック実行（出力を一時ファイルに保存）
node "$WORKSPACE_ROOT/_codex/common/ops/scripts/check-metadata-integrity.js" > "$TMP_OUTPUT" 2>&1

exit_code=$?

# ログファイルにも保存
cat "$TMP_OUTPUT" >> "$LOG_FILE"

if [ $exit_code -ne 0 ]; then
    echo ""
    echo "⚠️  メタデータ整合性エラー:"
    echo ""
    # エラー行と警告行のみ抽出して表示
    grep -E "^❌|^⚠️|^   -" "$TMP_OUTPUT"
    echo ""
    echo "詳細: $LOG_FILE"
fi

rm -f "$TMP_OUTPUT"
exit $exit_code
