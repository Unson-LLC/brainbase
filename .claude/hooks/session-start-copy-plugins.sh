#!/bin/bash

# SessionStart Hook: L2（brainbase-unson）とL3（brainbase-config）の.claude/plugins/を自動コピー

set -e

echo "🚀 SessionStart Hook: .claude/plugins/ をコピー中..."

# .claude/plugins/ ディレクトリを作成
mkdir -p .claude/plugins

# L2（brainbase-unson）からコピー
L2_PLUGINS="/Users/ksato/workspace/code/brainbase/.claude/plugins"
if [ -d "$L2_PLUGINS" ]; then
  echo "  📦 L2（brainbase-unson）からコピー中..."
  cp -r "$L2_PLUGINS"/* .claude/plugins/ 2>/dev/null || true
  echo "  ✅ L2コピー完了"
fi

# L3（brainbase-config）で上書き（優先度が高い）
L3_PLUGINS="/Users/ksato/workspace/brainbase-config/.claude/plugins"
if [ -d "$L3_PLUGINS" ]; then
  echo "  📦 L3（brainbase-config）で上書き中..."
  cp -r "$L3_PLUGINS"/* .claude/plugins/ 2>/dev/null || true
  echo "  ✅ L3上書き完了"
fi

echo "✅ .claude/plugins/ コピー完了！"
