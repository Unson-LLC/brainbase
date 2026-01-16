#!/bin/bash
# Brainbase 自動クリーンアップ（cron/launchd用）
# 毎日深夜3時に実行し、3日以上前のdetachedセッションとMCPプロセスを削除

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VAR_DIR="${BRAINBASE_VAR_DIR:-$REPO_ROOT/var}"
LOG_DIR="$VAR_DIR/logs"
LOG_FILE="$LOG_DIR/cleanup-$(date +%Y%m%d).log"

# ログディレクトリ作成
mkdir -p "$LOG_DIR"

# ログ出力開始
{
    echo "=== Brainbase 自動クリーンアップ ==="
    echo "実行日時: $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""

    # 自動承認モードでクリーンアップ実行
    AUTO_CONFIRM=yes "$SCRIPT_DIR/cleanup-old-sessions.sh" 3

    echo ""
    echo "完了日時: $(date '+%Y-%m-%d %H:%M:%S')"
} >> "$LOG_FILE" 2>&1

# 古いログファイルを削除（30日以上前）
find "$LOG_DIR" -name "cleanup-*.log" -mtime +30 -delete 2>/dev/null || true

exit 0
