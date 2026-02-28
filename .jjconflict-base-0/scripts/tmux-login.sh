#!/bin/bash

# Default session name if no argument is provided
SESSION_NAME=${1:-brainbase}

# Ensure tmux is installed
if ! command -v tmux &> /dev/null; then
    echo "Error: tmux is not installed."
    exit 1
fi

# Try to attach to an existing session, or create a new one
# -A: Behaves like attach-session if session exists, otherwise like new-session
# -s: Session name
tmux new-session -A -s "$SESSION_NAME"
