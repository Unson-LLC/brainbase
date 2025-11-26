#!/bin/bash
# .claude/learning/scripts/apply_update.sh
# 承認された更新案をSkillsに適用

set -e

LEARNING_DIR="/Users/ksato/workspace/.claude/learning"
SKILLS_DIR="/Users/ksato/workspace/.claude/skills"
SKILL_UPDATES="$LEARNING_DIR/skill_updates"
HISTORY_DIR="$LEARNING_DIR/history"
BACKUPS_DIR="$HISTORY_DIR/backups"

# 使用方法
usage() {
  echo "使用方法: $0 <update_id>"
  echo ""
  echo "例: $0 1732534800"
  exit 1
}

# バックアップを作成
create_backup() {
  local skill_name="$1"
  local skill_file="$SKILLS_DIR/$skill_name/SKILL.md"

  if [[ ! -f "$skill_file" ]]; then
    echo "❌ エラー: Skillファイルが見つかりません: $skill_file"
    exit 1
  fi

  # バックアップディレクトリを作成
  mkdir -p "$BACKUPS_DIR"

  # バックアップファイル名
  local timestamp=$(date +%Y-%m-%d_%H-%M-%S)
  local backup_file="$BACKUPS_DIR/${skill_name}_${timestamp}.md"

  # バックアップを作成
  cp "$skill_file" "$backup_file"

  echo "💾 バックアップ作成: $backup_file"
  echo "$backup_file"
}

# 更新を適用
apply_update() {
  local update_id="$1"
  local update_file="$SKILL_UPDATES/update_${update_id}.json"

  if [[ ! -f "$update_file" ]]; then
    echo "❌ エラー: 更新ファイルが見つかりません: $update_file"
    exit 1
  fi

  # 更新情報を読み込み
  local skill_name=$(jq -r '.skill_name' "$update_file")
  local new_patterns=$(jq -r '.new_patterns' "$update_file")
  local confidence=$(jq -r '.confidence' "$update_file")
  local reason=$(jq -r '.reason' "$update_file")

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "✅ Skills更新を適用"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  Skill: $skill_name"
  echo "  更新内容: $new_patterns"
  echo "  信頼度: ${confidence}"
  echo "  理由: $reason"
  echo ""

  # バックアップを作成
  local backup_file=$(create_backup "$skill_name")

  # Skillファイルを更新
  local skill_file="$SKILLS_DIR/$skill_name/SKILL.md"

  # 更新内容を追加（Instructions セクションの最後に追加）
  # 簡易版: ## Examples の前に挿入
  local temp_file="${skill_file}.tmp"

  awk -v new_content="### 新しいチェック項目\n\n$new_patterns\n" '
    /^## Examples/ {
      print ""
      print new_content
    }
    { print }
  ' "$skill_file" > "$temp_file"

  mv "$temp_file" "$skill_file"

  echo "📝 Skillを更新: $skill_file"
  echo ""

  # 履歴を記録
  local today=$(date +%Y-%m-%d)
  local history_file="$HISTORY_DIR/${today}.md"

  cat >> "$history_file" <<EOF

## $(date +%H:%M:%S) - $skill_name 更新

- **更新ID**: $update_id
- **更新内容**: $new_patterns
- **信頼度**: ${confidence}
- **理由**: $reason
- **バックアップ**: $backup_file

EOF

  echo "📚 履歴を記録: $history_file"
  echo ""

  # 更新ステータスを変更
  jq '.status = "applied" | .applied_at = now' "$update_file" > "${update_file}.tmp"
  mv "${update_file}.tmp" "$update_file"

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "✅ 更新完了！"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "💡 次回から、このSkillを使用する際に新しい内容が反映されます。"
  echo ""
  echo "ロールバックする場合:"
  echo "  cp $backup_file $skill_file"
  echo ""
}

# メイン処理
main() {
  if [[ $# -lt 1 ]]; then
    usage
  fi

  local update_id="$1"
  apply_update "$update_id"
}

main "$@"
