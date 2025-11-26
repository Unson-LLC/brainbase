#!/bin/bash
# .claude/hooks/user-prompt-submit.sh
# ユーザーがプロンプトを送信する度に学習候補をチェック

set -e

LEARNING_DIR="/Users/ksato/workspace/.claude/learning"
LEARNING_QUEUE="$LEARNING_DIR/learning_queue"

# 学習候補の数をカウント
count_learning_candidates() {
  local count=$(ls -1 "$LEARNING_QUEUE"/*.json 2>/dev/null | wc -l | tr -d ' ')
  echo "$count"
}

# 学習候補が溜まっているか確認
check_learning_queue() {
  local count=$(count_learning_candidates)
  local threshold=3

  if [[ $count -ge $threshold ]]; then
    return 0  # 学習候補あり
  else
    return 1  # 学習候補なし
  fi
}

# 学習候補の概要を表示
show_learning_summary() {
  local count=$(count_learning_candidates)

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📚 Skills学習候補: ${count} 件"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # 候補のリストを表示（最大3件）
  local shown=0
  for candidate_file in "$LEARNING_QUEUE"/*.json; do
    if [[ ! -f "$candidate_file" ]]; then
      continue
    fi

    if [[ $shown -ge 3 ]]; then
      break
    fi

    local skill_name=$(jq -r '.skill_name' "$candidate_file" 2>/dev/null || echo "unknown")
    local timestamp=$(jq -r '.timestamp' "$candidate_file" 2>/dev/null || echo "unknown")

    echo "  • Skill: $skill_name"
    echo "    検出: $timestamp"
    echo ""

    ((shown++))
  done

  if [[ $count -gt 3 ]]; then
    echo "  ... 他 $((count - 3)) 件"
    echo ""
  fi

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "💡 これらの実行ログからSkillsを自動更新できます。"
  echo ""
  echo "  自動分析を開始する場合:"
  echo "    /learn-skills"
  echo ""
  echo "  後で確認する場合:"
  echo "    そのまま続けてください"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
}

# メイン処理
main() {
  # 学習候補が溜まっているかチェック
  if check_learning_queue; then
    # 前回通知から一定時間経過しているかチェック（重複通知防止）
    local last_notification_file="$LEARNING_DIR/.last_notification"
    local current_time=$(date +%s)
    local notification_interval=3600  # 1時間

    if [[ -f "$last_notification_file" ]]; then
      local last_notification=$(cat "$last_notification_file")
      local time_diff=$((current_time - last_notification))

      if [[ $time_diff -lt $notification_interval ]]; then
        # まだ通知しない
        exit 0
      fi
    fi

    # 学習候補の概要を表示
    show_learning_summary

    # 通知時刻を記録
    echo "$current_time" > "$last_notification_file"
  fi
}

# 実行
main
