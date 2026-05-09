#!/bin/bash

# Codex start wrapper: send a lightweight heartbeat before exec codex.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/brainbase-common.sh"

resolve_session_id

if [ -n "$BRAINBASE_SESSION_ID" ] && command -v curl >/dev/null 2>&1; then
  PORT="$(resolve_brainbase_port)"
  REPORTED_AT=$(($(date +%s) * 1000))
  post_brainbase_activity_json "$PORT" "{\"sessionId\": \"$BRAINBASE_SESSION_ID\", \"status\": \"working\", \"reportedAt\": $REPORTED_AT, \"lifecycle\": \"heartbeat\", \"eventType\": \"codex-wrapper-start\"}" >/dev/null 2>&1 || true &
fi

# Clean up codex temporary update directories (prevents ENOTEMPTY errors)
if [ -n "$NVM_DIR" ] && [ -d "$NVM_DIR/versions/node" ]; then
  for node_version in "$NVM_DIR/versions/node"/v*/lib/node_modules/@openai; do
    if [ -d "$node_version" ]; then
      rm -rf "$node_version"/.codex-* 2>/dev/null || true
    fi
  done
fi

# Drain any pending TTY input (e.g. xterm focus events ^[[O^[[I) that may have
# accumulated in the PTY buffer before codex initializes its input handler.
# Without this, focus events arrive as keyboard input and can cause immediate exit.
if [ -t 0 ]; then
  read -t 0.2 -n 10000 _DRAIN 2>/dev/null || true
fi

# Ensure crossterm (Rust terminal library used by codex) can read keyboard input.
# Without TERM, crossterm fails to query terminal capabilities and hangs on Enter.
# Without LANG/LC_ALL, UTF-8 input handling breaks in detached tmux sessions.
export TERM="${TERM:-xterm-256color}"
export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

# Disable crossterm keyboard enhancement probes in brainbase-managed terminals.
# ttyd/tmux do not reliably complete the full query/response sequence, which can
# leave Codex initialized but visually blank.
export CODEX_TUI_DISABLE_KEYBOARD_ENHANCEMENT="${CODEX_TUI_DISABLE_KEYBOARD_ENHANCEMENT:-1}"

resolve_codex_bin() {
    if [ -n "$BRAINBASE_CODEX_BIN" ] && [ -x "$BRAINBASE_CODEX_BIN" ]; then
        printf '%s\n' "$BRAINBASE_CODEX_BIN"
        return 0
    fi

    local target_triple package_name
    case "$(uname -s)-$(uname -m)" in
        Darwin-arm64)
            target_triple="aarch64-apple-darwin"
            package_name="@openai/codex-darwin-arm64"
            ;;
        Darwin-x86_64)
            target_triple="x86_64-apple-darwin"
            package_name="@openai/codex-darwin-x64"
            ;;
        Linux-x86_64)
            target_triple="x86_64-unknown-linux-musl"
            package_name="@openai/codex-linux-x64"
            ;;
        Linux-aarch64|Linux-arm64)
            target_triple="aarch64-unknown-linux-musl"
            package_name="@openai/codex-linux-arm64"
            ;;
    esac

    if [ -n "$target_triple" ]; then
        local global_root candidate
        for global_root in \
            "$HOME/.npm-global/lib/node_modules" \
            "$(npm root -g 2>/dev/null)" \
            "/usr/local/lib/node_modules" \
            "/opt/homebrew/lib/node_modules"; do
            [ -n "$global_root" ] || continue
            candidate="$global_root/@openai/codex/node_modules/$package_name/vendor/$target_triple/codex/codex"
            if [ -x "$candidate" ]; then
                printf '%s\n' "$candidate"
                return 0
            fi
        done

        for global_root in \
            "$HOME/.npm-global/lib/node_modules" \
            "$(npm root -g 2>/dev/null)" \
            "/usr/local/lib/node_modules" \
            "/opt/homebrew/lib/node_modules"; do
            [ -n "$global_root" ] || continue
            for candidate in \
                "$global_root/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex" \
                "$global_root/@openai/codex/node_modules/@openai/codex-darwin-x64/vendor/x86_64-apple-darwin/codex/codex" \
                "$global_root/@openai/codex/node_modules/@openai/codex-linux-arm64/vendor/aarch64-unknown-linux-musl/codex/codex" \
                "$global_root/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex/codex"; do
                if [ -x "$candidate" ]; then
                    printf '%s\n' "$candidate"
                    return 0
                fi
            done
        done
    fi

    if [ -x "/usr/local/bin/codex" ]; then
        printf '%s\n' "/usr/local/bin/codex"
        return 0
    fi

    printf '%s\n' "codex"
}

CODEX_BIN="$(resolve_codex_bin)"

# Use PTY shim to intercept crossterm's Kitty keyboard protocol query (ESC[?u).
# codex 0.121.0 blocks ALL threads in kevent() waiting for ESC[?0u response.
# xterm.js (ttyd) does not respond, causing indefinite "model: loading" hang.
# The shim creates a new PTY for codex, detects ESC[?u in the output, and
# immediately writes ESC[?0u back to codex's stdin to unblock crossterm.
SHIM_PY="$SCRIPT_DIR/codex-pty-shim.py"
PYTHON3_BIN="$(command -v python3 2>/dev/null)"

if [ -f "$SHIM_PY" ] && [ -n "$PYTHON3_BIN" ] && [ -t 0 ]; then
    exec "$PYTHON3_BIN" "$SHIM_PY" "$CODEX_BIN" "$@"
fi

exec "$CODEX_BIN" "$@"
