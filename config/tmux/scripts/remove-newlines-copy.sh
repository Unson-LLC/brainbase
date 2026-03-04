#!/bin/bash
# tmuxバッファの内容から改行を削除してクリップボードにコピー

# tmuxバッファから内容を取得
buffer=$(tmux save-buffer - 2>/dev/null)

if [ -z "$buffer" ]; then
    tmux display-message "No buffer content (select text first)"
    exit 1
fi

# 改行を削除してクリップボードにコピー
echo -n "$buffer" | tr -d '\n' | pbcopy
tmux display-message "Copied (newlines removed): ${buffer:0:30}..."
