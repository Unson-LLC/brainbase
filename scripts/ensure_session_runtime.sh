#!/bin/bash

# Default session name if none provided
# Keep existing IDs (including legacy suffix付き形式) to preserve log/resume linkage.
RAW_SESSION_NAME="$1"
if [ -z "$RAW_SESSION_NAME" ]; then
    SESSION_NAME="session-$(date +%s%3N)"
elif [[ "$RAW_SESSION_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
    SESSION_NAME="$RAW_SESSION_NAME"
else
    SESSION_NAME="session-$(date +%s%3N)"
fi
INITIAL_CMD=${2:-}
ENGINE=${3:-claude}  # claude or codex
INITIAL_CMD_FILE=""

# Auto-fix CWD: read worktree path from state.json and cd to it
STATE_JSON_PATH=""
SCRIPT_DIR_EARLY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_JSON_PATH="$(dirname "$SCRIPT_DIR_EARLY")/var/state.json"
if [ -f "$STATE_JSON_PATH" ]; then
    if command -v jq >/dev/null 2>&1; then
        WORKTREE_PATH=$(jq -r --arg sid "$SESSION_NAME" '
            .sessions[] |
            select(.id == $sid) |
            (.worktree.path // .path) // empty
        ' "$STATE_JSON_PATH" 2>/dev/null)
    elif command -v python3 >/dev/null 2>&1; then
        WORKTREE_PATH=$(python3 -c "
import json, sys
try:
    with open('$STATE_JSON_PATH') as f:
        state = json.load(f)
    for s in state['sessions']:
        if s['id'] == '$SESSION_NAME':
            wt = s.get('worktree', {})
            p = wt.get('path', '') if isinstance(wt, dict) else ''
            if not p:
                p = s.get('path', '')
            print(p)
            break
except Exception:
    pass
" 2>/dev/null)
    fi
    if [ -n "$WORKTREE_PATH" ] && [ -d "$WORKTREE_PATH" ]; then
        cd "$WORKTREE_PATH"
    fi
fi

RESUME_SESSION_ID=""
RESUME_DIR="$HOME/.claude/brainbase-sessions"
RESUME_FILE="$RESUME_DIR/$SESSION_NAME.resume"
if [ -f "$RESUME_FILE" ]; then
    RESUME_SESSION_ID=$(cat "$RESUME_FILE" 2>/dev/null | tr -d '[:space:]')
fi

create_initial_cmd_file() {
    if [ -z "$INITIAL_CMD" ]; then
        return 0
    fi

    if command -v mktemp >/dev/null 2>&1; then
        INITIAL_CMD_FILE="$(mktemp "/tmp/brainbase-initial-${SESSION_NAME}-XXXXXX.txt" 2>/dev/null || mktemp -t "brainbase-initial-${SESSION_NAME}")"
    else
        INITIAL_CMD_FILE="/tmp/brainbase-initial-${SESSION_NAME}.txt"
    fi
    printf '%s' "$INITIAL_CMD" > "$INITIAL_CMD_FILE"
}

if [ -d /usr/bin ]; then
    export PATH="/usr/bin:$PATH"
fi
if [ -d /c/msys64/usr/bin ]; then
    export PATH="/c/msys64/usr/bin:$PATH"
fi

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

if [ -z "$NPM_BIN" ] && [ -n "$HOME" ]; then
    NPM_BIN_HOME="$HOME/AppData/Roaming/npm"
    if [ -d "$NPM_BIN_HOME" ]; then
        export PATH="$NPM_BIN_HOME:$PATH"
        NPM_BIN="$NPM_BIN_HOME"
    fi
fi

if ! command -v claude >/dev/null 2>&1; then
    for npm_path in /c/Users/*/AppData/Roaming/npm; do
        if [ -x "$npm_path/claude" ]; then
            export PATH="$npm_path:$PATH"
            NPM_BIN="$npm_path"
            break
        fi
    done
fi

if ! command -v node >/dev/null 2>&1; then
    if [ -n "$PROGRAMFILES" ] && command -v cygpath >/dev/null 2>&1; then
        NODE_BIN="$(cygpath -u "$PROGRAMFILES")/nodejs"
        if [ -d "$NODE_BIN" ]; then
            export PATH="$NODE_BIN:$PATH"
        fi
    fi
fi

CLAUDE_BIN=""
if command -v claude >/dev/null 2>&1; then
    CLAUDE_BIN="$(command -v claude)"
fi

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

if [ -z "$CLAUDE_BIN" ] || [ ! -x "$CLAUDE_BIN" ]; then
    for npm_path in /c/Users/*/AppData/Roaming/npm/claude; do
        if [ -x "$npm_path" ]; then
            CLAUDE_BIN="$npm_path"
            break
        fi
    done
fi

if [ -z "$CLAUDE_BIN" ]; then
    CLAUDE_BIN="claude"
fi

if command -v tmux >/dev/null 2>&1; then
    tmux set-environment -g PATH "$PATH" 2>/dev/null || true
fi

unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT npm_config_prefix NPM_CONFIG_PREFIX
if command -v tmux >/dev/null 2>&1; then
    tmux set-environment -g -u CLAUDECODE 2>/dev/null || true
    tmux set-environment -g -u CLAUDE_CODE_ENTRYPOINT 2>/dev/null || true
    tmux set-environment -g -u npm_config_prefix 2>/dev/null || true
    tmux set-environment -g -u NPM_CONFIG_PREFIX 2>/dev/null || true
fi

create_initial_cmd_file

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOTIFY_SCRIPT="$SCRIPT_DIR/codex-notify.sh"
CODEX_WRAPPER="$SCRIPT_DIR/codex-wrapper.sh"
CODEX_APP_REPL="$SCRIPT_DIR/codex-app-repl.mjs"
USE_CODEX_APP_SERVER="${BRAINBASE_CODEX_APP_SERVER:-1}"
CODEX_NOTIFY_ARG=""
if [ -x "$NOTIFY_SCRIPT" ]; then
    CODEX_NOTIFY_ARG="-c notify='[\"bash\",\"$NOTIFY_SCRIPT\"]'"
fi

sync_codex_prompts_link() {
    local codex_dir="$HOME/.codex"
    local prompts_link="$codex_dir/prompts"
    local project_prompts_dir="$PWD/.claude/commands"

    if [ ! -d "$project_prompts_dir" ]; then
        return 0
    fi

    mkdir -p "$codex_dir" 2>/dev/null || true

    if [ -L "$prompts_link" ] || [ -e "$prompts_link" ]; then
        rm -rf "$prompts_link" 2>/dev/null || true
    fi
    ln -s "$project_prompts_dir" "$prompts_link" 2>/dev/null || true
}

tmux set -g escape-time 0 2>/dev/null || true
tmux set -g default-terminal "tmux-256color" 2>/dev/null || true
tmux set -g allow-passthrough on 2>/dev/null || true
tmux set -g mouse off 2>/dev/null || true
tmux set -g history-limit 5000 2>/dev/null || true

if [ "$ENGINE" = "codex" ]; then
    sync_codex_prompts_link
fi

if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    tmux new-session -d -s "$SESSION_NAME"
    tmux set-environment -t "$SESSION_NAME" BRAINBASE_SESSION_ID "$SESSION_NAME"
    tmux set-environment -t "$SESSION_NAME" BRAINBASE_SERVER_PATH "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

    if [ "$ENGINE" = "codex" ]; then
        tmux set-environment -t "$SESSION_NAME" CODEX_SANDBOX_MODE "danger-full-access"
        tmux set-environment -t "$SESSION_NAME" CODEX_NETWORK_ACCESS "enabled"
        tmux set-environment -t "$SESSION_NAME" CODEX_APPROVAL_POLICY "never"
        tmux set-environment -t "$SESSION_NAME" LANG "${LANG:-en_US.UTF-8}"
        tmux set-environment -t "$SESSION_NAME" LC_ALL "${LC_ALL:-en_US.UTF-8}"
        tmux set-environment -t "$SESSION_NAME" LC_CTYPE "${LC_CTYPE:-en_US.UTF-8}"
        LOCALE_EXPORT="export LANG=${LANG:-en_US.UTF-8} LC_ALL=${LC_ALL:-en_US.UTF-8} LC_CTYPE=${LC_CTYPE:-en_US.UTF-8}"

        if [ "$USE_CODEX_APP_SERVER" = "1" ] && command -v node >/dev/null 2>&1 && [ -f "$CODEX_APP_REPL" ]; then
            if [ -n "$INITIAL_CMD" ]; then
                printf -v CODEX_CMD '%s && export BRAINBASE_SESSION_ID=%q CODEX_SANDBOX_MODE=danger-full-access CODEX_NETWORK_ACCESS=enabled CODEX_APPROVAL_POLICY=never && node "%s" --session-id %q --initial "$(cat %q; rm -f %q)"' \
                    "$LOCALE_EXPORT" \
                    "$SESSION_NAME" \
                    "$CODEX_APP_REPL" \
                    "$SESSION_NAME" \
                    "$INITIAL_CMD_FILE" \
                    "$INITIAL_CMD_FILE"
                tmux send-keys -t "$SESSION_NAME" "$CODEX_CMD" C-m
            else
                printf -v CODEX_CMD "%s && export BRAINBASE_SESSION_ID='%s' CODEX_SANDBOX_MODE=danger-full-access CODEX_NETWORK_ACCESS=enabled CODEX_APPROVAL_POLICY=never && node \"%s\" --session-id %q" \
                    "$LOCALE_EXPORT" \
                    "$SESSION_NAME" \
                    "$CODEX_APP_REPL" \
                    "$SESSION_NAME"
                tmux send-keys -t "$SESSION_NAME" "$CODEX_CMD" C-m
            fi
        else
            if [ -n "$INITIAL_CMD" ]; then
                printf -v CODEX_CMD '%s && export BRAINBASE_SESSION_ID=%q CODEX_SANDBOX_MODE=danger-full-access CODEX_NETWORK_ACCESS=enabled CODEX_APPROVAL_POLICY=never && "%s" %s "$(cat %q; rm -f %q)"' \
                    "$LOCALE_EXPORT" \
                    "$SESSION_NAME" \
                    "$CODEX_WRAPPER" \
                    "$CODEX_NOTIFY_ARG" \
                    "$INITIAL_CMD_FILE" \
                    "$INITIAL_CMD_FILE"
                tmux send-keys -t "$SESSION_NAME" "$CODEX_CMD" C-m
            else
                printf -v CODEX_CMD "%s && export BRAINBASE_SESSION_ID='%s' CODEX_SANDBOX_MODE=danger-full-access CODEX_NETWORK_ACCESS=enabled CODEX_APPROVAL_POLICY=never && \"%s\" %s" \
                    "$LOCALE_EXPORT" \
                    "$SESSION_NAME" \
                    "$CODEX_WRAPPER" \
                    "$CODEX_NOTIFY_ARG"
                tmux send-keys -t "$SESSION_NAME" "$CODEX_CMD" C-m
            fi
        fi
    else
        tmux set-environment -t "$SESSION_NAME" PATH "$PATH"
        tmux set-environment -t "$SESSION_NAME" LANG "${LANG:-en_US.UTF-8}"
        tmux set-environment -t "$SESSION_NAME" LC_ALL "${LC_ALL:-en_US.UTF-8}"
        tmux set-environment -t "$SESSION_NAME" LC_CTYPE "${LC_CTYPE:-en_US.UTF-8}"
        LOCALE_EXPORT="export LANG=${LANG:-en_US.UTF-8} LC_ALL=${LC_ALL:-en_US.UTF-8} LC_CTYPE=${LC_CTYPE:-en_US.UTF-8}"
        CLAUDE_RESUME_FLAG=""
        if [ -n "$RESUME_SESSION_ID" ]; then
            CLAUDE_RESUME_FLAG="--resume $RESUME_SESSION_ID"
        fi
        if [ -n "$INITIAL_CMD" ]; then
            printf -v CLAUDE_CMD '%s && export BRAINBASE_SESSION_ID=%q && "%s" --dangerously-skip-permissions --permission-mode auto %s "$(cat %q; rm -f %q)"' \
                "$LOCALE_EXPORT" \
                "$SESSION_NAME" \
                "$CLAUDE_BIN" \
                "$CLAUDE_RESUME_FLAG" \
                "$INITIAL_CMD_FILE" \
                "$INITIAL_CMD_FILE"
            tmux send-keys -t "$SESSION_NAME" "$CLAUDE_CMD" C-m
        else
            printf -v CLAUDE_CMD "%s && export BRAINBASE_SESSION_ID='%s' && \"%s\" --dangerously-skip-permissions --permission-mode auto %s" \
                "$LOCALE_EXPORT" \
                "$SESSION_NAME" \
                "$CLAUDE_BIN" \
                "$CLAUDE_RESUME_FLAG"
            tmux send-keys -t "$SESSION_NAME" "$CLAUDE_CMD" C-m
        fi
    fi
else
    echo "[ensure_session_runtime] Session already exists: $SESSION_NAME"
fi

tmux set-environment -t "$SESSION_NAME" BRAINBASE_SESSION_ID "$SESSION_NAME" 2>/dev/null || true

if [ -n "$BRAINBASE_PORT" ]; then
    tmux set-environment -t "$SESSION_NAME" BRAINBASE_PORT "$BRAINBASE_PORT"
fi

exit 0
