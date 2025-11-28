#!/bin/bash
# .claude/hooks/detect-changes.sh
# 会話終了時に学習候補を検出（重複排除付き）

set -e

LEARNING_DIR="/Users/ksato/workspace/.claude/learning"
EXECUTION_LOGS="$LEARNING_DIR/execution_logs"
LEARNING_QUEUE="$LEARNING_DIR/learning_queue"
CODEX_DIR="/Users/ksato/workspace/_codex"

# ディレクトリ確保
mkdir -p "$EXECUTION_LOGS" "$LEARNING_QUEUE"

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

# 既存候補にスキルが存在するかチェック
skill_exists_in_queue() {
  local skill_name="$1"
  local files
  files=$(ls "$LEARNING_QUEUE"/*.json 2>/dev/null) || return 1

  for candidate_file in $files; do
    if [[ -f "$candidate_file" ]]; then
      local existing_skill
      existing_skill=$(jq -r '.skill_name' "$candidate_file" 2>/dev/null) || continue
      if [[ "$existing_skill" == "$skill_name" ]]; then
        return 0  # 存在する
      fi
    fi
  done
  return 1  # 存在しない
}

# 変更ファイルからSkill候補を検出（重複排除付き）
detect_skill_candidates() {
  local log_file="$1"
  local candidates_added=0
  local skills_seen=""

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

    # スキルが特定できない場合はスキップ
    if [[ -z "$skill_name" ]]; then
      continue
    fi

    # 今回のセッションで既に追加済みならスキップ
    if [[ "$skills_seen" == *"$skill_name"* ]]; then
      continue
    fi
    skills_seen="$skills_seen $skill_name"

    # キューに既に同じスキルがあればスキップ（重複排除）
    if skill_exists_in_queue "$skill_name"; then
      continue
    fi

    # 候補として保存
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

  # Skill候補を検出（重複排除付き）
  local count=$(detect_skill_candidates "$log_file")

  # 新規候補がある場合はログに記録（Stop hookはhookSpecificOutput非対応）
  if [[ $count -gt 0 ]]; then
    echo "学習候補を ${count} 件検出しました" >&2
  fi
}

# 実行
main
