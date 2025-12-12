#!/bin/bash

# Default session name if none provided
SESSION_NAME=${1:-brainbase}
INITIAL_CMD=${2:-}
ENGINE=${3:-claude}  # claude or codex

# Check if session exists
if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    # Create new session
    tmux new-session -d -s "$SESSION_NAME"
    tmux set-environment -t "$SESSION_NAME" BRAINBASE_SESSION_ID "$SESSION_NAME"

    if [ "$ENGINE" = "codex" ]; then
        # Launch Codex (initial command not supported in same way)
        if [ -n "$INITIAL_CMD" ]; then
            tmux send-keys -t "$SESSION_NAME" "export BRAINBASE_SESSION_ID='$SESSION_NAME' && codex \"$INITIAL_CMD\"" C-m
        else
            tmux send-keys -t "$SESSION_NAME" "export BRAINBASE_SESSION_ID='$SESSION_NAME' && codex" C-m
        fi
    else
        # Launch Claude Code
        if [ -n "$INITIAL_CMD" ]; then
            tmux send-keys -t "$SESSION_NAME" "export BRAINBASE_SESSION_ID='$SESSION_NAME' && claude \"$INITIAL_CMD\"" C-m
        else
            tmux send-keys -t "$SESSION_NAME" "export BRAINBASE_SESSION_ID='$SESSION_NAME' && claude" C-m
        fi
    fi
fi

# Enable mouse mode (globally) to allow scrolling
# We do this after creation/check to ensure server is running
tmux set -g mouse on

# Attach to session
exec tmux attach-session -t "$SESSION_NAME"
