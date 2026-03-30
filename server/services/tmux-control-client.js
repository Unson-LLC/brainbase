// @ts-check
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

/**
 * @typedef {import('child_process').ChildProcessWithoutNullStreams} TmuxChildProcess
 */

/**
 * @param {string} [value]
 * @returns {string}
 */
function decodeTmuxEscapes(value = '') {
    // First pass: decode named escapes (\n, \r, \t, \\)
    // Second pass: decode octal sequences as UTF-8 byte sequences
    // tmux encodes UTF-8 multi-byte chars as individual octal bytes
    // e.g. "あ" → \343\201\202 (3 bytes). Must reassemble as UTF-8.
    const withNamedDecoded = value.replace(/\\(n|r|t|\\)/g, (match, token) => {
        if (token === 'n') return '\n';
        if (token === 'r') return '\r';
        if (token === 't') return '\t';
        return '\\';
    });

    // Collect consecutive octal sequences and decode them as UTF-8 byte buffers
    return withNamedDecoded.replace(/(\\[0-7]{3})+/g, (match) => {
        const bytes = [];
        for (const m of match.matchAll(/\\([0-7]{3})/g)) {
            bytes.push(Number.parseInt(m[1], 8));
        }
        try {
            return Buffer.from(bytes).toString('utf-8');
        } catch {
            // Fallback: decode each byte individually (Latin-1)
            return bytes.map(b => String.fromCharCode(b)).join('');
        }
    });
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
     * @param {string} line
     * @returns {void}
     */
    _handleLine(line) {
        if (!line) return;

        if (line.startsWith('%output ')) {
            const firstSpace = line.indexOf(' ');
            const secondSpace = line.indexOf(' ', firstSpace + 1);
            if (secondSpace === -1) return;
            const payload = line.slice(secondSpace + 1);
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
