#!/bin/bash
# .claude/hooks/load-architecture.sh
# 会話開始時にarchitecture_map.mdを読むよう指示

set -e

STATE_DIR="/Users/ksato/workspace/.claude/hooks/state"
ARCHITECTURE_FILE="/Users/ksato/workspace/_codex/common/architecture_map.md"

mkdir -p "$STATE_DIR"

# セッションIDを取得（環境変数から、なければPPIDで代用）
SESSION_ID="${CLAUDE_SESSION_ID:-$PPID}"
STATE_FILE="$STATE_DIR/architecture_loaded_${SESSION_ID}"

# 既にこのセッションで読み込み済みならスキップ
if [[ -f "$STATE_FILE" ]]; then
  exit 0
fi

# 読み込み済みフラグを立てる（1時間で期限切れ）
echo "$(date +%s)" > "$STATE_FILE"

# 古いstate fileを削除（1時間以上前のもの）
find "$STATE_DIR" -name 'architecture_loaded_*' -mmin +60 -delete 2>/dev/null || true

# architecture_map.mdの内容を読み込んで指示を出す
if [[ -f "$ARCHITECTURE_FILE" ]]; then
  cat <<EOF
{
  "hookSpecificOutput": "⚠️ **brainbase構造を確認してください**\n\n新規エンティティ（プロジェクト・顧客・パートナー等）を作成する際は、必ず以下を事前に確認:\n\n1. \`_codex/common/architecture_map.md\` - エンティティ定義・正本の所在\n2. \`mcp__brainbase__get_context\` - 関連情報の取得\n3. 既存ファイルのフォーマット確認\n\n**エンティティ一覧:**\n- 人: meta/people.md, meta/people/<name>.md\n- 組織: meta/orgs.md\n- 顧客: meta/customers.md, meta/customers/<id>.md\n- パートナー: meta/partners.md, meta/partners/<id>.md\n- プロジェクト: projects/<name>/project.md\n- RACI: meta/raci/<法人>.md"
}
EOF
fi
