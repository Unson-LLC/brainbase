#!/bin/bash

# SessionStart Hook: L2とL3の.claude/を標準構造でコピー
# L3が優先（L2 → L3の順で上書き）

set -e

L2_CLAUDE="/Users/ksato/workspace/code/brainbase/.claude"
L3_CLAUDE="/Users/ksato/workspace/brainbase-config/.claude"

# L2もL3も存在しない場合は何もしない（brainbase以外のプロジェクト）
if [ ! -d "$L2_CLAUDE" ] && [ ! -d "$L3_CLAUDE" ]; then
  exit 0
fi

echo "🚀 SessionStart Hook: .claude/ をセットアップ中..."

# .claude/ ディレクトリを作成
mkdir -p .claude/commands
mkdir -p .claude/hooks
mkdir -p .claude/scripts
mkdir -p .claude/skills

# L2からコピー
if [ -d "$L2_CLAUDE" ]; then
  echo "  📦 L2（brainbase）からコピー中..."

  # commands/
  if [ -d "$L2_CLAUDE/commands" ]; then
    cp -r "$L2_CLAUDE/commands"/* .claude/commands/ 2>/dev/null || true
  fi

  # hooks/
  if [ -d "$L2_CLAUDE/hooks" ]; then
    cp -r "$L2_CLAUDE/hooks"/* .claude/hooks/ 2>/dev/null || true
  fi

  # scripts/
  if [ -d "$L2_CLAUDE/scripts" ]; then
    cp -r "$L2_CLAUDE/scripts"/* .claude/scripts/ 2>/dev/null || true
  fi

  # skills/
  if [ -d "$L2_CLAUDE/skills" ]; then
    cp -r "$L2_CLAUDE/skills"/* .claude/skills/ 2>/dev/null || true
  fi

  # settings.json
  if [ -f "$L2_CLAUDE/settings.json" ]; then
    cp "$L2_CLAUDE/settings.json" .claude/settings.json 2>/dev/null || true
  fi

  echo "  ✅ L2コピー完了"
fi

# L3で上書き（優先度が高い）
if [ -d "$L3_CLAUDE" ]; then
  echo "  📦 L3（brainbase-config）で上書き中..."

  # commands/
  if [ -d "$L3_CLAUDE/commands" ]; then
    cp -r "$L3_CLAUDE/commands"/* .claude/commands/ 2>/dev/null || true
  fi

  # hooks/
  if [ -d "$L3_CLAUDE/hooks" ]; then
    cp -r "$L3_CLAUDE/hooks"/* .claude/hooks/ 2>/dev/null || true
  fi

  # scripts/
  if [ -d "$L3_CLAUDE/scripts" ]; then
    cp -r "$L3_CLAUDE/scripts"/* .claude/scripts/ 2>/dev/null || true
  fi

  # skills/
  if [ -d "$L3_CLAUDE/skills" ]; then
    cp -r "$L3_CLAUDE/skills"/* .claude/skills/ 2>/dev/null || true
  fi

  # settings.json
  if [ -f "$L3_CLAUDE/settings.json" ]; then
    cp "$L3_CLAUDE/settings.json" .claude/settings.json 2>/dev/null || true
  fi

  echo "  ✅ L3上書き完了"
fi

echo "✅ .claude/ セットアップ完了！"
