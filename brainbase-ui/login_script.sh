#!/bin/bash

# Default session name if none provided
SESSION_NAME=${1:-brainbase}
INITIAL_CMD=${2:-}

# Check if session exists
if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    # Create new session
    tmux new-session -d -s "$SESSION_NAME"
    tmux set-environment -t "$SESSION_NAME" BRAINBASE_SESSION_ID "$SESSION_NAME"
    
    if [ -n "$INITIAL_CMD" ]; then
        # Launch Claude with the initial command as an argument
        tmux send-keys -t "$SESSION_NAME" "export BRAINBASE_SESSION_ID='$SESSION_NAME' && claude \"$INITIAL_CMD\"" C-m
    else
        # Just launch Claude
        tmux send-keys -t "$SESSION_NAME" "export BRAINBASE_SESSION_ID='$SESSION_NAME' && claude" C-m
    fi
fi

# Enable mouse mode (globally) to allow scrolling
# We do this after creation/check to ensure server is running
tmux set -g mouse on

# Attach to session
exec tmux attach-session -t "$SESSION_NAME"
