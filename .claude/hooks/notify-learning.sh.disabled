#!/bin/bash
# .claude/hooks/notify-learning.sh
# UserPromptSubmit時に学習候補をチェックして通知
# 3件以上溜まっていたらコンテキストとして通知を追加

set -e

LEARNING_DIR="/Users/ksato/workspace/.claude/learning"
LEARNING_QUEUE="$LEARNING_DIR/learning_queue"

# 学習候補の数をカウント
count_learning_candidates() {
  local count=0
  if [[ -d "$LEARNING_QUEUE" ]]; then
    count=$(ls -1 "$LEARNING_QUEUE"/*.json 2>/dev/null | wc -l | tr -d ' ')
  fi
  echo "$count"
}

# 学習候補の詳細を取得
get_candidates_summary() {
  local candidates=""
  for f in "$LEARNING_QUEUE"/*.json; do
    if [[ -f "$f" ]]; then
      local skill_name=$(jq -r '.skill_name' "$f" 2>/dev/null)
      local timestamp=$(jq -r '.timestamp' "$f" 2>/dev/null | cut -d'T' -f1)
      candidates="${candidates}  • ${skill_name} (${timestamp})\n"
    fi
  done
  echo -e "$candidates"
}

# メイン処理
main() {
  local count=$(count_learning_candidates)
  local notify_threshold=3  # 3件以上で通知

  # 学習候補が閾値未満なら何もしない
  if [[ $count -lt $notify_threshold ]]; then
    exit 0
  fi

  # 前回通知から一定時間経過しているかチェック（1時間に1回）
  local last_notification_file="$LEARNING_DIR/.last_notification"
  local current_time=$(date +%s)
  local notification_interval=3600  # 1時間

  if [[ -f "$last_notification_file" ]]; then
    local last_notification=$(cat "$last_notification_file")
    local time_diff=$((current_time - last_notification))

    if [[ $time_diff -lt $notification_interval ]]; then
      exit 0
    fi
  fi

  # 通知時刻を記録
  echo "$current_time" > "$last_notification_file"

  # 候補のサマリーを取得
  local summary=$(get_candidates_summary)

  # コンテキストとして通知を追加（stdoutに出力）
  cat <<EOF
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 Skills学習候補: ${count} 件
━━━━━━━━━━━━━━━━━━━━━━━━━━━

${summary}
━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 学習を実行: /learn-skills
   後で確認: そのまま続けてください

━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
}

# 実行
main
