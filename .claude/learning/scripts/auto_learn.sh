#!/bin/bash
# .claude/learning/scripts/auto_learn.sh
# 学習候補を自動分析して更新案を生成

set -e

LEARNING_DIR="/Users/ksato/workspace/.claude/learning"
SKILLS_DIR="/Users/ksato/workspace/.claude/skills"
LEARNING_QUEUE="$LEARNING_DIR/learning_queue"
SKILL_UPDATES="$LEARNING_DIR/skill_updates"

# 学習候補を分析
analyze_candidate() {
  local candidate_file="$1"
  local candidate_id=$(jq -r '.id' "$candidate_file")
  local skill_name=$(jq -r '.skill_name' "$candidate_file")
  local execution_log=$(jq -r '.execution_log' "$candidate_file")

  echo "🔍 分析中: $skill_name (候補ID: $candidate_id)"

  # 実行ログを読み込み
  if [[ ! -f "$execution_log" ]]; then
    echo "  ⚠️  実行ログが見つかりません: $execution_log"
    return 1
  fi

  local user_prompt=$(jq -r '.user_prompt' "$execution_log" 2>/dev/null || echo "unknown")
  local result_preview=$(jq -r '.result_preview' "$execution_log" 2>/dev/null || echo "")

  # 既存Skillを読み込み
  local skill_file="$SKILLS_DIR/$skill_name/SKILL.md"
  if [[ ! -f "$skill_file" ]]; then
    echo "  ⚠️  Skillファイルが見つかりません: $skill_file"
    return 1
  fi

  # 差分検出（簡易版：キーワードベース）
  local new_patterns=""
  local confidence=0.0

  # パターン1: 「定量的」というキーワードが実行ログに含まれるか
  if echo "$user_prompt $result_preview" | grep -qi "定量的\|具体的な数値\|%\|日以内"; then
    new_patterns="定量性チェック項目を追加"
    confidence=0.85
  fi

  # パターン2: 「期限」というキーワード
  if echo "$user_prompt $result_preview" | grep -qi "期限\|締め切り\|達成日"; then
    if [[ -n "$new_patterns" ]]; then
      new_patterns="${new_patterns}、目標達成期限の項目を追加"
    else
      new_patterns="目標達成期限の項目を追加"
    fi
    confidence=$(echo "$confidence + 0.10" | bc)
  fi

  # パターン3: 「例」というキーワード
  if echo "$user_prompt $result_preview" | grep -qi "例を追加\|具体例"; then
    if [[ -n "$new_patterns" ]]; then
      new_patterns="${new_patterns}、Examples セクションに具体例を追加"
    else
      new_patterns="Examples セクションに具体例を追加"
    fi
    confidence=$(echo "$confidence + 0.10" | bc)
  fi

  # 新しいパターンが見つかった場合
  if [[ -n "$new_patterns" ]]; then
    echo "  ✅ 新パターン検出: $new_patterns"
    echo "  📊 信頼度: ${confidence}"

    # 更新案を生成
    local update_id=$(date +%s)
    local update_file="$SKILL_UPDATES/update_${update_id}.json"

    cat > "$update_file" <<EOF
{
  "id": "$update_id",
  "timestamp": "$(date -Iseconds)",
  "skill_name": "$skill_name",
  "type": "update",
  "confidence": $confidence,
  "new_patterns": "$new_patterns",
  "reason": "実行ログから新しいパターンを検出しました",
  "candidate_id": "$candidate_id",
  "status": "pending",
  "suggested_changes": {
    "section": "Instructions",
    "content": "$new_patterns"
  }
}
EOF

    echo "  💾 更新案を保存: $update_file"
    return 0
  else
    echo "  ⏭️  新パターンなし"
    return 1
  fi
}

# 全候補を分析
analyze_all_candidates() {
  local total=0
  local analyzed=0
  local updates=0

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📚 Skills学習プロセス開始"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  for candidate_file in "$LEARNING_QUEUE"/*.json; do
    if [[ ! -f "$candidate_file" ]]; then
      continue
    fi

    ((total++))

    # 候補を分析
    if analyze_candidate "$candidate_file"; then
      ((analyzed++))
      ((updates++))
    else
      ((analyzed++))
    fi

    echo ""
  done

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📊 分析完了"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  候補総数: $total"
  echo "  分析済み: $analyzed"
  echo "  更新案生成: $updates"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  if [[ $updates -gt 0 ]]; then
    echo "💡 更新案が生成されました！"
    echo ""
    echo "  確認・承認する場合:"
    echo "    /approve-skill <update_id>"
    echo ""
    echo "  全更新案を確認する場合:"
    echo "    ls -l $SKILL_UPDATES/"
    echo ""
  else
    echo "⏭️  更新が必要な候補はありませんでした"
    echo ""
  fi
}

# メイン処理
main() {
  # 学習候補が存在するかチェック
  local candidate_count=$(ls -1 "$LEARNING_QUEUE"/*.json 2>/dev/null | wc -l | tr -d ' ')

  if [[ $candidate_count -eq 0 ]]; then
    echo "⏭️  学習候補がありません"
    exit 0
  fi

  # 全候補を分析
  analyze_all_candidates
}

# 実行
main "$@"
