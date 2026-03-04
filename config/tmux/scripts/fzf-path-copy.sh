#!/bin/bash
# 画面内のファイルパスだけを表示してfzfで選択、改行削除してコピー

# tmuxの画面内容を取得して、改行をスペースに変換
content=$(tmux capture-pane -p -J | tr '\n' ' ')

# ファイルパスパターンを抽出（すべて）
# - /で始まる、または~で始まる
paths=$(echo "$content" | grep -oE '(/[^ ]+|~[^ ]+)' | sort -u)

if [ -z "$paths" ]; then
    tmux display-message "No paths found"
    exit 1
fi

# fzfで選択
selected=$(echo "$paths" | fzf --height=40% --reverse --prompt="Select Path: ")

if [ -n "$selected" ]; then
    # クリップボードにコピー
    echo -n "$selected" | pbcopy
    tmux display-message "Path copied: ${selected:0:50}..."
else
    tmux display-message "Cancelled"
fi
