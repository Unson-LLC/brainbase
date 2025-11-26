#!/bin/bash
# .claude/hooks/tool-result.sh
# Agent実行内容をキャプチャして学習候補を検出

set -e

LEARNING_DIR="/Users/ksato/workspace/.claude/learning"
EXECUTION_LOGS="$LEARNING_DIR/execution_logs"
LEARNING_QUEUE="$LEARNING_DIR/learning_queue"

# 学習対象ツールの判定
is_learning_target() {
  local tool="$1"

  # 学習対象: Write, Edit（Skillsやドキュメント作成）
  if [[ "$tool" =~ ^(Write|Edit)$ ]]; then
    return 0
  fi

  return 1
}

# Skills関連の操作を検出
is_skills_related() {
  local file_path="$1"

  # _codex, _tasks, skills関連のファイル
  if [[ "$file_path" =~ (_codex/|_tasks/|\.claude/skills/) ]]; then
    return 0
  fi

  # プロジェクト戦略ドキュメント（01_strategy等）
  if [[ "$file_path" =~ 01_strategy\.md|02_offer|03_sales_ops|04_delivery|05_kpi ]]; then
    return 0
  fi

  return 1
}

# メイン処理
main() {
  # 学習対象ツールかチェック
  if ! is_learning_target "$TOOL"; then
    exit 0
  fi

  # パラメータからfile_pathを取得
  local file_path=""
  if [[ "$TOOL" == "Write" ]]; then
    file_path=$(echo "$PARAMS" | jq -r '.file_path // empty' 2>/dev/null || echo "")
  elif [[ "$TOOL" == "Edit" ]]; then
    file_path=$(echo "$PARAMS" | jq -r '.file_path // empty' 2>/dev/null || echo "")
  fi

  # Skills関連の操作かチェック
  if [[ -z "$file_path" ]] || ! is_skills_related "$file_path"; then
    exit 0
  fi

  # 実行ログを保存
  local timestamp=$(date +%Y-%m-%d_%H-%M-%S)
  local log_file="$EXECUTION_LOGS/${timestamp}.json"

  cat > "$log_file" <<EOF
{
  "timestamp": "$(date -Iseconds)",
  "tool": "$TOOL",
  "file_path": "$file_path",
  "params": $PARAMS,
  "user_prompt": "${MESSAGE:-unknown}",
  "result_preview": "$(echo "$RESULT" | head -c 200 | jq -Rs . || echo '""')"
}
EOF

  # 学習候補を検出（簡易版：ファイル名からSkillを推定）
  local skill_name=""

  if [[ "$file_path" =~ 01_strategy\.md ]]; then
    skill_name="strategy-template"
  elif [[ "$file_path" =~ _tasks/index\.md ]]; then
    skill_name="task-format"
  elif [[ "$file_path" =~ raci\.md ]]; then
    skill_name="raci-format"
  elif [[ "$file_path" =~ _codex/knowledge/ ]]; then
    skill_name="knowledge-frontmatter"
  fi

  # 学習候補として保存
  if [[ -n "$skill_name" ]]; then
    local candidate_id=$(date +%s)
    local candidate_file="$LEARNING_QUEUE/candidate_${candidate_id}.json"

    cat > "$candidate_file" <<EOF
{
  "id": "$candidate_id",
  "timestamp": "$(date -Iseconds)",
  "skill_name": "$skill_name",
  "file_path": "$file_path",
  "tool": "$TOOL",
  "status": "pending",
  "execution_log": "$log_file"
}
EOF

    # 通知（オプション）
    echo "💡 学習候補を検出: $skill_name（候補ID: $candidate_id）" >&2
  fi
}

# 実行
main
