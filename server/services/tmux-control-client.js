// @ts-check
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const CONTROL_KEY_ALLOWLIST = new Set([
    'Enter',
    'Tab',
    'BTab',
    'Escape',
    'BSpace',
    'Delete',
    'Up',
    'Down',
    'Left',
    'Right',
    'Home',
    'End',
    'PageUp',
    'PageDown',
    'C-c',
    'C-d',
    'C-l',
    'C-u',
    'M-Enter'
]);
const CONTROL_TEXT_PATTERN = /[\x00-\x1f\x7f]/;

/**
 * @typedef {import('child_process').ChildProcessWithoutNullStreams} TmuxChildProcess
 */

/**
 * Find the byte offset where valid (complete) UTF-8 ends in a byte array.
 * Trailing bytes that form an incomplete multi-byte sequence are excluded.
 * @param {number[]} bytes
 * @returns {number} The number of bytes that form complete UTF-8 characters
 */
function findCompleteUtf8Length(bytes) {
    const len = bytes.length;
    if (len === 0) return 0;

    // Walk backwards from the end (at most 3 bytes back — max leading byte lookback for 4-byte UTF-8)
    for (let i = Math.max(0, len - 3); i < len; i++) {
        const b = bytes[i];
        // ASCII (0xxxxxxx) or continuation byte (10xxxxxx) — not a leading byte
        if ((b & 0x80) === 0) continue;       // ASCII — complete
        if ((b & 0xC0) === 0x80) continue;    // continuation byte — skip

        // Leading byte — how many bytes does this character need?
        let needed;
        if ((b & 0xE0) === 0xC0) needed = 2;       // 110xxxxx
        else if ((b & 0xF0) === 0xE0) needed = 3;  // 1110xxxx
        else if ((b & 0xF8) === 0xF0) needed = 4;  // 11110xxx
        else continue; // invalid leading byte, let Buffer handle it

        const available = len - i;
        if (available < needed) {
            // Incomplete multi-byte sequence — split here
            return i;
        }
        // Complete — this character fits
    }
    return len;
}

/**
 * Find the start offset of a trailing incomplete UTF-8 sequence in a Buffer.
 * Returns buf.length if the buffer ends with complete UTF-8.
 * @param {Buffer} buf
 * @returns {number}
 */
function _findTrailingIncompleteUtf8(buf) {
    const len = buf.length;
    if (len === 0) return 0;
    // Check the last 1–3 bytes for a leading byte whose sequence is incomplete
    for (let i = Math.max(0, len - 3); i < len; i++) {
        const b = buf[i];
        if ((b & 0x80) === 0) continue;       // ASCII
        if ((b & 0xC0) === 0x80) continue;    // continuation byte
        let needed;
        if ((b & 0xE0) === 0xC0) needed = 2;
        else if ((b & 0xF0) === 0xE0) needed = 3;
        else if ((b & 0xF8) === 0xF0) needed = 4;
        else continue;
        if (len - i < needed) return i; // incomplete
    }
    return len; // all complete
}

