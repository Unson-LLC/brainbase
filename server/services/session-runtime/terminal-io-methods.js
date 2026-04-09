import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const INLINE_TEXT_MAX_BYTES = 1024;
const TMUX_TIMEOUT_MS = 5_000;
const MUTATION_TIMEOUT_MS = 10_000;

export const terminalIoMethods = {
    async resizeSessionWindow(sessionId, cols, rows) {
        if (!sessionId) {
            throw new Error('Session ID required');
        }

        const safeCols = Math.max(40, Math.min(300, Number(cols) || 0));
        const safeRows = Math.max(12, Math.min(120, Number(rows) || 0));
        if (!Number.isFinite(safeCols) || !Number.isFinite(safeRows)) {
            throw new Error('Invalid terminal size');
        }

        await this._enqueueTerminalMutation(sessionId, async () => {
            await this.execPromise(`tmux resize-window -t "${sessionId}" -x ${safeCols} -y ${safeRows}`);
        });
    },

    async scrollSession(sessionId, direction, steps = 1) {
        if (!sessionId) {
            throw new Error('Session ID required');
        }

        const dir = direction === 'down' ? 'scroll-down' : direction === 'up' ? 'scroll-up' : null;
        if (!dir) {
            throw new Error('Invalid scroll direction');
        }

        const count = Math.min(10, Math.max(1, Number(steps) || 1));
        const target = sessionId.replace(/"/g, '\\"');
        const cmd = `tmux if-shell -F '#{pane_in_mode}' "send-keys -t \\"${target}\\" -X -N ${count} ${dir}" "copy-mode -t \\"${target}\\"; send-keys -t \\"${target}\\" -X -N ${count} ${dir}"`;

        await this._enqueueTerminalMutation(sessionId, async () => {
            await this.execPromise(cmd);
        });
    },

    async selectPane(sessionId, direction) {
        if (!sessionId) {
            throw new Error('Session ID required');
        }

        const validDirections = ['U', 'D', 'L', 'R'];
        if (!validDirections.includes(direction)) {
            throw new Error('Invalid direction. Must be U, D, L, or R');
        }

        const target = sessionId.replace(/"/g, '\\"');
        await this._enqueueTerminalMutation(sessionId, async () => {
            await this.execPromise(`tmux select-pane -t "${target}" -${direction}`);
        });
    },

    async exitCopyMode(sessionId) {
        if (!sessionId) {
            throw new Error('Session ID required');
        }

        const target = sessionId.replace(/"/g, '\\"');
        const cmd = `tmux if-shell -F '#{pane_in_mode}' "send-keys -t \\\"${target}\\\" -X cancel" ""`;

        await this._enqueueTerminalMutation(sessionId, async () => {
            await this.execPromise(cmd);
        });
    },

    async sendInput(sessionId, input, type) {
        if (!input) {
            throw new Error('Input required');
        }

        await this._capturePromptInput(sessionId, input, type);

        if (type !== 'key' && type !== 'text') {
            throw new Error('Type must be key or text');
        }

        await this._enqueueTerminalMutation(sessionId, async () => {
            if (type === 'key' && this.ALLOWED_KEYS.includes(input)) {
                await this._sendNamedKey(sessionId, input);
                return;
            }

            if (this._shouldUseLiteralText(input, type)) {
                await this._sendLiteralText(sessionId, input);
                return;
            }

            await this._pasteInputFromTempFile(sessionId, input);
        });
    },

    _withTimeout(promise, ms, onTimeout) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                if (onTimeout) onTimeout();
                reject(new Error(`Operation timed out after ${ms}ms`));
            }, ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    },

    async _enqueueTerminalMutation(sessionId, operation) {
        if (!sessionId) {
            throw new Error('Session ID required');
        }

        const previous = this.terminalMutationQueues.get(sessionId) || Promise.resolve();
        const next = previous
            .catch(() => {})
            .then(async () => {
                return await this._withTimeout(operation(), MUTATION_TIMEOUT_MS);
            });

        this.terminalMutationQueues.set(sessionId, next);

        try {
            return await next;
        } finally {
            if (this.terminalMutationQueues.get(sessionId) === next) {
                this.terminalMutationQueues.delete(sessionId);
            }
        }
    },

    _shouldUseLiteralText(input, type) {
        if (type !== 'text' || typeof input !== 'string' || !input) return false;
        if (input.includes('\n') || input.includes('\r')) return false;
        if (/[\x00-\x1f\x7f]/.test(input)) return false;
        return Buffer.byteLength(input, 'utf8') <= INLINE_TEXT_MAX_BYTES;
    },

    async _runTmux(args) {
        let child;
        const result = new Promise((resolve, reject) => {
            child = spawn('tmux', args, {
                stdio: ['ignore', 'pipe', 'pipe']
            });
            let stdout = '';
            let stderr = '';

            child.stdout?.on('data', (chunk) => {
                stdout += chunk.toString();
            });
            child.stderr?.on('data', (chunk) => {
                stderr += chunk.toString();
            });
            child.on('error', reject);
            child.on('close', (code) => {
                if (code === 0) {
                    resolve({ stdout, stderr });
                    return;
                }

                const detail = stderr.trim() || stdout.trim() || `tmux exited with code ${code}`;
                const error = new Error(detail);
                error.code = code;
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
            });
        });

        return this._withTimeout(result, TMUX_TIMEOUT_MS, () => {
            child?.kill('SIGKILL');
        });
    },

    async _sendNamedKey(sessionId, key) {
        await this._runTmux(['send-keys', '-t', sessionId, key]);
    },

    async _sendLiteralText(sessionId, input) {
        await this._runTmux(['send-keys', '-t', sessionId, '-l', '--', input]);
    },

    async _pasteInputFromTempFile(sessionId, input) {
        const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'brainbase-input-'));
        const tempFile = path.join(tempDir, 'paste.txt');
        const bufferName = `brainbase-${sessionId}-${Date.now()}`;

        try {
            await fs.promises.writeFile(tempFile, input, 'utf8');
            await this._runTmux(['load-buffer', '-b', bufferName, tempFile]);
            await this._runTmux(['paste-buffer', '-d', '-b', bufferName, '-t', sessionId]);
        } finally {
            this._runTmux(['delete-buffer', '-b', bufferName]).catch(() => {});
            fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
    }
};
