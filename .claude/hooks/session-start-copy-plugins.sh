#!/bin/bash

# cwd refresh: prevent EPERM uv_cwd on unmounted drives
cd . 2>/dev/null || cd /tmp

# SessionStart Hook (slim版): 真に必要なものだけ配布
#
# 過去の経緯と現状:
# - 当初設計 (2026-03-02, 8c5e0c12): plugins/ だけを cp する想定だった
# - 4/1 (538d844c): scripts/ の ERR_MODULE_NOT_FOUND 対策として cp追加（当時のskip-worktree問題に伴う）
# - その後 hooks/commands/skills/settings/CLAUDE.md/AGENTS.md/.mcp.json まで cp が肥大化
# - 結果: develop最新 vs session worktreeのcommit版の差分が dirty 1000件として表示される問題が発生
#
# 修復方針 (2026-05-06):
# - skills/scripts/commands/hooks/settings/CLAUDE.md/AGENTS.md/.mcp.json は brainbase repo に
#   git tracked で commit されているため、worktree 作成時点で既に存在する → cp 不要
# - 必要なのは plugins/ (gitignore対象、hookでしか配布できない) と node_modules / mcp 依存だけ
# - 過去の skip-worktree 問題は 9b30a766 で解消済み（fixSymlinks recovery feature が削除済み）
#
# session worktree が古くなった場合は、ユーザー自身が `git merge develop` で
# 明示的に最新化する運用とする（dirty を勝手に発生させないこと優先）。

set -e

# brainbaseプロジェクトかどうかをチェック
L2_CLAUDE="/Users/ksato/workspace/code/brainbase/.claude"
L3_CLAUDE="/Users/ksato/workspace/brainbase-config/.claude"

# L2もL3も存在しない場合は何もしない（brainbase以外のプロジェクト）
if [ ! -d "$L2_CLAUDE" ] && [ ! -d "$L3_CLAUDE" ]; then
  exit 0
fi

echo "🚀 SessionStart Hook (slim): plugins/ + node_modules + mcp依存 のみ配布"

# .claude/plugins/ ディレクトリを作成
mkdir -p .claude/plugins

# L2（brainbase-unson）の plugins/ をコピー
if [ -d "$L2_CLAUDE/plugins" ]; then
  cp -r "$L2_CLAUDE/plugins"/* .claude/plugins/ 2>/dev/null || true
  echo "  ✅ L2 plugins コピー完了"
fi

# L3（brainbase-config）の plugins/ で上書き（優先度が高い）
if [ -d "$L3_CLAUDE/plugins" ]; then
  cp -r "$L3_CLAUDE/plugins"/* .claude/plugins/ 2>/dev/null || true
  echo "  ✅ L3 plugins 上書き完了"
fi

# node_modules を L2 から symlink（hook 実行基盤: npx tsx が解決できるように）
L2_NODE_MODULES="/Users/ksato/workspace/code/brainbase/node_modules"
if [ -d "$L2_NODE_MODULES" ]; then
  if [ ! -e "./node_modules" ] || [ -L "./node_modules" ]; then
    ln -sfn "$L2_NODE_MODULES" ./node_modules
    echo "  🔗 node_modules → L2 (hook 実行基盤)"
  fi
fi

# mcp/<server>/package.json がある独立MCP serverの依存を確保
# (L2 node_modules は brainbase本体専用なので mcp/* 配下の axios 等は別途解決が必要)
if [ -d "./mcp" ]; then
  for mcp_pkg in ./mcp/*/package.json; do
    [ -f "$mcp_pkg" ] || continue
    mcp_dir=$(dirname "$mcp_pkg")
    if [ ! -d "$mcp_dir/node_modules" ]; then
      echo "  📦 $(basename $mcp_dir) MCP の依存をインストール中..."
      (cd "$mcp_dir" && npm install --silent --no-fund --no-audit --ignore-scripts 2>&1 \
        | tail -3 | sed 's/^/    /') || echo "    ⚠ $(basename $mcp_dir) install失敗"
    fi
  done
fi

echo "✅ SessionStart Hook 完了"
