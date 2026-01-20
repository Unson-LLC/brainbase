#!/bin/bash

# Default session name if none provided
SESSION_NAME=${1:-brainbase}
INITIAL_CMD=${2:-}
ENGINE=${3:-claude}  # claude or codex

# Windows/MSYS2 support: Ensure core tools are available
if [ -d /usr/bin ]; then
    export PATH="/usr/bin:$PATH"
fi
# Also check for MSYS64 installation
if [ -d /c/msys64/usr/bin ]; then
    export PATH="/c/msys64/usr/bin:$PATH"
fi

# Ensure Windows npm global binaries are reachable (claude/codex)
if [ -z "$APPDATA" ] && [ -n "$HOMEDRIVE" ] && [ -n "$HOMEPATH" ]; then
    APPDATA="${HOMEDRIVE}${HOMEPATH}\\AppData\\Roaming"
fi

APPDATA_POSIX=""
NPM_BIN=""
if [ -n "$APPDATA" ] && command -v cygpath >/dev/null 2>&1; then
    APPDATA_POSIX="$(cygpath -u "$APPDATA")"
    NPM_BIN="${APPDATA_POSIX}/npm"
    if [ -d "$NPM_BIN" ]; then
        export PATH="$NPM_BIN:$PATH"
    fi
fi

# MSYS2/ttyd fallback: Use HOME to find npm global path
if [ -z "$NPM_BIN" ] && [ -n "$HOME" ]; then
    NPM_BIN_HOME="$HOME/AppData/Roaming/npm"
    if [ -d "$NPM_BIN_HOME" ]; then
        export PATH="$NPM_BIN_HOME:$PATH"
        NPM_BIN="$NPM_BIN_HOME"
    fi
fi

# Last resort: scan /c/Users/*/AppData/Roaming/npm for claude
if ! command -v claude >/dev/null 2>&1; then
    for npm_path in /c/Users/*/AppData/Roaming/npm; do
        if [ -x "$npm_path/claude" ]; then
            export PATH="$npm_path:$PATH"
            NPM_BIN="$npm_path"
            break
        fi
    done
fi

# Ensure Node.js is reachable for npm-installed CLIs
if ! command -v node >/dev/null 2>&1; then
    if [ -n "$PROGRAMFILES" ] && command -v cygpath >/dev/null 2>&1; then
        NODE_BIN="$(cygpath -u "$PROGRAMFILES")/nodejs"
        if [ -d "$NODE_BIN" ]; then
            export PATH="$NODE_BIN:$PATH"
        fi
    fi
fi

# Resolve Claude CLI path - always get full path for tmux compatibility
CLAUDE_BIN=""

# If claude is in PATH, get its full path
if command -v claude >/dev/null 2>&1; then
    CLAUDE_BIN="$(command -v claude)"
fi

# Windows/MSYS2: Find claude in npm global paths if not found
if [ -z "$CLAUDE_BIN" ] || [ ! -x "$CLAUDE_BIN" ]; then
    for candidate in \
        "$NPM_BIN/claude" \
        "$APPDATA_POSIX/npm/claude" \
        "$HOME/AppData/Roaming/npm/claude" \
        "/c/Users/SalesTailor/AppData/Roaming/npm/claude"; do
        if [ -n "$candidate" ] && [ -x "$candidate" ]; then
            CLAUDE_BIN="$candidate"
            break
        fi
    done
fi

# Last resort: scan /c/Users/*/AppData/Roaming/npm
if [ -z "$CLAUDE_BIN" ] || [ ! -x "$CLAUDE_BIN" ]; then
    for npm_path in /c/Users/*/AppData/Roaming/npm/claude; do
        if [ -x "$npm_path" ]; then
            CLAUDE_BIN="$npm_path"
            break
        fi
    done
fi

# Fallback to just "claude" if nothing found
if [ -z "$CLAUDE_BIN" ]; then
    CLAUDE_BIN="claude"
fi

# Ensure tmux server inherits PATH for new sessions
if command -v tmux >/dev/null 2>&1; then
    tmux set-environment -g PATH "$PATH" 2>/dev/null || true
fi

# Resolve repo root (this script lives in scripts/ directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOTIFY_SCRIPT="$SCRIPT_DIR/codex-notify.sh"
CODEX_WRAPPER="$SCRIPT_DIR/codex-wrapper.sh"
CODEX_NOTIFY_ARG=""
if [ -x "$NOTIFY_SCRIPT" ]; then
    CODEX_NOTIFY_ARG="-c notify='[\"bash\",\"$NOTIFY_SCRIPT\"]'"
fi

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
            tmux send-keys -t "$SESSION_NAME" "export BRAINBASE_SESSION_ID='$SESSION_NAME' CODEX_SANDBOX_MODE=danger-full-access CODEX_NETWORK_ACCESS=enabled CODEX_APPROVAL_POLICY=never && \"$CODEX_WRAPPER\" $CODEX_NOTIFY_ARG \"$INITIAL_CMD\"" C-m
        else
            tmux send-keys -t "$SESSION_NAME" "export BRAINBASE_SESSION_ID='$SESSION_NAME' CODEX_SANDBOX_MODE=danger-full-access CODEX_NETWORK_ACCESS=enabled CODEX_APPROVAL_POLICY=never && \"$CODEX_WRAPPER\" $CODEX_NOTIFY_ARG" C-m
        fi
    else
        # Launch Claude Code with initial command as CLI argument (passed as prompt)
        # Set PATH via tmux environment instead of inline export (prevents command truncation)
        tmux set-environment -t "$SESSION_NAME" PATH "$PATH"
        if [ -n "$INITIAL_CMD" ]; then
            tmux send-keys -t "$SESSION_NAME" "\"$CLAUDE_BIN\" \"$INITIAL_CMD\"" C-m
        else
            tmux send-keys -t "$SESSION_NAME" "\"$CLAUDE_BIN\"" C-m
        fi
    fi
fi

# Ensure BRAINBASE_SESSION_ID is always set even when re-attaching to an existing session
tmux set-environment -t "$SESSION_NAME" BRAINBASE_SESSION_ID "$SESSION_NAME" 2>/dev/null || true

if [ -n "$BRAINBASE_PORT" ]; then
    tmux set-environment -t "$SESSION_NAME" BRAINBASE_PORT "$BRAINBASE_PORT"
fi

# Attach to session
exec tmux attach-session -t "$SESSION_NAME"
