#!/bin/bash

# SessionStart Hook: L2（brainbase-unson）とL3（brainbase-config）の.claude/を自動コピー
# - plugins/: プラグイン（goal-seek等）
# - hooks/: このスクリプト自体も含む
# - settings.json: SessionStart Hook定義（次回実行のため必須）

set -e

# brainbaseプロジェクトかどうかをチェック
L2_CLAUDE="/Users/ksato/workspace/code/brainbase/.claude"
L3_CLAUDE="/Users/ksato/workspace/brainbase-config/.claude"

# L2もL3も存在しない場合は何もしない（brainbase以外のプロジェクト）
if [ ! -d "$L2_CLAUDE" ] && [ ! -d "$L3_CLAUDE" ]; then
  exit 0
fi

echo "🚀 SessionStart Hook: .claude/ をコピー中..."

# .claude/ ディレクトリを作成
mkdir -p .claude/plugins
mkdir -p .claude/hooks

# L2（brainbase-unson）からコピー
L2_CLAUDE="/Users/ksato/workspace/code/brainbase/.claude"
if [ -d "$L2_CLAUDE" ]; then
  echo "  📦 L2（brainbase-unson）からコピー中..."

  # plugins/
  if [ -d "$L2_CLAUDE/plugins" ]; then
    cp -r "$L2_CLAUDE/plugins"/* .claude/plugins/ 2>/dev/null || true
  fi

  # hooks/
  if [ -d "$L2_CLAUDE/hooks" ]; then
    cp -r "$L2_CLAUDE/hooks"/* .claude/hooks/ 2>/dev/null || true
  fi

  # settings.json
  if [ -f "$L2_CLAUDE/settings.json" ]; then
    cp "$L2_CLAUDE/settings.json" .claude/settings.json 2>/dev/null || true
  fi

  echo "  ✅ L2コピー完了"
fi

# L3（brainbase-config）で上書き（優先度が高い）
L3_CLAUDE="/Users/ksato/workspace/brainbase-config/.claude"
if [ -d "$L3_CLAUDE" ]; then
  echo "  📦 L3（brainbase-config）で上書き中..."

  # plugins/
  if [ -d "$L3_CLAUDE/plugins" ]; then
    cp -r "$L3_CLAUDE/plugins"/* .claude/plugins/ 2>/dev/null || true
  fi

  # hooks/
  if [ -d "$L3_CLAUDE/hooks" ]; then
    cp -r "$L3_CLAUDE/hooks"/* .claude/hooks/ 2>/dev/null || true
  fi

  # settings.json
  if [ -f "$L3_CLAUDE/settings.json" ]; then
    cp "$L3_CLAUDE/settings.json" .claude/settings.json 2>/dev/null || true
  fi

  echo "  ✅ L3上書き完了"
fi

echo "✅ .claude/ コピー完了！（plugins, hooks, settings.json）"
