import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

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

        await this.execPromise(`tmux resize-window -t "${sessionId}" -x ${safeCols} -y ${safeRows}`);
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

        await this.execPromise(cmd);
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
        await this.execPromise(`tmux select-pane -t "${target}" -${direction}`);
    },

    async exitCopyMode(sessionId) {
        if (!sessionId) {
            throw new Error('Session ID required');
        }

        const target = sessionId.replace(/"/g, '\\"');
        const cmd = `tmux if-shell -F '#{pane_in_mode}' "send-keys -t \\\"${target}\\\" -X cancel" ""`;

        await this.execPromise(cmd);
    },

    async sendInput(sessionId, input, type) {
        if (!input) {
            throw new Error('Input required');
        }

        await this._capturePromptInput(sessionId, input, type);

        if (type === 'key') {
            if (this.ALLOWED_KEYS.includes(input)) {
                await this._sendNamedKey(sessionId, input);
                return;
            }
        } else if (type !== 'text') {
            throw new Error('Type must be key or text');
        }

        await this._pasteInputFromTempFile(sessionId, input);
    },

    async _runTmux(args) {
        return await new Promise((resolve, reject) => {
            const child = spawn('tmux', args, {
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
    },

    async _sendNamedKey(sessionId, key) {
        await this._runTmux(['send-keys', '-t', sessionId, key]);
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
            await this._runTmux(['delete-buffer', '-b', bufferName]).catch(() => {});
            await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
    }
};