function quoteTmuxCommandArg(value = '') {
    return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

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
 * When carryoverBytes is provided, those bytes are prepended to the first
 * octal byte run. Any trailing incomplete UTF-8 bytes are returned in
 * remainingBytes so the caller can carry them to the next chunk.
 *
 * @param {string} [value]
 * @param {number[]} [carryoverBytes] - incomplete UTF-8 bytes from previous call
 * @returns {{ text: string, remainingBytes: number[] }}
 */
function decodeTmuxEscapes(value = '', carryoverBytes = []) {
    if (!value && carryoverBytes.length === 0) return { text: '', remainingBytes: [] };

    let result = '';
    let i = 0;
    /** @type {number[]} */
    let pendingBytes = [...carryoverBytes];

    const flushBytes = () => {
        if (pendingBytes.length === 0) return;
        const completeLen = findCompleteUtf8Length(pendingBytes);
        if (completeLen > 0) {
            result += Buffer.from(pendingBytes.slice(0, completeLen)).toString('utf-8');
        }
        pendingBytes = completeLen < pendingBytes.length
            ? pendingBytes.slice(completeLen)
            : [];
    };

    if (!value) {
        // Only carryover bytes, no new data — force flush everything
        if (pendingBytes.length > 0) {
            result += Buffer.from(pendingBytes).toString('utf-8');
            pendingBytes = [];
        }
        return { text: result, remainingBytes: [] };
    }

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

    // Final flush — split complete/incomplete UTF-8
    const completeLen = findCompleteUtf8Length(pendingBytes);
    if (completeLen > 0) {
        result += Buffer.from(pendingBytes.slice(0, completeLen)).toString('utf-8');
    }
    const remaining = completeLen < pendingBytes.length
        ? pendingBytes.slice(completeLen)
        : [];

    return { text: result, remainingBytes: remaining };
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
        /** @type {Buffer} Raw byte buffer for stdout (split on 0x0A after accumulation) */
        this.stdoutBuffer = Buffer.alloc(0);
        /** Pending incomplete octal tail from a previous %output line */
        this._pendingOctal = '';
        /** Pending incomplete UTF-8 bytes carried over from a previous %output line */
        this._pendingUtf8Bytes = /** @type {number[]} */ ([]);
        /** Trailing incomplete UTF-8 bytes from a previous %output line (raw bytes) */
        this._pendingLineBytes = /** @type {Buffer|null} */ (null);
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
        // Do NOT setEncoding('utf8') on stdout — tmux control mode may output
        // raw UTF-8 bytes that span across %output lines (separated by \n).
        // StringDecoder's UTF-8 would produce \uFFFD when a newline falls mid-character.
        // Instead, read as raw buffers and decode after splitting on newline bytes.
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
     * Send one literal text chunk through the existing tmux control client.
     * Returns false for control characters so callers can fall back to the
     * full terminal input path that handles paste buffers and special keys.
     * @param {string} input
     * @returns {boolean}
     */
    sendLiteralText(input) {
        if (typeof input !== 'string' || !input) return false;
        if (CONTROL_TEXT_PATTERN.test(input)) return false;
        this.sendCommand(`send-keys -t ${quoteTmuxCommandArg(this.sessionId)} -l -- ${quoteTmuxCommandArg(input)}`);
        return true;
    }

    /**
     * @param {string} key
     * @returns {boolean}
     */
    sendKey(key) {
        if (!CONTROL_KEY_ALLOWLIST.has(key)) return false;
        this.sendCommand(`send-keys -t ${quoteTmuxCommandArg(this.sessionId)} ${key}`);
        return true;
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
     * Handle raw stdout bytes from tmux control mode.
     * Split on newline bytes (0x0A) BEFORE UTF-8 decoding to avoid
     * StringDecoder producing \uFFFD when a newline falls inside a
     * multi-byte character that tmux outputs as raw UTF-8.
     * @param {Buffer} chunk
     * @returns {void}
     */
    _handleStdout(chunk) {
        this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);

        let start = 0;
        for (let idx = 0; idx < this.stdoutBuffer.length; idx++) {
            if (this.stdoutBuffer[idx] !== 0x0A) continue;

            // Found newline — extract line bytes (strip optional \r before \n)
            let end = idx;
            if (end > start && this.stdoutBuffer[end - 1] === 0x0D) end--;
            const lineBytes = this.stdoutBuffer.subarray(start, end);
            start = idx + 1;

            this._handleLineBytes(lineBytes);
        }

        // Keep remaining bytes (incomplete line) in buffer
        if (start > 0) {
            this.stdoutBuffer = Buffer.from(this.stdoutBuffer.subarray(start));
        }
    }

    /**
     * Process a complete line from tmux control mode as raw bytes.
     * For %output lines, the data portion is handled at the byte level
     * to carry over incomplete UTF-8 sequences across lines.
     * @param {Buffer} lineBytes
     * @returns {void}
     */
    _handleLineBytes(lineBytes) {
        if (!lineBytes || lineBytes.length === 0) return;

        // %output lines: handle data at byte level for UTF-8 safety
        // "%output %N " is always ASCII, so safe to check prefix as ASCII
        const PREFIX = '%output ';
        if (lineBytes.length >= PREFIX.length &&
            lineBytes.subarray(0, PREFIX.length).toString('ascii') === PREFIX) {
            // Find second space (after pane id)
            let secondSpace = -1;
            for (let j = PREFIX.length; j < lineBytes.length; j++) {
                if (lineBytes[j] === 0x20) { secondSpace = j; break; }
            }
            if (secondSpace === -1) return;

            // Extract data portion as raw bytes
            let dataBytes = lineBytes.subarray(secondSpace + 1);

            // Prepend any trailing UTF-8 bytes from the previous %output line
            if (this._pendingLineBytes && this._pendingLineBytes.length > 0) {
                dataBytes = Buffer.concat([this._pendingLineBytes, dataBytes]);
                this._pendingLineBytes = null;
            }

            // Strip trailing incomplete UTF-8 and carry to next line
            const completeEnd = _findTrailingIncompleteUtf8(dataBytes);
            if (completeEnd < dataBytes.length) {
                this._pendingLineBytes = Buffer.from(dataBytes.subarray(completeEnd));
                dataBytes = dataBytes.subarray(0, completeEnd);
            }

            // Decode data as UTF-8 (now guaranteed complete at both ends)
            const dataStr = dataBytes.toString('utf-8');

            // Prepend any leftover octal from a previous line
            const raw = this._pendingOctal + dataStr;
            this._pendingOctal = '';

            // Check for incomplete octal at the end
            const incomplete = this._extractIncompleteOctal(raw);
            const payload = incomplete ? raw.slice(0, raw.length - incomplete.length) : raw;
            this._pendingOctal = incomplete;

            const { text: decoded, remainingBytes } = decodeTmuxEscapes(payload, this._pendingUtf8Bytes);
            // DEBUG: detect FFFD at decode level
            if (decoded && decoded.includes('\uFFFD')) {
                const prevBytes = this._pendingUtf8Bytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
                const remBytes = remainingBytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
                const payloadHead = payload.slice(0, 80);
                console.error(`[FFFD-DEBUG] session=${this.sessionId} carryover=[${prevBytes}] remaining=[${remBytes}] payload="${payloadHead}" decoded="${decoded.slice(0, 80)}"`);
            }
            this._pendingUtf8Bytes = remainingBytes;
            if (decoded) {
                this.emit('output', decoded);
            }
            return;
        }

        // Non-%output lines: decode entire line as UTF-8
        const line = lineBytes.toString('utf-8');
        this._handleLine(line);
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
     * Handle non-%output lines (exit, error, etc.)
     * @param {string} line
     * @returns {void}
     */
    _handleLine(line) {
        if (!line) return;

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
