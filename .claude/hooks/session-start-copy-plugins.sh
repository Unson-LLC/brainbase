#!/bin/bash

# cwd refresh: prevent EPERM uv_cwd on unmounted drives
cd . 2>/dev/null || cd /tmp

# SessionStart Hook: L2（brainbase-unson）とL3（brainbase-config）の.claude/とroot artifactsを自動コピー
# - plugins/: プラグイン（goal-seek等）
# - hooks/: このスクリプト自体も含む
# - settings.json: SessionStart Hook定義（次回実行のため必須）
# - CLAUDE.md: project共通正本
# - AGENTS.md: Codex互換の派生artifact（CLAUDE.mdと同内容）

set -e

# brainbaseプロジェクトかどうかをチェック
L2_CLAUDE="/Users/ksato/workspace/code/brainbase/.claude"
L3_CLAUDE="/Users/ksato/workspace/brainbase-config/.claude"
L2_CLAUDE_MD="/Users/ksato/workspace/code/brainbase/CLAUDE.md"
L3_CLAUDE_MD="/Users/ksato/workspace/brainbase-config/CLAUDE.md"

# L2もL3も存在しない場合は何もしない（brainbase以外のプロジェクト）
if [ ! -d "$L2_CLAUDE" ] && [ ! -d "$L3_CLAUDE" ] && [ ! -f "$L2_CLAUDE_MD" ] && [ ! -f "$L3_CLAUDE_MD" ]; then
  exit 0
fi

echo "🚀 SessionStart Hook: .claude/ と root artifacts をコピー中..."

# .claude/ ディレクトリを作成
mkdir -p .claude/plugins
mkdir -p .claude/hooks
mkdir -p .claude/commands
mkdir -p .claude/skills
mkdir -p .claude/scripts

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

  # commands/
  if [ -d "$L2_CLAUDE/commands" ]; then
    cp -r "$L2_CLAUDE/commands"/* .claude/commands/ 2>/dev/null || true
  fi

  # skills/
  if [ -d "$L2_CLAUDE/skills" ]; then
    cp -r "$L2_CLAUDE/skills"/* .claude/skills/ 2>/dev/null || true
  fi

  # scripts/
  if [ -d "$L2_CLAUDE/scripts" ]; then
    cp -r "$L2_CLAUDE/scripts"/* .claude/scripts/ 2>/dev/null || true
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

  # commands/
  if [ -d "$L3_CLAUDE/commands" ]; then
    cp -r "$L3_CLAUDE/commands"/* .claude/commands/ 2>/dev/null || true
  fi

  # skills/
  if [ -d "$L3_CLAUDE/skills" ]; then
    cp -r "$L3_CLAUDE/skills"/* .claude/skills/ 2>/dev/null || true
  fi

  # scripts/
  if [ -d "$L3_CLAUDE/scripts" ]; then
    cp -r "$L3_CLAUDE/scripts"/* .claude/scripts/ 2>/dev/null || true
  fi

  # settings.json
  if [ -f "$L3_CLAUDE/settings.json" ]; then
    cp "$L3_CLAUDE/settings.json" .claude/settings.json 2>/dev/null || true
  fi

  echo "  ✅ L3上書き完了"
fi

# root-level artifacts（L2 -> L3 overlay）
ROOT_CLAUDE_MD=""
if [ -f "$L2_CLAUDE_MD" ]; then
  ROOT_CLAUDE_MD="$L2_CLAUDE_MD"
fi
if [ -f "$L3_CLAUDE_MD" ]; then
  ROOT_CLAUDE_MD="$L3_CLAUDE_MD"
fi

if [ -n "$ROOT_CLAUDE_MD" ]; then
  cp "$ROOT_CLAUDE_MD" ./CLAUDE.md 2>/dev/null || true
  cp "$ROOT_CLAUDE_MD" ./AGENTS.md 2>/dev/null || true
fi

echo "✅ SessionStart Hook 完了！（.claude/, CLAUDE.md, AGENTS.md）"
