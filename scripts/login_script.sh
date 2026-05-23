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
# This prevents Claude from starting in the wrong directory when ttyd's CWD is incorrect
STATE_JSON_PATH=""
SCRIPT_DIR_EARLY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "$BRAINBASE_STATE_PATH" ]; then
    STATE_JSON_PATH="$BRAINBASE_STATE_PATH"
elif [ -n "$BRAINBASE_VAR_DIR" ]; then
    STATE_JSON_PATH="$BRAINBASE_VAR_DIR/state.json"
else
    STATE_JSON_PATH="$(dirname "$SCRIPT_DIR_EARLY")/var/state.json"
fi
if [ -f "$STATE_JSON_PATH" ]; then
    # 優先: jq（高速、0.3-0.5秒短縮）
    if command -v jq >/dev/null 2>&1; then
        WORKTREE_PATH=$(jq -r --arg sid "$SESSION_NAME" '
            .sessions[] |
            select(.id == $sid) |
            (.worktree.path // .path) // empty
        ' "$STATE_JSON_PATH" 2>/dev/null)
    # フォールバック: Python3（互換性）
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
if [ -z "$WORKTREE_PATH" ] && [ -n "$BRAINBASE_RUNTIME_CWD" ]; then
    WORKTREE_PATH="$BRAINBASE_RUNTIME_CWD"
fi
if [ -z "$WORKTREE_PATH" ] && command -v tmux >/dev/null 2>&1 && tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    EXISTING_TMUX_CWD="$(tmux display-message -p -t "$SESSION_NAME" '#{pane_current_path}' 2>/dev/null || true)"
    if [ -n "$EXISTING_TMUX_CWD" ] && [ -d "$EXISTING_TMUX_CWD" ]; then
        WORKTREE_PATH="$EXISTING_TMUX_CWD"
    fi
fi
if [ -z "$WORKTREE_PATH" ]; then
    echo "[login_script] Refusing to start $SESSION_NAME: session state missing worktree.path/path and no BRAINBASE_RUNTIME_CWD was provided" >&2
    exit 74
fi
if [ ! -d "$WORKTREE_PATH" ]; then
    echo "[login_script] Refusing to start $SESSION_NAME: workspace path does not exist: $WORKTREE_PATH" >&2
    exit 74
fi
if ! cd "$WORKTREE_PATH"; then
    echo "[login_script] Refusing to start $SESSION_NAME: failed to cd to workspace path: $WORKTREE_PATH" >&2
    exit 74
fi

# Auto-resume: check for saved Claude session ID
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

    # Write the initial command to a temp file to avoid tmux send-keys truncation
    if command -v mktemp >/dev/null 2>&1; then
        INITIAL_CMD_FILE="$(mktemp "/tmp/brainbase-initial-${SESSION_NAME}-XXXXXX.txt" 2>/dev/null || mktemp -t "brainbase-initial-${SESSION_NAME}")"
    else
        INITIAL_CMD_FILE="/tmp/brainbase-initial-${SESSION_NAME}.txt"
    fi
    printf '%s' "$(expand_brainbase_command_prompt "$INITIAL_CMD")" > "$INITIAL_CMD_FILE"
}

expand_brainbase_command_prompt() {
    local raw="$1"

    if [[ "$raw" =~ ^/([A-Za-z][A-Za-z0-9_-]*)([[:space:]]+(.*))?$ ]]; then
        local command_name="${BASH_REMATCH[1]}"
        local command_args="${BASH_REMATCH[3]}"
        local command_path=".claude/commands/${command_name}.md"

        if [ -f "$command_path" ]; then
            if [ -z "$command_args" ]; then
                command_args="(none)"
            fi
            printf 'Brainbase command /%s was invoked. Read %s and execute it as the active user request. Command arguments: %s.' \
                "$command_name" \
                "$command_path" \
                "$command_args"
            return 0
        fi
    fi

    printf '%s' "$raw"
}

sync_claude_runtime() {
    local repo_root
    repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    local sync_script="$repo_root/.claude/hooks/session-start-copy-plugins.sh"

    if [ -z "$WORKTREE_PATH" ] || [ ! -d "$WORKTREE_PATH" ] || [ ! -x "$sync_script" ]; then
        return 0
    fi

    (
        cd "$WORKTREE_PATH" && "$sync_script"
    ) >/dev/null 2>&1 || true
}

escape_initial_cmd() {
    local input="$1"
    if command -v python3 >/dev/null 2>&1; then
        python3 - "$input" <<'PY'
import sys
s = sys.argv[1]
out = []
for b in s.encode('utf-8'):
    if b == 10:
        out.append('\\n')
    elif b == 13:
        out.append('\\r')
    elif b == 9:
        out.append('\\t')
    elif b == 39:
        out.append("\\'")
    elif b == 92:
        out.append('\\\\')
    elif 32 <= b <= 126:
        out.append(chr(b))
    else:
        out.append(f'\\x{b:02x}')
print("$'" + ''.join(out) + "'")
PY
    else
        printf %q "$input"
    fi
}

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

# Environment sanitization (CommandMate pattern):
# 1. CLAUDECODE/CLAUDE_CODE_ENTRYPOINT: Prevents Claude Code from detecting nested session
# 2. npm_config_prefix: nvm compatibility
unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT npm_config_prefix NPM_CONFIG_PREFIX
if command -v tmux >/dev/null 2>&1; then
    tmux set-environment -g -u CLAUDECODE 2>/dev/null || true
    tmux set-environment -g -u CLAUDE_CODE_ENTRYPOINT 2>/dev/null || true
    tmux set-environment -g -u npm_config_prefix 2>/dev/null || true
    tmux set-environment -g -u NPM_CONFIG_PREFIX 2>/dev/null || true
fi

# Prepare initial command file (if provided)
create_initial_cmd_file
sync_claude_runtime

# Resolve repo root (this script lives in scripts/ directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NOTIFY_SCRIPT="$SCRIPT_DIR/codex-notify.sh"
CODEX_WRAPPER="$SCRIPT_DIR/codex-wrapper.sh"
CODEX_APP_REPL="$SCRIPT_DIR/codex-app-repl.mjs"
JJ_GUARD_DIR="$SCRIPT_DIR/bin"
source "$SCRIPT_DIR/lib/brainbase-common.sh"
REAL_JJ_BIN="$(command -v jj 2>/dev/null || true)"
# Default to Codex CLI; opt-in to app-server REPL via env var.
USE_CODEX_APP_SERVER="${BRAINBASE_CODEX_APP_SERVER:-0}"
CODEX_RESUME_ID="${BRAINBASE_CODEX_RESUME_ID:-}"
CODEX_NOTIFY_ARG=""
CODEX_HOOKS_ARG=""
if [ -x "$NOTIFY_SCRIPT" ]; then
    CODEX_NOTIFY_ARG="-c notify='[\"bash\",\"$NOTIFY_SCRIPT\"]'"
fi
if [ -f "$REPO_ROOT/.codex/hooks.json" ]; then
    CODEX_HOOKS_ARG="-c features.hooks=true"
fi

sync_codex_project_commands() {
    local codex_dir="$HOME/.codex"
    local prompts_dir="$codex_dir/prompts"
    local commands_dir="$codex_dir/commands"
    local project_prompts_dir="$PWD/.claude/commands"

    if [ ! -d "$project_prompts_dir" ]; then
        return 0
    fi

    mkdir -p "$codex_dir" "$commands_dir" 2>/dev/null || true

    # Legacy Codex builds used ~/.codex/prompts; current Codex reads
    # ~/.codex/commands for slash commands. Materialize both so runtimes that
    # do not discover symlinked prompts still see the project commands.
    if [ -L "$prompts_dir" ] || [ -f "$prompts_dir" ]; then
        rm -f "$prompts_dir" 2>/dev/null || true
    fi
    mkdir -p "$prompts_dir" 2>/dev/null || true
    find "$prompts_dir" -maxdepth 1 -type f -name '*.md' -delete 2>/dev/null || true
    find "$project_prompts_dir" -maxdepth 1 -type f -name '*.md' -exec cp {} "$prompts_dir/" \; 2>/dev/null || true

    local command_file
    for command_file in "$project_prompts_dir"/*.md; do
        [ -f "$command_file" ] || continue
        local command_name
        command_name="$(basename "$command_file" .md)"
        cat > "$commands_dir/${command_name}.md" <<EOF
Brainbase command /${command_name} was invoked. Read .claude/commands/${command_name}.md and execute it as the active user request. Command arguments: \$ARGUMENTS.

If \$ARGUMENTS is empty or not replaced by the runtime, treat the command arguments as (none).
EOF
    done
}

paths_match() {
    python3 - "$1" "$2" <<'PY' 2>/dev/null
import os
import sys

left = os.path.realpath(sys.argv[1])
right = os.path.realpath(sys.argv[2])
sys.exit(0 if left == right else 1)
PY
}

# Apply tmux settings first (before session creation/attachment)
# These settings help prevent character duplication when typing fast over WebSocket (ttyd)
tmux set -g escape-time 0 2>/dev/null || true
tmux set -g default-terminal "xterm-256color" 2>/dev/null || true
tmux set -g mouse off 2>/dev/null || true
tmux set -g history-limit 5000 2>/dev/null || true

if [ "$ENGINE" = "codex" ]; then
    ensure_codex_workspace_trusted "$WORKTREE_PATH"
    sync_codex_project_commands
else
    ensure_claude_workspace_trusted "$WORKTREE_PATH"
fi

if [ -d "$JJ_GUARD_DIR" ]; then
    export PATH="$JJ_GUARD_DIR:$PATH"
fi

# Check if session exists
if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    # Create new session
    tmux new-session -d -s "$SESSION_NAME" -c "$WORKTREE_PATH"
    PANE_CWD="$(tmux display-message -p -t "$SESSION_NAME" '#{pane_current_path}' 2>/dev/null || true)"
    if [ -z "$PANE_CWD" ] || ! paths_match "$PANE_CWD" "$WORKTREE_PATH"; then
        tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
        echo "[login_script] Refusing to start $SESSION_NAME: tmux cwd preflight failed (expected $WORKTREE_PATH, got ${PANE_CWD:-unknown})" >&2
        exit 75
    fi
    tmux set-environment -t "$SESSION_NAME" BRAINBASE_SESSION_ID "$SESSION_NAME"
    tmux set-environment -t "$SESSION_NAME" BRAINBASE_SERVER_PATH "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    tmux set-environment -t "$SESSION_NAME" PATH "$PATH"
    if [ -n "$REAL_JJ_BIN" ]; then
        tmux set-environment -t "$SESSION_NAME" BRAINBASE_REAL_JJ_BIN "$REAL_JJ_BIN"
    fi

    if [ "$ENGINE" = "codex" ]; then
        # Default Codex permissions: full filesystem + network, no approval prompts
        tmux set-environment -t "$SESSION_NAME" CODEX_SANDBOX_MODE "danger-full-access"
        tmux set-environment -t "$SESSION_NAME" CODEX_NETWORK_ACCESS "enabled"
        tmux set-environment -t "$SESSION_NAME" CODEX_APPROVAL_POLICY "never"
        # Ensure UTF-8 locale inside tmux session (fix mojibake)
        tmux set-environment -t "$SESSION_NAME" LANG "${LANG:-en_US.UTF-8}"
        tmux set-environment -t "$SESSION_NAME" LC_ALL "${LC_ALL:-en_US.UTF-8}"
        tmux set-environment -t "$SESSION_NAME" LC_CTYPE "${LC_CTYPE:-en_US.UTF-8}"
        LOCALE_EXPORT="cd '${WORKTREE_PATH}' 2>/dev/null || exit 74; export LANG=${LANG:-en_US.UTF-8} LC_ALL=${LC_ALL:-en_US.UTF-8} LC_CTYPE=${LC_CTYPE:-en_US.UTF-8}"

        if [ "$USE_CODEX_APP_SERVER" = "1" ] && command -v node >/dev/null 2>&1 && [ -f "$CODEX_APP_REPL" ]; then
            # Launch Codex app-server REPL (accurate turn lifecycle)
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
            # Launch Codex CLI with notify hook (fallback)
            if [ -n "$CODEX_RESUME_ID" ] && [ -n "$INITIAL_CMD" ]; then
                printf -v CODEX_CMD '%s && export BRAINBASE_SESSION_ID=%q CODEX_SANDBOX_MODE=danger-full-access CODEX_NETWORK_ACCESS=enabled CODEX_APPROVAL_POLICY=never && "%s" resume -C %q %s %s %q "$(cat %q; rm -f %q)"' \
                    "$LOCALE_EXPORT" \
                    "$SESSION_NAME" \
                    "$CODEX_WRAPPER" \
                    "$WORKTREE_PATH" \
                    "$CODEX_HOOKS_ARG" \
                    "$CODEX_NOTIFY_ARG" \
                    "$CODEX_RESUME_ID" \
                    "$INITIAL_CMD_FILE" \
                    "$INITIAL_CMD_FILE"
                tmux send-keys -t "$SESSION_NAME" "$CODEX_CMD" C-m
            elif [ -n "$CODEX_RESUME_ID" ]; then
                printf -v CODEX_CMD '%s && export BRAINBASE_SESSION_ID=%q CODEX_SANDBOX_MODE=danger-full-access CODEX_NETWORK_ACCESS=enabled CODEX_APPROVAL_POLICY=never && "%s" resume -C %q %s %s %q' \
                    "$LOCALE_EXPORT" \
                    "$SESSION_NAME" \
                    "$CODEX_WRAPPER" \
                    "$WORKTREE_PATH" \
                    "$CODEX_HOOKS_ARG" \
                    "$CODEX_NOTIFY_ARG" \
                    "$CODEX_RESUME_ID"
                tmux send-keys -t "$SESSION_NAME" "$CODEX_CMD" C-m
            elif [ -n "$INITIAL_CMD" ]; then
                printf -v CODEX_CMD '%s && export BRAINBASE_SESSION_ID=%q CODEX_SANDBOX_MODE=danger-full-access CODEX_NETWORK_ACCESS=enabled CODEX_APPROVAL_POLICY=never && "%s" %s "$(cat %q; rm -f %q)"' \
                    "$LOCALE_EXPORT" \
                    "$SESSION_NAME" \
                    "$CODEX_WRAPPER" \
                    "$CODEX_HOOKS_ARG $CODEX_NOTIFY_ARG" \
                    "$INITIAL_CMD_FILE" \
                    "$INITIAL_CMD_FILE"
                tmux send-keys -t "$SESSION_NAME" "$CODEX_CMD" C-m
            else
                printf -v CODEX_CMD "%s && export BRAINBASE_SESSION_ID='%s' CODEX_SANDBOX_MODE=danger-full-access CODEX_NETWORK_ACCESS=enabled CODEX_APPROVAL_POLICY=never && \"%s\" %s %s" \
                    "$LOCALE_EXPORT" \
                    "$SESSION_NAME" \
                    "$CODEX_WRAPPER" \
                    "$CODEX_HOOKS_ARG" \
                    "$CODEX_NOTIFY_ARG"
                tmux send-keys -t "$SESSION_NAME" "$CODEX_CMD" C-m
            fi
        fi
    else
        # Launch Claude Code with initial command as CLI argument (passed as prompt)
        # Set PATH via tmux environment instead of inline export (prevents command truncation)
        # --dangerously-skip-permissions: skip permission prompts for trusted brainbase environment
        tmux set-environment -t "$SESSION_NAME" PATH "$PATH"
        # Ensure UTF-8 locale inside tmux session (fix mojibake)
        tmux set-environment -t "$SESSION_NAME" LANG "${LANG:-en_US.UTF-8}"
        tmux set-environment -t "$SESSION_NAME" LC_ALL "${LC_ALL:-en_US.UTF-8}"
        tmux set-environment -t "$SESSION_NAME" LC_CTYPE "${LC_CTYPE:-en_US.UTF-8}"
        LOCALE_EXPORT="cd '${WORKTREE_PATH}' 2>/dev/null || exit 74; export LANG=${LANG:-en_US.UTF-8} LC_ALL=${LC_ALL:-en_US.UTF-8} LC_CTYPE=${LC_CTYPE:-en_US.UTF-8}"
        # Build resume flag if session ID is available
        CLAUDE_RESUME_FLAG=""
        if [ -n "$RESUME_SESSION_ID" ]; then
            CLAUDE_RESUME_FLAG="--resume $RESUME_SESSION_ID"
        fi
        if [ -n "$INITIAL_CMD" ]; then
            printf -v CLAUDE_CMD '%s && export BRAINBASE_SESSION_ID=%q && "%s" --dangerously-skip-permissions %s "$(cat %q; rm -f %q)"' \
                "$LOCALE_EXPORT" \
                "$SESSION_NAME" \
                "$CLAUDE_BIN" \
                "$CLAUDE_RESUME_FLAG" \
                "$INITIAL_CMD_FILE" \
                "$INITIAL_CMD_FILE"
            tmux send-keys -t "$SESSION_NAME" "$CLAUDE_CMD" C-m
        else
            printf -v CLAUDE_CMD "%s && export BRAINBASE_SESSION_ID='%s' && \"%s\" --dangerously-skip-permissions %s" \
                "$LOCALE_EXPORT" \
                "$SESSION_NAME" \
                "$CLAUDE_BIN" \
                "$CLAUDE_RESUME_FLAG"
            tmux send-keys -t "$SESSION_NAME" "$CLAUDE_CMD" C-m
        fi
    fi
else
    # Existing session found - log process state for debugging
    echo "[login_script] Re-attaching to existing session: $SESSION_NAME"
    EXISTING_PIDS=$(tmux list-panes -s -t "$SESSION_NAME" -F "#{pane_pid}" 2>/dev/null || echo "")
    if [ -n "$EXISTING_PIDS" ]; then
        echo "[login_script] Existing pane PIDs: $EXISTING_PIDS"
        for PID in $EXISTING_PIDS; do
            CHILD_COUNT=$(pgrep -P "$PID" 2>/dev/null | wc -l)
            echo "[login_script] PID $PID has $CHILD_COUNT child process(es)"
        done
    fi
fi

# Ensure BRAINBASE_SESSION_ID is always set even when re-attaching to an existing session
tmux set-environment -t "$SESSION_NAME" BRAINBASE_SESSION_ID "$SESSION_NAME" 2>/dev/null || true
tmux set-environment -t "$SESSION_NAME" PATH "$PATH" 2>/dev/null || true
if [ -n "$REAL_JJ_BIN" ]; then
    tmux set-environment -t "$SESSION_NAME" BRAINBASE_REAL_JJ_BIN "$REAL_JJ_BIN" 2>/dev/null || true
fi

if [ -n "$BRAINBASE_PORT" ]; then
    tmux set-environment -t "$SESSION_NAME" BRAINBASE_PORT "$BRAINBASE_PORT"
fi

# Attach to session
exec tmux attach-session -t "$SESSION_NAME"
