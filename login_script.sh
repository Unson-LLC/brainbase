#!/bin/bash

# Default session name if none provided
SESSION_NAME=${1:-brainbase}
INITIAL_CMD=${2:-}
ENGINE=${3:-claude}  # claude or codex

# Apply tmux settings first (before session creation/attachment)
# These settings help prevent character duplication when typing fast over WebSocket (ttyd)
tmux set -g escape-time 0 2>/dev/null || true
tmux set -g default-terminal "screen-256color" 2>/dev/null || true
tmux set -g mouse on 2>/dev/null || true

# Check if session exists
if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    # Create new session
    tmux new-session -d -s "$SESSION_NAME"
    tmux set-environment -t "$SESSION_NAME" BRAINBASE_SESSION_ID "$SESSION_NAME"

    if [ "$ENGINE" = "codex" ]; then
        # Default Codex permissions: full filesystem + network, no approval prompts
        tmux set-environment -t "$SESSION_NAME" CODEX_SANDBOX_MODE "danger-full-access"
        tmux set-environment -t "$SESSION_NAME" CODEX_NETWORK_ACCESS "enabled"
        tmux set-environment -t "$SESSION_NAME" CODEX_APPROVAL_POLICY "never"

        # Launch Codex with initial command as CLI argument (passed as prompt)
        if [ -n "$INITIAL_CMD" ]; then
            tmux send-keys -t "$SESSION_NAME" "export BRAINBASE_SESSION_ID='$SESSION_NAME' CODEX_SANDBOX_MODE=danger-full-access CODEX_NETWORK_ACCESS=enabled CODEX_APPROVAL_POLICY=never && codex \"$INITIAL_CMD\"" C-m
        else
            tmux send-keys -t "$SESSION_NAME" "export BRAINBASE_SESSION_ID='$SESSION_NAME' CODEX_SANDBOX_MODE=danger-full-access CODEX_NETWORK_ACCESS=enabled CODEX_APPROVAL_POLICY=never && codex" C-m
        fi
    else
        # Launch Claude Code with initial command as CLI argument (passed as prompt)
        if [ -n "$INITIAL_CMD" ]; then
            tmux send-keys -t "$SESSION_NAME" "export BRAINBASE_SESSION_ID='$SESSION_NAME' && claude \"$INITIAL_CMD\"" C-m
        else
            tmux send-keys -t "$SESSION_NAME" "export BRAINBASE_SESSION_ID='$SESSION_NAME' && claude" C-m
        fi
    fi
fi

# Attach to session
exec tmux attach-session -t "$SESSION_NAME"
