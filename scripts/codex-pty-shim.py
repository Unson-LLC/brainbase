#!/usr/bin/env python3
"""
codex-pty-shim.py - PTY interceptor for crossterm terminal initialization.

Problem:
  codex 0.121.0 uses crossterm (Rust terminal library) which, at startup,
  queries terminal capabilities by sending several escape sequences and
  blocking ALL threads in kevent() waiting for responses:

  1. ESC[?u       - Kitty keyboard protocol query → needs ESC[?0u response
  2. ESC]10;?ESC\ - OSC 10 foreground color query  → needs color response
  3. ESC]11;?ESC\ - OSC 11 background color query   → needs color response

  xterm.js (used by ttyd in brainbase) and tmux do not respond to all of
  these, causing an indefinite hang at "model: loading".

Solution:
  This script acts as a PTY proxy between the outer terminal (tmux) and codex.
  It creates an inner PTY pair, runs codex connected to the inner PTY slave,
  and intercepts known blocking queries from codex's output, responding with
  synthetic answers so crossterm can proceed with initialization.

Usage (via codex-wrapper.sh):
  exec python3 /path/to/codex-pty-shim.py /usr/local/bin/codex [args...]
"""

import fcntl
import os
import select
import signal
import struct
import sys
import termios
import time
import tty

# ── Terminal query / response pairs ────────────────────────────────────────

# Kitty keyboard protocol (crossterm queries these to detect support)
KITTY_QUERY = b'\x1b[?u'
KITTY_RESPONSE = b'\x1b[?0u'        # flags=0 → no Kitty support

# OSC 10 = foreground color query; respond with white (dark terminal theme)
OSC_FG_QUERY = b'\x1b]10;?'
OSC_FG_RESPONSE = b'\x1b]10;rgb:e5e5/e5e5/e5e5\x1b\\'

# OSC 11 = background color query; respond with dark gray
OSC_BG_QUERY = b'\x1b]11;?'
OSC_BG_RESPONSE = b'\x1b]11;rgb:1a1a/1a1a/2e2e\x1b\\'

# Number of bytes from codex's startup output to scan for blocking queries.
# Queries come in the first few hundred bytes; 8 KB is more than enough.
SCAN_WINDOW = 8192

# Debug log (set to None to disable)
DEBUG_LOG = '/tmp/codex-pty-shim-debug.log'


# ── Helpers ────────────────────────────────────────────────────────────────

def dbg(msg, extra=None):
    if DEBUG_LOG is None:
        return
    ts = time.strftime('%H:%M:%S')
    line = f'[{ts}] {msg}'
    if extra is not None:
        line += f': {extra!r}'
    with open(DEBUG_LOG, 'a') as f:
        f.write(line + '\n')


def get_winsize(fd):
    try:
        buf = fcntl.ioctl(fd, termios.TIOCGWINSZ, b'\x00' * 8)
        rows, cols = struct.unpack('HH', buf[:4])
        return rows, cols
    except OSError:
        return 24, 80


def set_winsize(fd, rows, cols):
    try:
        buf = struct.pack('HHHH', rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, buf)
    except OSError:
        pass


# ── Intercept state machine ────────────────────────────────────────────────

