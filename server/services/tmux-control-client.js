import { spawn } from 'child_process';
import { EventEmitter } from 'events';

const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

function decodeTmuxEscapes(value = '') {
    return value.replace(/\\([0-7]{3}|n|r|t|\\)/g, (match, token) => {
        if (token === 'n') return '\n';
        if (token === 'r') return '\r';
        if (token === 't') return '\t';
        if (token === '\\') return '\\';
        return String.fromCharCode(Number.parseInt(token, 8));
    });
}

export class TmuxControlClient extends EventEmitter {
    constructor({ sessionId, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS, spawnFn = spawn }) {
        super();
        this.sessionId = sessionId;
        this.idleTimeoutMs = idleTimeoutMs;
        this.spawnFn = spawnFn;
        this.process = null;
        this.stdoutBuffer = '';
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

    touch() {
        if (this._closed) return;
        this._clearIdleTimer();
        this._idleTimer = setTimeout(() => {
            this.close();
        }, this.idleTimeoutMs);
    }

    resize(cols, rows) {
        const safeCols = Math.max(40, Math.min(300, Number(cols) || 0));
        const safeRows = Math.max(12, Math.min(120, Number(rows) || 0));
        if (!Number.isFinite(safeCols) || !Number.isFinite(safeRows)) return;
        this.sendCommand(`refresh-client -C ${safeCols}x${safeRows}`);
    }

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

    _clearIdleTimer() {
        if (!this._idleTimer) return;
        clearTimeout(this._idleTimer);
        this._idleTimer = null;
    }

    _handleStdout(chunk) {
        this.stdoutBuffer += chunk;
        const lines = this.stdoutBuffer.split(/\r?\n/);
        this.stdoutBuffer = lines.pop() || '';

        for (const line of lines) {
            this._handleLine(line);
        }
    }

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
