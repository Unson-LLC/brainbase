#!/bin/bash
# .claude/hooks/detect-changes.sh
# 会話終了時に学習候補を検出（重複排除付き）

LEARNING_DIR="/Users/ksato/workspace/.claude/learning"
EXECUTION_LOGS="$LEARNING_DIR/execution_logs"
LEARNING_QUEUE="$LEARNING_DIR/learning_queue"
ERROR_LOG="$LEARNING_DIR/hook_errors.log"
WORKSPACE_DIR="/Users/ksato/workspace"

# エラーログ関数
log_error() {
  echo "[$(date -Iseconds)] $1" >> "$ERROR_LOG"
}

# ディレクトリ確保
mkdir -p "$EXECUTION_LOGS" "$LEARNING_QUEUE" 2>/dev/null || {
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

# 既存候補にスキルが存在するかチェック
skill_exists_in_queue() {
  local skill_name="$1"

  # jqがなければfalse
  command -v jq >/dev/null 2>&1 || return 1

  # ファイルがなければfalse
  local files
  files=$(ls "$LEARNING_QUEUE"/*.json 2>/dev/null) || return 1

  local candidate_file
  for candidate_file in $files; do
    if [[ -f "$candidate_file" ]]; then
      local existing_skill
      existing_skill=$(jq -r '.skill_name' "$candidate_file" 2>/dev/null) || continue
      if [[ "$existing_skill" == "$skill_name" ]]; then
        return 0
      fi
    fi
  done
  return 1
}

# 変更ファイルからSkill候補を検出（重複排除付き）
detect_skill_candidates() {
  local log_file="$1"
  local candidates_added=0
  local skills_seen=""

  # jqがなければスキップ
  command -v jq >/dev/null 2>&1 || {
    log_error "jq not found, skipping skill detection"
    echo "0"
    return 0
  }

  # 変更ファイルを読み込み
  local files
  files=$(jq -r '.changed_files[]' "$log_file" 2>/dev/null) || files=""

  local file
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
      *partners/*.md)
        skill_name="partners-meta"
        ;;
      *customers/*.md)
        skill_name="customers-meta"
        ;;
      *customers.md|*apps.md|*orgs.md|*partners.md)
        skill_name="meta-tables"
        ;;
      *architecture_map.md)
        skill_name="google-drive-structure"
        ;;
    esac

    # スキルが特定できない場合はスキップ
    [[ -z "$skill_name" ]] && continue

    # 今回のセッションで既に追加済みならスキップ
    [[ "$skills_seen" == *"$skill_name"* ]] && continue
    skills_seen="$skills_seen $skill_name"

    # キューに既に同じスキルがあればスキップ
    skill_exists_in_queue "$skill_name" && continue

    # 候補として保存
    local candidate_id
    candidate_id=$(date +%s)$$
    local candidate_file="$LEARNING_QUEUE/candidate_${candidate_id}.json"

    {
      echo '{'
      echo '  "id": "'"$candidate_id"'",'
      echo '  "timestamp": "'"$(date -Iseconds)"'",'
      echo '  "skill_name": "'"$skill_name"'",'
      echo '  "file_path": "'"$file"'",'
      echo '  "trigger": "session_stop",'
      echo '  "status": "pending",'
      echo '  "execution_log": "'"$log_file"'"'
      echo '}'
    } > "$candidate_file" 2>/dev/null || {
      log_error "Failed to write candidate: $candidate_file"
      continue
    }

    candidates_added=$((candidates_added + 1))
  done

  echo "$candidates_added"
}

# メイン処理
main() {
  # 変更を検出
  local log_file
  log_file=$(detect_changes) || {
    log_error "detect_changes failed"
    return 0
  }

  # 変更なしなら終了
  [[ -z "$log_file" ]] && return 0

  # Skill候補を検出
  local count
  count=$(detect_skill_candidates "$log_file") || count=0

  # 新規候補がある場合はstderrに出力（Claude Codeに表示される）
  if [[ "$count" -gt 0 ]]; then
    echo "学習候補を ${count} 件検出しました。/learn-skills で確認できます。" >&2
  fi
}

# 実行
main

# 常に正常終了（hookがブロッカーにならないように）
exit 0