class QueryInterceptor:
    """
    Scans the first SCAN_WINDOW bytes of codex's stdout for known blocking
    terminal queries and writes synthetic responses back to codex's stdin
    (via the inner PTY master).
    """

    def __init__(self, inner_master_fd):
        self._fd = inner_master_fd
        self._buf = b''
        self._done = False   # True once we've passed the scan window

        # Track which queries have been responded to
        self._responded = {
            'kitty': False,
            'osc10': False,
            'osc11': False,
        }

    def feed(self, data):
        """Call with each chunk read from inner_master."""
        if self._done:
            return

        self._buf += data

        self._check_and_respond('kitty', KITTY_QUERY, KITTY_RESPONSE)
        self._check_and_respond('osc10', OSC_FG_QUERY, OSC_FG_RESPONSE)
        self._check_and_respond('osc11', OSC_BG_QUERY, OSC_BG_RESPONSE)

        if len(self._buf) >= SCAN_WINDOW:
            dbg('scan window passed', len(self._buf))
            self._done = True
            self._buf = b''

    def _check_and_respond(self, key, query, response):
        if self._responded[key]:
            return
        if query in self._buf:
            dbg(f'{key} query detected, responding', response)
            try:
                os.write(self._fd, response)
            except OSError as e:
                dbg(f'ERROR responding to {key}', e)
            self._responded[key] = True

    def all_done(self):
        """True once all queries answered or scan window passed."""
        return self._done or all(self._responded.values())


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        sys.stderr.write('Usage: codex-pty-shim.py <codex_binary> [args...]\n')
        sys.exit(1)

    codex_cmd = sys.argv[1:]

    outer_stdin = sys.stdin.fileno()
    outer_stdout = sys.stdout.fileno()

    rows, cols = get_winsize(outer_stdin)

    # Create inner PTY for codex
    inner_master, inner_slave = os.openpty()
    set_winsize(inner_master, rows, cols)

    child_pid = os.fork()

    if child_pid == 0:
        # ── CHILD: exec codex ──────────────────────────────────────────────
        os.close(inner_master)
        os.setsid()
        fcntl.ioctl(inner_slave, termios.TIOCSCTTY, 0)
        os.dup2(inner_slave, 0)
        os.dup2(inner_slave, 1)
        os.dup2(inner_slave, 2)
        if inner_slave > 2:
            os.close(inner_slave)
        os.execvp(codex_cmd[0], codex_cmd)
        os._exit(1)

    # ── PARENT: proxy ──────────────────────────────────────────────────────
    os.close(inner_slave)

    # Switch outer terminal to raw mode
    try:
        old_settings = termios.tcgetattr(outer_stdin)
        tty.setraw(outer_stdin)
    except termios.error:
        old_settings = None

    # Forward SIGWINCH to inner PTY and codex
    def on_sigwinch(signum, frame):
        r, c = get_winsize(outer_stdin)
        set_winsize(inner_master, r, c)
        try:
            os.kill(child_pid, signal.SIGWINCH)
        except ProcessLookupError:
            pass

    signal.signal(signal.SIGWINCH, on_sigwinch)

    interceptor = QueryInterceptor(inner_master)
    dbg('shim started', {
        'inner_master': inner_master,
        'outer_stdin': outer_stdin,
        'child_pid': child_pid,
    })

    try:
        while True:
            try:
                rlist, _, _ = select.select(
                    [inner_master, outer_stdin], [], [], 1.0
                )
            except (OSError, ValueError):
                break

            for fd in rlist:
                if fd == inner_master:
                    try:
                        data = os.read(inner_master, 4096)
                    except OSError as e:
                        dbg('inner_master closed', e)
                        return
                    dbg(f'inner→outer {len(data)}b', data[:80])
                    interceptor.feed(data)
                    try:
                        os.write(outer_stdout, data)
                    except OSError as e:
                        dbg('ERROR writing outer_stdout', e)
                        return

                elif fd == outer_stdin:
                    try:
                        data = os.read(outer_stdin, 4096)
                    except OSError as e:
                        dbg('outer_stdin closed', e)
                        return
                    dbg(f'outer→inner {len(data)}b', data[:80])
                    try:
                        os.write(inner_master, data)
                    except OSError as e:
                        dbg('ERROR writing inner_master', e)
                        return

            try:
                wpid, _ = os.waitpid(child_pid, os.WNOHANG)
                if wpid != 0:
                    break
            except ChildProcessError:
                break

    finally:
        if old_settings is not None:
            try:
                termios.tcsetattr(outer_stdin, termios.TCSADRAIN, old_settings)
            except termios.error:
                pass
        try:
            os.close(inner_master)
        except OSError:
            pass


if __name__ == '__main__':
    main()
