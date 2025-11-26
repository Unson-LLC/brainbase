#!/bin/bash
# .claude/hooks/stop.sh
# 会話終了時に学習候補を検出・分析

set -e

LEARNING_DIR="/Users/ksato/workspace/.claude/learning"
EXECUTION_LOGS="$LEARNING_DIR/execution_logs"
LEARNING_QUEUE="$LEARNING_DIR/learning_queue"
CODEX_DIR="/Users/ksato/workspace/_codex"

# 今回の会話で変更されたファイルを検出
detect_changes() {
  local timestamp=$(date +%Y-%m-%d_%H-%M-%S)
  local log_file="$EXECUTION_LOGS/session_${timestamp}.json"

  # git diffで変更を検出（_codex配下のみ）
  local changed_files=$(git -C "$CODEX_DIR" diff --name-only HEAD 2>/dev/null || echo "")
  local staged_files=$(git -C "$CODEX_DIR" diff --cached --name-only 2>/dev/null || echo "")

  # 変更ファイルがなければ終了
  if [[ -z "$changed_files" && -z "$staged_files" ]]; then
    exit 0
  fi

  # 変更内容をログに保存
  cat > "$log_file" <<EOF
{
  "timestamp": "$(date -Iseconds)",
  "session_type": "stop",
  "changed_files": [
$(echo "$changed_files" "$staged_files" | sort -u | grep -v '^$' | sed 's/^/    "/;s/$/",/' | sed '$ s/,$//')
  ]
}
EOF

  echo "$log_file"
}

# 変更ファイルからSkill候補を検出
detect_skill_candidates() {
  local log_file="$1"
  local candidates_added=0

  # 変更ファイルを読み込み
  local files=$(jq -r '.changed_files[]' "$log_file" 2>/dev/null || echo "")

  for file in $files; do
    local skill_name=""

    # ファイルパスからSkillを推定
    case "$file" in
      *project.md|*01_strategy*)
        skill_name="strategy-template"
        ;;
      *_tasks/index.md)
        skill_name="task-format"
        ;;
      *raci/*.md)
        skill_name="raci-format"
        ;;
      *knowledge/*.md)
        skill_name="knowledge-frontmatter"
        ;;
      *people/*.md)
        skill_name="people-meta"
        ;;
      *customers.md|*apps.md|*orgs.md)
        skill_name="meta-tables"
        ;;
    esac

    # 候補として保存
    if [[ -n "$skill_name" ]]; then
      local candidate_id=$(date +%s%N | cut -c1-13)
      local candidate_file="$LEARNING_QUEUE/candidate_${candidate_id}.json"

      cat > "$candidate_file" <<EOF
{
  "id": "$candidate_id",
  "timestamp": "$(date -Iseconds)",
  "skill_name": "$skill_name",
  "file_path": "$file",
  "trigger": "session_stop",
  "status": "pending",
  "execution_log": "$log_file"
}
EOF
      ((candidates_added++))
    fi
  done

  echo "$candidates_added"
}

# メイン処理
main() {
  # 変更を検出
  local log_file=$(detect_changes)

  if [[ -z "$log_file" ]]; then
    exit 0
  fi

  # Skill候補を検出
  local count=$(detect_skill_candidates "$log_file")

  if [[ $count -gt 0 ]]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📚 学習候補を ${count} 件検出しました"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "次回 /learn-skills で分析・更新できます"
    echo ""
  fi
}

# 実行
main
