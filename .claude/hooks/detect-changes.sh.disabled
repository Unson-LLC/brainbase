#!/bin/bash
# .claude/hooks/detect-changes.sh
# 会話終了時に変更ファイルをログに記録
#
# 注意: パターンマッチによるSkill候補検出は廃止
# 代わりに extract-learnings.sh がtranscriptをLLMで分析して候補を生成

LEARNING_DIR="/Users/ksato/workspace/.claude/learning"
EXECUTION_LOGS="$LEARNING_DIR/execution_logs"
ERROR_LOG="$LEARNING_DIR/hook_errors.log"
WORKSPACE_DIR="/Users/ksato/workspace"

# エラーログ関数
log_error() {
  echo "[$(date -Iseconds)] $1" >> "$ERROR_LOG"
}

# ディレクトリ確保
mkdir -p "$EXECUTION_LOGS" 2>/dev/null || {
  log_error "Failed to create directories"
  exit 0
}

# 今回の会話で変更されたファイルを検出
detect_changes() {
  local timestamp
  timestamp=$(date +%Y-%m-%d_%H-%M-%S) || {
    log_error "Failed to get timestamp"
    return 1
  }
  local log_file="$EXECUTION_LOGS/session_${timestamp}.json"

  # workspaceのgit diffで変更を検出
  local changed_files
  changed_files=$(git -C "$WORKSPACE_DIR" diff --name-only HEAD 2>/dev/null) || changed_files=""

  local staged_files
  staged_files=$(git -C "$WORKSPACE_DIR" diff --cached --name-only 2>/dev/null) || staged_files=""

  # 変更ファイルがなければ空を返す
  if [[ -z "$changed_files" && -z "$staged_files" ]]; then
    echo ""
    return 0
  fi

  # 変更内容をログに保存
  {
    echo '{'
    echo '  "timestamp": "'"$(date -Iseconds)"'",'
    echo '  "session_type": "stop",'
    echo '  "changed_files": ['
    echo "$changed_files" "$staged_files" | tr ' ' '\n' | sort -u | grep -v '^$' | while read -r f; do
      echo "    \"$f\","
    done | sed '$ s/,$//'
    echo '  ]'
    echo '}'
  } > "$log_file" 2>/dev/null || {
    log_error "Failed to write log file: $log_file"
    return 1
  }

  echo "$log_file"
}

# メイン処理
main() {
  # 変更を検出してログ保存
  local log_file
  log_file=$(detect_changes) || {
    log_error "detect_changes failed"
    return 0
  }

  # ログ保存のみ（パターンマッチは行わない）
  # 学習候補抽出は extract-learnings.sh が担当
}

# 実行
main

# 常に正常終了（hookがブロッカーにならないように）
exit 0
