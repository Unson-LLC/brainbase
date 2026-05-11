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

# Auto-fix CWD: read worktree path from state (SQLite preferred, JSON fallback)
STATE_JSON_PATH=""
SCRIPT_DIR_EARLY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "$BRAINBASE_STATE_PATH" ]; then
    STATE_JSON_PATH="$BRAINBASE_STATE_PATH"
elif [ -n "$BRAINBASE_VAR_DIR" ]; then
    STATE_JSON_PATH="$BRAINBASE_VAR_DIR/state.json"
else
    STATE_JSON_PATH="$(dirname "$SCRIPT_DIR_EARLY")/var/state.json"
fi

# Derive SQLite DB path from state.json path (sqlite-store.js convention)
STATE_DB_PATH="${STATE_JSON_PATH%.json}.db"

WORKTREE_PATH=""
if command -v python3 >/dev/null 2>&1; then
    WORKTREE_PATH=$(python3 -c "
import sys, json

sid = '$SESSION_NAME'

# SQLite first (python3 built-in sqlite3 module)
try:
    import sqlite3
    db_path = '$STATE_DB_PATH'
    conn = sqlite3.connect('file:' + db_path + '?mode=ro', uri=True)
    row = conn.execute('SELECT data FROM sessions WHERE id = ?', (sid,)).fetchone()
    conn.close()
    if row:
        data = json.loads(row[0])
        wt = data.get('worktree', {})
        p = wt.get('path', '') if isinstance(wt, dict) else ''
        if not p:
            p = data.get('path', '')
        if p:
            print(p)
            sys.exit(0)
except Exception:
    pass

# JSON fallback
try:
    with open('$STATE_JSON_PATH') as f:
        state = json.load(f)
    for s in state['sessions']:
        if s['id'] == sid:
            wt = s.get('worktree', {})
            p = wt.get('path', '') if isinstance(wt, dict) else ''
            if not p:
                p = s.get('path', '')
            if p:
                print(p)
            break
except Exception:
    pass
" 2>/dev/null)
fi
if [ -n "$WORKTREE_PATH" ] && [ -d "$WORKTREE_PATH" ]; then
    cd "$WORKTREE_PATH"
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
sync_claude_runtime

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NOTIFY_SCRIPT="$SCRIPT_DIR/codex-notify.sh"
CODEX_WRAPPER="$SCRIPT_DIR/codex-wrapper.sh"
CODEX_APP_REPL="$SCRIPT_DIR/codex-app-repl.mjs"
JJ_GUARD_DIR="$SCRIPT_DIR/bin"
REAL_JJ_BIN="$(command -v jj 2>/dev/null || true)"
# Default to Codex CLI; opt-in to app-server REPL via env var.
USE_CODEX_APP_SERVER="${BRAINBASE_CODEX_APP_SERVER:-0}"
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
    local prompts_link="$codex_dir/prompts"
    local commands_dir="$codex_dir/commands"
    local project_prompts_dir="$PWD/.claude/commands"

    if [ ! -d "$project_prompts_dir" ]; then
        return 0
    fi

    mkdir -p "$codex_dir" "$commands_dir" 2>/dev/null || true

    # Legacy Codex builds used ~/.codex/prompts. Keep the symlink for older
    # sessions, but current Codex reads ~/.codex/commands for slash commands.
    if [ -L "$prompts_link" ] || [ -e "$prompts_link" ]; then
        rm -rf "$prompts_link" 2>/dev/null || true
    fi
    ln -s "$project_prompts_dir" "$prompts_link" 2>/dev/null || true

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

tmux set -g escape-time 0 2>/dev/null || true
# Use xterm-256color as default terminal: tmux-256color causes codex TUI initialization
# to hang (crossterm waits for terminal capability responses that don't arrive).
tmux set -g default-terminal "xterm-256color" 2>/dev/null || true
tmux set -g allow-passthrough on 2>/dev/null || true
tmux set -g mouse off 2>/dev/null || true
tmux set -g history-limit 5000 2>/dev/null || true

if [ "$ENGINE" = "codex" ]; then
    sync_codex_project_commands
fi

if [ -d "$JJ_GUARD_DIR" ]; then
    export PATH="$JJ_GUARD_DIR:$PATH"
fi

if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    # worktreeパスが存在すればそこをデフォルトディレクトリにしてセッション作成
    if [ -n "$WORKTREE_PATH" ] && [ -d "$WORKTREE_PATH" ]; then
        tmux new-session -d -s "$SESSION_NAME" -c "$WORKTREE_PATH"
    else
        tmux new-session -d -s "$SESSION_NAME"
    fi
    tmux set-environment -t "$SESSION_NAME" BRAINBASE_SESSION_ID "$SESSION_NAME"
    tmux set-environment -t "$SESSION_NAME" BRAINBASE_SERVER_PATH "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    tmux set-environment -t "$SESSION_NAME" PATH "$PATH"
    if [ -n "$REAL_JJ_BIN" ]; then
        tmux set-environment -t "$SESSION_NAME" BRAINBASE_REAL_JJ_BIN "$REAL_JJ_BIN"
    fi

    if [ "$ENGINE" = "codex" ]; then
        tmux set-environment -t "$SESSION_NAME" CODEX_SANDBOX_MODE "danger-full-access"
        tmux set-environment -t "$SESSION_NAME" CODEX_NETWORK_ACCESS "enabled"
        tmux set-environment -t "$SESSION_NAME" CODEX_APPROVAL_POLICY "never"
        tmux set-environment -t "$SESSION_NAME" LANG "${LANG:-en_US.UTF-8}"
        tmux set-environment -t "$SESSION_NAME" LC_ALL "${LC_ALL:-en_US.UTF-8}"
        tmux set-environment -t "$SESSION_NAME" LC_CTYPE "${LC_CTYPE:-en_US.UTF-8}"
        # xterm-256color: codex TUI (crossterm) hangs on initialization with tmux-256color
        tmux set-environment -t "$SESSION_NAME" TERM "xterm-256color"
        # cwdが無効な場合（外付けドライブ再マウント等）に備え、絶対パスにcd。
        # cd . ではinodeが壊れている場合にcwdを修復できない。
        _CWD_TARGET="${WORKTREE_PATH:-/tmp}"
        LOCALE_EXPORT="cd '${_CWD_TARGET}' 2>/dev/null || cd /tmp; export LANG=${LANG:-en_US.UTF-8} LC_ALL=${LC_ALL:-en_US.UTF-8} LC_CTYPE=${LC_CTYPE:-en_US.UTF-8} TERM=xterm-256color"

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
                printf -v CODEX_CMD '%s && export BRAINBASE_SESSION_ID=%q CODEX_SANDBOX_MODE=danger-full-access CODEX_NETWORK_ACCESS=enabled CODEX_APPROVAL_POLICY=never && "%s" %s %s "$(cat %q; rm -f %q)"' \
                    "$LOCALE_EXPORT" \
                    "$SESSION_NAME" \
                    "$CODEX_WRAPPER" \
                    "$CODEX_HOOKS_ARG" \
                    "$CODEX_NOTIFY_ARG" \
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
        tmux set-environment -t "$SESSION_NAME" PATH "$PATH"
        tmux set-environment -t "$SESSION_NAME" LANG "${LANG:-en_US.UTF-8}"
        tmux set-environment -t "$SESSION_NAME" LC_ALL "${LC_ALL:-en_US.UTF-8}"
        tmux set-environment -t "$SESSION_NAME" LC_CTYPE "${LC_CTYPE:-en_US.UTF-8}"
        # xterm-256color: codex TUI (crossterm) hangs on initialization with tmux-256color
        tmux set-environment -t "$SESSION_NAME" TERM "xterm-256color"
        # cwdが無効な場合（外付けドライブ再マウント等）に備え、絶対パスにcd。
        # cd . ではinodeが壊れている場合にcwdを修復できない。
        _CWD_TARGET="${WORKTREE_PATH:-/tmp}"
        LOCALE_EXPORT="cd '${_CWD_TARGET}' 2>/dev/null || cd /tmp; export LANG=${LANG:-en_US.UTF-8} LC_ALL=${LC_ALL:-en_US.UTF-8} LC_CTYPE=${LC_CTYPE:-en_US.UTF-8} TERM=xterm-256color"
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
    # 既存セッションでもcwdが壊れている場合がある（外付けドライブ再マウント等）。
    # worktreeパスへのcdを送ってcwdを修復する。
    if [ -n "$WORKTREE_PATH" ] && [ -d "$WORKTREE_PATH" ]; then
        sync_claude_runtime
        tmux send-keys -t "$SESSION_NAME" "cd '$WORKTREE_PATH' 2>/dev/null" C-m
    fi
fi

tmux set-environment -t "$SESSION_NAME" BRAINBASE_SESSION_ID "$SESSION_NAME" 2>/dev/null || true
tmux set-environment -t "$SESSION_NAME" PATH "$PATH" 2>/dev/null || true
if [ -n "$REAL_JJ_BIN" ]; then
    tmux set-environment -t "$SESSION_NAME" BRAINBASE_REAL_JJ_BIN "$REAL_JJ_BIN" 2>/dev/null || true
fi

if [ -n "$BRAINBASE_PORT" ]; then
    tmux set-environment -t "$SESSION_NAME" BRAINBASE_PORT "$BRAINBASE_PORT"
fi

exit 0
