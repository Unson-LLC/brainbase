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

# Prefer /usr/local/bin/codex (native aarch64 binary on Apple Silicon) over
# nvm-installed codex which may only have the x86_64 binary (causing TUI hang
# in detached tmux sessions due to Rosetta 2 + terminal capability mismatch).
CODEX_BIN="codex"
if [ -x "/usr/local/bin/codex" ]; then
    CODEX_BIN="/usr/local/bin/codex"
fi

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
