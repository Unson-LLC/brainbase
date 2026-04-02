// @ts-check
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

/**
 * @typedef {import('child_process').ChildProcessWithoutNullStreams} TmuxChildProcess
 */

/**
 * Single-pass tmux escape decoder.
 *
 * tmux control mode escapes:
 *   \n → newline, \r → CR, \t → tab, \\ → literal backslash
 *   \NNN (3 octal digits) → raw byte; consecutive \NNN are collected
 *   and decoded as a single UTF-8 byte sequence.
 *
 * Key fix: \\ is decoded FIRST so that \\343 becomes literal "\343"
 * instead of being misinterpreted as octal byte 0xE3.
 * Incomplete octal sequences (\N or \NN at end of string) are preserved
 * as-is rather than producing invalid UTF-8.
 *
 * @param {string} [value]
 * @returns {string}
 */
function decodeTmuxEscapes(value = '') {
    if (!value) return '';

    let result = '';
    let i = 0;
    /** @type {number[]} */
    let pendingBytes = [];

    const flushBytes = () => {
        if (pendingBytes.length === 0) return;
        try {
            result += Buffer.from(pendingBytes).toString('utf-8');
        } catch {
            // Invalid UTF-8 sequence — emit replacement characters
            result += pendingBytes.map(() => '\uFFFD').join('');
        }
        pendingBytes = [];
    };

    while (i < value.length) {
        if (value[i] !== '\\') {
            flushBytes();
            result += value[i];
            i++;
            continue;
        }

        // We're at a backslash — peek ahead
        if (i + 1 >= value.length) {
            // Lone backslash at end
            flushBytes();
            result += '\\';
            i++;
            continue;
        }

        const next = value[i + 1];

        // Named escapes: \n \r \t
        if (next === 'n' || next === 'r' || next === 't') {
            flushBytes();
            result += next === 'n' ? '\n' : next === 'r' ? '\r' : '\t';
            i += 2;
            continue;
        }

        // Escaped backslash: \\ → literal \
        if (next === '\\') {
            flushBytes();
            result += '\\';
            i += 2;
            continue;
        }

        // Octal escape: \NNN (exactly 3 octal digits)
        if (next >= '0' && next <= '7') {
            // Check if we have 3 octal digits
            if (i + 3 < value.length &&
                value[i + 2] >= '0' && value[i + 2] <= '7' &&
                value[i + 3] >= '0' && value[i + 3] <= '7') {
                // Complete octal sequence — collect byte
                pendingBytes.push(
                    Number.parseInt(value.slice(i + 1, i + 4), 8)
                );
                i += 4;
                continue;
            }
            // Incomplete octal (\N or \NN at end of string) — preserve as-is
            flushBytes();
            // Emit however many chars remain
            result += value.slice(i);
            i = value.length;
            continue;
        }

        // Unknown escape — emit backslash + next char
        flushBytes();
        result += '\\';
        i++;
    }

    flushBytes();
    return result;
}

export class TmuxControlClient extends EventEmitter {
    /**
     * @param {{ sessionId: string, idleTimeoutMs?: number, spawnFn?: typeof spawn }} param0
     */
    constructor({ sessionId, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS, spawnFn = spawn }) {
        super();
        this.sessionId = sessionId;
        this.idleTimeoutMs = idleTimeoutMs;
        this.spawnFn = spawnFn;
        /** @type {TmuxChildProcess|null} */
        this.process = null;
        this.stdoutBuffer = '';
        /** Pending incomplete octal tail from a previous %output line */
        this._pendingOctal = '';
        /** @type {ReturnType<typeof setTimeout>|null} */
        this._idleTimer = null;
        this._closed = false;
    }

    start() {
        if (this.process || this._closed) return;

        const child = this.spawnFn('tmux', ['-C', 'attach-session', '-t', this.sessionId], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        this.process = child;
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk) => {
            this.touch();
            this._handleStdout(chunk);
        });

        child.stderr.on('data', (chunk) => {
            this.touch();
            this.emit('error', new Error(String(chunk || '').trim() || 'tmux control stderr'));
        });

        child.on('error', (error) => {
            this.emit('error', error);
        });

        child.on('exit', (code, signal) => {
            this.process = null;
            this._clearIdleTimer();
            this.emit('exit', { code, signal });
        });

        this.touch();
    }

    /** @returns {void} */
    touch() {
        if (this._closed) return;
        this._clearIdleTimer();
        this._idleTimer = setTimeout(() => {
            this.close();
        }, this.idleTimeoutMs);
    }

    /**
     * @param {number|string} cols
     * @param {number|string} rows
     * @returns {void}
     */
    resize(cols, rows) {
        const safeCols = Math.max(40, Math.min(300, Number(cols) || 0));
        const safeRows = Math.max(12, Math.min(120, Number(rows) || 0));
        if (!Number.isFinite(safeCols) || !Number.isFinite(safeRows)) return;
        this.sendCommand(`refresh-client -C ${safeCols}x${safeRows}`);
    }

    /**
     * @param {string} command
     * @returns {void}
     */
    sendCommand(command) {
        if (!command || !this.process?.stdin || this.process.stdin.destroyed) return;
        this.touch();
        this.process.stdin.write(`${command}\n`);
    }

    close() {
        if (this._closed) return;
        this._closed = true;
        this._clearIdleTimer();

        if (this.process?.stdin && !this.process.stdin.destroyed) {
            this.process.stdin.write('detach-client\n');
            this.process.stdin.end();
        }
        this.process?.kill();
        this.process = null;
    }

    /** @returns {void} */
    _clearIdleTimer() {
        if (!this._idleTimer) return;
        clearTimeout(this._idleTimer);
        this._idleTimer = null;
    }

    /**
     * @param {string} chunk
     * @returns {void}
     */
    _handleStdout(chunk) {
        this.stdoutBuffer += chunk;
        const lines = this.stdoutBuffer.split(/\r?\n/);
        this.stdoutBuffer = lines.pop() || '';

        for (const line of lines) {
            this._handleLine(line);
        }
    }

    /**
     * Check if a string ends with an incomplete octal escape.
     * Incomplete = backslash followed by 0-2 octal digits at the tail.
     * @param {string} s
     * @returns {string} The incomplete tail (empty string if complete)
     */
    _extractIncompleteOctal(s) {
        const match = s.match(/\\(?:[0-7]{0,2})$/);
        return match ? match[0] : '';
    }

    /**
     * @param {string} line
     * @returns {void}
     */
    _handleLine(line) {
        if (!line) return;

        if (line.startsWith('%output ')) {
            const firstSpace = line.indexOf(' ');
            const secondSpace = line.indexOf(' ', firstSpace + 1);
            if (secondSpace === -1) return;

            // Prepend any leftover octal bytes from a previous line
            const raw = this._pendingOctal + line.slice(secondSpace + 1);
            this._pendingOctal = '';

            // Check for incomplete octal at the end
            const incomplete = this._extractIncompleteOctal(raw);
            const payload = incomplete ? raw.slice(0, raw.length - incomplete.length) : raw;
            this._pendingOctal = incomplete;

            const decoded = decodeTmuxEscapes(payload);
            if (decoded) {
                this.emit('output', decoded);
            }
            return;
        }

        if (line.startsWith('%exit')) {
            this.emit('exit', { code: 0, signal: null });
            return;
        }

        if (line.startsWith('%error')) {
            this.emit('error', new Error(line));
        }
    }
}

export { DEFAULT_IDLE_TIMEOUT_MS };
