#!/bin/bash
# UNSONメンバー向けtmux設定セットアップ

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMUX_CONFIG_DIR="$SCRIPT_DIR/../config/tmux"

echo "🔧 tmux設定セットアップ開始..."

# バックアップ
if [ -f ~/.tmux.conf ]; then
    echo "  既存の~/.tmux.confをバックアップ"
    mv ~/.tmux.conf ~/.tmux.conf.bak.$(date +%Y%m%d%H%M%S)
fi

if [ -d ~/.tmux ] && [ ! -L ~/.tmux ]; then
    echo "  既存の~/.tmux/をバックアップ"
    mv ~/.tmux ~/.tmux.bak.$(date +%Y%m%d%H%M%S)
fi

# シンボリックリンク作成
echo "  シンボリックリンク作成"
ln -sf "$TMUX_CONFIG_DIR/tmux.conf" ~/.tmux.conf
ln -sf "$TMUX_CONFIG_DIR/scripts" ~/.tmux

# fzfインストール確認
if ! command -v fzf &> /dev/null; then
    echo "  ⚠️  fzfがインストールされていません"
    echo "  インストール: brew install fzf"
else
    echo "  ✓ fzf確認完了"
fi

# tmux設定リロード（tmuxセッション内の場合）
if [ -n "$TMUX" ]; then
    echo "  tmux設定リロード"
    tmux source-file ~/.tmux.conf
fi

echo "✅ tmux設定セットアップ完了！"
echo ""
echo "使い方:"
echo "  prefix + u : URL/パス選択コピー（fzf）"
echo "  prefix + p : ファイルパス専用コピー（fzf）"
echo "  prefix + c : 汎用改行削除コピー"
