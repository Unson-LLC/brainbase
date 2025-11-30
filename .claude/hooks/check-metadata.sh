#!/bin/bash
# brainbase メタデータ整合性チェック（Stop hook）

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# チェック実行（エラーがあれば終了コード1）
node "$WORKSPACE_ROOT/scripts/check-metadata-integrity.js" 2>&1

exit_code=$?

if [ $exit_code -ne 0 ]; then
    echo ""
    echo "⚠️  メタデータの整合性に問題があります。修正してください。"
fi

exit $exit_code
