#!/bin/bash
# .claude/hooks/notify-learning.sh
# ユーザーがプロンプトを送信する度に学習候補をチェック
# 学習候補が多い場合はブロックして強制通知

set -e

LEARNING_DIR="/Users/ksato/workspace/.claude/learning"
LEARNING_QUEUE="$LEARNING_DIR/learning_queue"

# 学習候補の数をカウント
count_learning_candidates() {
  local count=$(ls -1 "$LEARNING_QUEUE"/*.json 2>/dev/null | wc -l | tr -d ' ')
  echo "$count"
}

# メイン処理
main() {
  local count=$(count_learning_candidates)
  local block_threshold=10  # 10件以上でブロック通知

  # 学習候補が少なければ何もしない
  if [[ $count -lt $block_threshold ]]; then
    exit 0
  fi

  # 前回通知から一定時間経過しているかチェック
  local last_notification_file="$LEARNING_DIR/.last_notification"
  local current_time=$(date +%s)
  local notification_interval=86400  # 24時間（1日1回）

  if [[ -f "$last_notification_file" ]]; then
    local last_notification=$(cat "$last_notification_file")
    local time_diff=$((current_time - last_notification))

    if [[ $time_diff -lt $notification_interval ]]; then
      exit 0
    fi
  fi

  # 通知時刻を記録
  echo "$current_time" > "$last_notification_file"

  # ブロック通知（ユーザーに表示される）
  cat <<EOF
{
  "decision": "block",
  "reason": "📚 Skills学習候補が ${count} 件溜まっています。\n\n学習を実行: /learn-skills\nスキップ: 再度メッセージを送信\n\n※この通知は1日1回表示されます"
}
EOF
}

# 実行
main
