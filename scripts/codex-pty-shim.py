#!/usr/bin/env python3
r"""
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
import json
import os
import select
import signal
import struct
import subprocess
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

# Responses that may come from the outer terminal after Codex asks capability
# questions. If forwarded to Codex stdin, the leading ESC can be interpreted as
# "interrupt", leaving fragments such as "[0" or "]10;rgb..." in the prompt.
OUTER_TERMINAL_FIXED_RESPONSES = (
    KITTY_RESPONSE,
    b'\x1b[0u',
    b'\x1b[I',
    b'\x1b[O',
)
OUTER_TERMINAL_OSC_RESPONSE_PREFIXES = (
    b'\x1b]10;',
    b'\x1b]11;',
)

# Number of bytes from codex's startup output to scan for blocking queries.
# Queries come in the first few hundred bytes; 8 KB is more than enough.
SCAN_WINDOW = 8192

# Debug log (set to None to disable)
DEBUG_LOG = '/tmp/codex-pty-shim-debug.log'

SPINNER_CHARS = set('⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠁⠂⠄⡀⢀⠠⠐⠈⠉⠛⠿⣿')
REPORT_THROTTLE_SECONDS = 2.0
TYPEAHEAD_DELAY_SECONDS = 0.03
BRAINBASE_COMMAND_ALIASES = {
    'ohayo': '.claude/commands/ohayo.md',
    'oyasumi': '.claude/commands/oyasumi.md',
    'retro': '.claude/commands/retro.md',
}


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


def rewrite_brainbase_command_line(line):
    """Return a normal prompt for brainbase command aliases, or None."""
    try:
        text = line.decode('utf-8').strip()
    except UnicodeDecodeError:
        return None

    if not text.startswith('/'):
        return None

    parts = text[1:].split(maxsplit=1)
    if not parts:
        return None

    command = parts[0]
    command_path = BRAINBASE_COMMAND_ALIASES.get(command)
    if not command_path:
        return None

    args = parts[1] if len(parts) > 1 else ''
    return (
        f'Brainbase command `/{command}` was invoked. '
        f'Read `{command_path}` and execute it as the active user request. '
        f'Command arguments: {args or "(none)"}.'
    ).encode('utf-8')


def write_as_typeahead(fd, data, after_key=None):
    """Write generated input like typed keys so Codex submits it, not as paste."""
    for byte in data:
        os.write(fd, bytes([byte]))
        if after_key is None:
            time.sleep(TYPEAHEAD_DELAY_SECONDS)
        else:
            after_key(TYPEAHEAD_DELAY_SECONDS)
    os.write(fd, b'\r')
    if after_key is not None:
        after_key(TYPEAHEAD_DELAY_SECONDS)


class OuterInputSanitizer:
    """Drop terminal-generated responses before they reach Codex stdin."""

    def __init__(self):
        self._buffer = bytearray()

    def feed(self, data):
        if not data:
            return b''

        self._buffer.extend(data)
        out = bytearray()

        while self._buffer:
            if self._buffer[0] != 0x1B:
                out.append(self._buffer.pop(0))
                continue

            current = bytes(self._buffer)
            fixed_match = next(
                (seq for seq in OUTER_TERMINAL_FIXED_RESPONSES if current.startswith(seq)),
                None,
            )
            if fixed_match is not None:
                dbg('dropping outer terminal fixed response', fixed_match)
                del self._buffer[:len(fixed_match)]
                continue

            if any(seq.startswith(current) for seq in OUTER_TERMINAL_FIXED_RESPONSES):
                break

            osc_prefix = next(
                (prefix for prefix in OUTER_TERMINAL_OSC_RESPONSE_PREFIXES if current.startswith(prefix)),
                None,
            )
            if osc_prefix is not None:
                end_bel = current.find(b'\x07', len(osc_prefix))
                end_st = current.find(b'\x1b\\', len(osc_prefix))
                candidates = [idx + 1 for idx in (end_bel,) if idx >= 0]
                candidates.extend(idx + 2 for idx in (end_st,) if idx >= 0)
                if not candidates:
                    break
                end = min(candidates)
                dbg('dropping outer terminal OSC response', current[:min(end, 80)])
                del self._buffer[:end]
                continue

            if any(prefix.startswith(current) for prefix in OUTER_TERMINAL_OSC_RESPONSE_PREFIXES):
                break

            out.append(self._buffer.pop(0))

        return bytes(out)


def detect_codex_activity(data):
    """Return 'working', 'ready', or None from a chunk of Codex terminal output."""
    if not data:
        return None
    try:
        text = data.decode('utf-8', errors='ignore')
    except AttributeError:
        text = str(data)

    if '›' in text:
        return 'ready'
    if any(char in text for char in SPINNER_CHARS):
        return 'working'
    if 'Thinking' in text or 'thinking' in text:
        return 'working'
    return None


class ActivityReporter:
    """Best-effort activity bridge for Codex versions that do not call notify while working."""

    def __init__(self, env=None, clock=None):
        self.env = env or os.environ
        self.clock = clock or time.time
        self.session_id = self.env.get('BRAINBASE_SESSION_ID') or ''
        self.port = self.env.get('BRAINBASE_PORT') or '31013'
        self.turn_id = None
        self.active = False
        self.last_report_at = 0.0

    def enabled(self):
        return bool(self.session_id and self.port)

    def observe(self, activity):
        if not self.enabled() or not activity:
            return
        if activity == 'working':
            self._report_working()
        elif activity == 'ready':
            self._report_done()

    def _report_working(self):
        now = self.clock()
        if self.active and now - self.last_report_at < REPORT_THROTTLE_SECONDS:
            return
        lifecycle = 'heartbeat' if self.active else 'turn_started'
        event_type = 'codex/pty-shim-heartbeat' if self.active else 'codex/pty-shim-start'
        if not self.active or not self.turn_id:
            self.turn_id = f'codex-pty-turn-{int(now * 1000)}-{os.getpid()}'
        self._post({
            'sessionId': self.session_id,
            'status': 'working',
            'reportedAt': int(now * 1000),
            'lifecycle': lifecycle,
            'eventType': event_type,
            'turnId': self.turn_id,
            'activityKind': 'reasoning',
            'currentStep': '処理中',
        })
        self.active = True
        self.last_report_at = now

    def _report_done(self):
        if not self.active:
            return
        now = self.clock()
        self._post({
            'sessionId': self.session_id,
            'status': 'done',
            'reportedAt': int(now * 1000),
            'lifecycle': 'turn_completed',
            'eventType': 'codex/pty-shim-ready',
            'turnId': self.turn_id,
            'activityKind': 'task_completed',
            'currentStep': '入力待ち',
        })
        self.active = False
        self.turn_id = None
        self.last_report_at = now

    def _post(self, payload):
        args = self._build_post_args(payload)
        try:
            subprocess.Popen(
                args,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError as e:
            dbg('activity report failed', e)

    def _get_csrf_token(self):
        try:
            result = subprocess.run(
                [
                    'curl',
                    '-sS',
                    '--max-time',
                    '1',
                    '-H',
                    f'X-Session-Id: {self.session_id}',
                    f'http://localhost:{self.port}/api/csrf-token',
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                check=False,
            )
            if result.returncode != 0 or not result.stdout:
                return None
            data = json.loads(result.stdout)
            token = data.get('token') or data.get('csrfToken')
            return token if isinstance(token, str) and token else None
        except (OSError, ValueError, json.JSONDecodeError) as e:
            dbg('csrf token fetch failed', e)
            return None

    def _build_post_args(self, payload):
        args = [
            'curl',
            '-sS',
            '--max-time',
            '1',
            '-X',
            'POST',
            f'http://localhost:{self.port}/api/sessions/report_activity',
            '-H',
            'Content-Type: application/json',
            '-H',
            f'X-Session-Id: {self.session_id}',
        ]
        token = self._get_csrf_token()
        if token:
            args.extend(['-H', f'X-CSRF-Token: {token}'])
        args.extend(['-d', json.dumps(payload, ensure_ascii=False)])
        return args


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

    def restore_terminal():
        """Restore outer terminal to original settings."""
        if old_settings is not None:
            try:
                termios.tcsetattr(outer_stdin, termios.TCSANOW, old_settings)
            except termios.error:
                pass

    # Forward SIGWINCH to inner PTY and codex
    def on_sigwinch(signum, frame):
        r, c = get_winsize(outer_stdin)
        set_winsize(inner_master, r, c)
        try:
            os.kill(child_pid, signal.SIGWINCH)
        except ProcessLookupError:
            pass

    # Handle SIGTERM/SIGINT: restore terminal before exiting
    # Without this, if the shim is killed externally (e.g. by brainbase session
    # cleanup), the outer terminal stays in raw mode causing garbage input.
    def on_terminate(signum, frame):
        dbg(f'received signal {signum}, restoring terminal and exiting')
        restore_terminal()
        try:
            os.kill(child_pid, signum)
        except ProcessLookupError:
            pass
        try:
            os.close(inner_master)
        except OSError:
            pass
        os._exit(0)

    signal.signal(signal.SIGWINCH, on_sigwinch)
    signal.signal(signal.SIGTERM, on_terminate)
    signal.signal(signal.SIGINT, on_terminate)

    interceptor = QueryInterceptor(inner_master)
    outer_input_sanitizer = OuterInputSanitizer()
    activity_reporter = ActivityReporter()
    input_line = bytearray()

    def drain_inner_output(timeout_seconds):
        deadline = time.time() + timeout_seconds
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                return
            try:
                ready, _, _ = select.select([inner_master], [], [], min(remaining, 0.01))
            except (OSError, ValueError):
                return
            if inner_master not in ready:
                continue
            try:
                data = os.read(inner_master, 4096)
            except OSError:
                return
            dbg(f'inner→outer {len(data)}b', data[:80])
            interceptor.feed(data)
            activity_reporter.observe(detect_codex_activity(data))
            try:
                os.write(outer_stdout, data)
            except OSError:
                return

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
                    activity_reporter.observe(detect_codex_activity(data))
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
                    data = outer_input_sanitizer.feed(data)
                    if not data:
                        continue
                    for byte in data:
                        if byte in (10, 13):
                            rewritten = rewrite_brainbase_command_line(input_line)
                            input_line.clear()
                            try:
                                if rewritten is not None:
                                    dbg('rewriting brainbase command', rewritten)
                                    os.write(inner_master, b'\x15')
                                    write_as_typeahead(inner_master, rewritten, drain_inner_output)
                                else:
                                    os.write(inner_master, bytes([byte]))
                            except OSError as e:
                                dbg('ERROR writing inner_master', e)
                                return
                            continue

                        if byte in (3, 4, 21):  # Ctrl-C, Ctrl-D, Ctrl-U
                            input_line.clear()
                        elif byte in (8, 127):
                            if input_line:
                                input_line.pop()
                        elif 32 <= byte or byte == 9:
                            input_line.append(byte)

                        try:
                            os.write(inner_master, bytes([byte]))
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
        restore_terminal()
        try:
            os.close(inner_master)
        except OSError:
            pass


if __name__ == '__main__':
    main()
