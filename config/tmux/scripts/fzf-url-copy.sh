#!/bin/bash
# 画面内のURL/ファイルパスを表示してfzfで選択、改行削除してコピー

# tmuxの画面内容を取得して、改行をスペースに変換
content=$(tmux capture-pane -p -J | tr '\n' ' ')

# URLパターンとファイルパスパターンを抽出（すべて）
# - URL: https?://...
# - ファイルパス: /で始まる、または~で始まる
items=$(echo "$content" | grep -oE '(https?://[^ ]+|/[^ ]+|~[^ ]+)' | sort -u)

if [ -z "$items" ]; then
    tmux display-message "No URLs or paths found"
    exit 1
fi

# fzfで選択
selected=$(echo "$items" | fzf --height=40% --reverse --prompt="Select URL/Path: ")

if [ -n "$selected" ]; then
    # クリップボードにコピー
    echo -n "$selected" | pbcopy
    tmux display-message "Copied: ${selected:0:50}..."
else
    tmux display-message "Cancelled"
fi
