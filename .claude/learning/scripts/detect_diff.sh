#!/bin/bash
# .claude/learning/scripts/detect_diff.sh
# 実行ログとSkillsの差分を検出

set -e

LEARNING_DIR="/Users/ksato/workspace/.claude/learning"
SKILLS_DIR="/Users/ksato/workspace/.claude/skills"
LEARNING_QUEUE="$LEARNING_DIR/learning_queue"

# 使用方法
usage() {
  echo "使用方法: $0 <candidate_id>"
  echo ""
  echo "例: $0 1732534800"
  exit 1
}

# 差分を検出
detect_diff() {
  local candidate_id="$1"
  local candidate_file="$LEARNING_QUEUE/candidate_${candidate_id}.json"

  if [[ ! -f "$candidate_file" ]]; then
    echo "❌ エラー: 候補ファイルが見つかりません: $candidate_file"
    exit 1
  fi

  # 候補情報を読み込み
  local skill_name=$(jq -r '.skill_name' "$candidate_file")
  local file_path=$(jq -r '.file_path' "$candidate_file")
  local execution_log=$(jq -r '.execution_log' "$candidate_file")

  echo "🔍 差分検出: $skill_name"
  echo "  対象ファイル: $file_path"
  echo ""

  # 既存Skillの内容を取得
  local skill_file="$SKILLS_DIR/$skill_name/SKILL.md"
  if [[ ! -f "$skill_file" ]]; then
    echo "⚠️  警告: Skillファイルが見つかりません: $skill_file"
    echo "  新規Skill作成が必要かもしれません"
    return 1
  fi

  # 実行ログから実行内容を抽出
  if [[ ! -f "$execution_log" ]]; then
    echo "❌ エラー: 実行ログが見つかりません: $execution_log"
    exit 1
  fi

  local user_prompt=$(jq -r '.user_prompt' "$execution_log")
  local result_preview=$(jq -r '.result_preview' "$execution_log")

  echo "## 実行内容"
  echo "ユーザー指示: $user_prompt"
  echo ""
  echo "実行結果（プレビュー）:"
  echo "$result_preview" | head -10
  echo ""

  # Skillの内容と比較（簡易版）
  echo "## 既存Skill内容"
  echo "ファイル: $skill_file"
  grep -A 5 "## Instructions" "$skill_file" | head -20
  echo ""

  # 差分判定（簡易版：キーワードマッチング）
  local has_diff=false

  # 実行ログに新しいパターンが含まれるか検出
  if echo "$result_preview" | grep -q "新しいチェック項目\|追加のベストプラクティス\|改善された手順"; then
    has_diff=true
    echo "✅ 差分検出: 新しいパターンが見つかりました"
  else
    echo "⏭️  差分なし: 既存Skillと一致しています"
  fi

  if [[ "$has_diff" == "true" ]]; then
    # 学習候補としてマーク
    jq '.status = "diff_detected" | .diff_detected_at = now | .requires_review = true' \
      "$candidate_file" > "${candidate_file}.tmp" && mv "${candidate_file}.tmp" "$candidate_file"

    echo ""
    echo "📝 学習候補を更新しました"
    echo "  次のステップ: /learn-skills コマンドで更新案を生成"
  fi
}

# メイン処理
main() {
  if [[ $# -lt 1 ]]; then
    usage
  fi

  local candidate_id="$1"
  detect_diff "$candidate_id"
}

main "$@"
