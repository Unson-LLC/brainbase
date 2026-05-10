import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const INLINE_TEXT_MAX_BYTES = 1024;
const TMUX_TIMEOUT_MS = 5_000;
const MUTATION_TIMEOUT_MS = 10_000;
const TEXT_CONTROL_KEY_MAP = new Map([
    ['\r', 'Enter'],
    ['\n', 'Enter'],
    ['\r\n', 'Enter'],
    ['\x7f', 'BSpace'],
    ['\x08', 'BSpace'],
    ['\x03', 'C-c'],
    ['\x04', 'C-d'],
    ['\x0c', 'C-l'],
    ['\x15', 'C-u'],
    ['\x1b', 'Escape'],
    ['\t', 'Tab'],
    ['\x1b[A', 'Up'],
    ['\x1b[B', 'Down'],
    ['\x1b[C', 'Right'],
    ['\x1b[D', 'Left']
]);
const TYPING_SIMULATION_MIN_CHARS = 40;
const TYPING_SIMULATION_MAX_CHARS = 500;
const TYPING_SIMULATION_DELAY_MS = 12;
const COLLAPSED_PANE_COLS = 20;
const COLLAPSED_PANE_ROWS = 5;
const REPAIR_PANE_COLS = 80;
const REPAIR_PANE_ROWS = 24;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export const terminalIoMethods = {
    async getSessionPaneSize(sessionId) {
        if (!sessionId) {
            throw new Error('Session ID required');
        }

        const { stdout } = await this.execPromise(
            `tmux display-message -p -t "${sessionId}" "#{pane_width},#{pane_height}" 2>/dev/null || true`
        );
        const [colsRaw, rowsRaw] = stdout.trim().split(',');
        const cols = Number.parseInt(colsRaw, 10);
        const rows = Number.parseInt(rowsRaw, 10);
        if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) {
            return null;
        }
        return { cols, rows };
    },

    async repairCollapsedSessionWindow(sessionId, options = {}) {
        if (!sessionId) {
            throw new Error('Session ID required');
        }

        const paneSize = await this.getSessionPaneSize(sessionId);
        if (!paneSize) {
            return {
                repaired: false,
                paneSize: null,
                reason: 'pane-size-unavailable'
            };
        }

        const needsRepair = paneSize.cols < COLLAPSED_PANE_COLS || paneSize.rows < COLLAPSED_PANE_ROWS;
        if (!needsRepair) {
            return {
                repaired: false,
                paneSize,
                reason: 'pane-size-ok'
            };
        }

        const targetCols = Math.max(REPAIR_PANE_COLS, Number(options.minCols) || 0);
        const targetRows = Math.max(REPAIR_PANE_ROWS, Number(options.minRows) || 0);
        console.warn('[MOBILE_TERMINAL_GEOMETRY] repairing collapsed tmux pane', {
            sessionId,
            paneSize,
            target: { cols: targetCols, rows: targetRows },
            source: options.reason || 'unknown'
        });
        await this.resizeSessionWindow(sessionId, targetCols, targetRows);
        const repairedPaneSize = await this.getSessionPaneSize(sessionId).catch(() => null);

        return {
            repaired: true,
            paneSize,
            repairedPaneSize,
            target: { cols: targetCols, rows: targetRows },
            reason: options.reason || 'collapsed-pane'
        };
    },

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

        await this._enqueueTerminalMutation(sessionId, async () => {
            // if-shellの-tなし問題を回避: _runTmuxで直接cancel送信し、エラーは無視（copy-mode外なら失敗するだけ）
            await this._runTmux(['send-keys', '-t', sessionId, '-X', 'cancel']).catch(() => {});
        });
    },

    async sendInput(sessionId, input, type, options = {}) {
        if (!input) {
            console.warn(`[INPUT-TELEMETRY] dropped reason=INVALID_INPUT session=${sessionId} sub=missing_value`);
            throw new Error('Input required');
        }

        if (type !== 'key' && type !== 'text') {
            console.warn(`[INPUT-TELEMETRY] dropped reason=INVALID_INPUT session=${sessionId} sub=invalid_type type=${type}`);
            throw new Error('Type must be key or text');
        }

        const focusStrippedInput = type === 'text'
            ? this._stripTerminalFocusEvents(input)
            : input;
        const { input: normalizedInput, type: normalizedType } = this._normalizeTerminalTextControlInput(focusStrippedInput, type);
        if (!normalizedInput) {
            console.warn(`[INPUT-TELEMETRY] dropped reason=INPUT_FOCUS_STRIPPED_EMPTY session=${sessionId} originalLen=${input.length}`);
            return;
        }

        await this._capturePromptInput(sessionId, normalizedInput, normalizedType);

        await this._enqueueTerminalMutation(sessionId, async () => {
            // copy-mode中はまず解除してからinputを送る（scrollSession後に入力できなくなる問題を防止）
            // _enqueueTerminalMutation内で実行することで、並行するsendInput呼び出しと競合しない
            const target = sessionId.replace(/"/g, '\\"');
            await this.execPromise(`tmux if-shell -F '#{pane_in_mode}' "send-keys -t \\"${target}\\" -X cancel" ""`).catch(() => {});

            if (normalizedType === 'key' && this.ALLOWED_KEYS.includes(normalizedInput)) {
                console.info(`[INPUT-TELEMETRY] tmuxRoute=namedKey session=${sessionId} key=${normalizedInput}`);
                await this._sendNamedKey(sessionId, normalizedInput);
                return;
            }

            // forcePaste=true の場合は短いテキストでも paste-buffer 経由で送る。
            // bracketed paste markers (\e[200~..\e[201~) が付くため、
            // Codex 等の bracketed paste 認識が必要な TUI でも正しく扱われる。
            // 通常の typing (send-keys -l) では markers なしで送られ、
            // Codex が pasted 扱いせず、入力欄から消えるバグが起きていた。
            if (options.forcePaste === true) {
                await this._pasteInputFromTempFile(sessionId, normalizedInput);
                return;
            }

            if (this._shouldUseTypingSimulation(normalizedInput, normalizedType, options)) {
                await this._sendSimulatedTyping(sessionId, normalizedInput, {
                    delayMs: options.typingDelayMs
                });
                return;
            }

            if (this._shouldUseLiteralText(normalizedInput, normalizedType)) {
                await this._sendLiteralText(sessionId, normalizedInput);
                return;
            }

            await this._pasteInputFromTempFile(sessionId, normalizedInput);
        });
    },

    _stripTerminalFocusEvents(input) {
        if (typeof input !== 'string') return input;
        return input.replace(/\x1b\[(?:I|O)/g, '');
    },

    _normalizeTerminalTextControlInput(input, type) {
        if (type !== 'text' || typeof input !== 'string') {
            return { input, type };
        }

        const key = TEXT_CONTROL_KEY_MAP.get(input);
        if (!key) {
            return { input, type };
        }

        return { input: key, type: 'key' };
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
        // 直前の mutation 失敗を観測のためログに残す（mutex継続のため握り潰しは維持）。
        const next = previous
            .catch((prevErr) => {
                if (prevErr) {
                    console.warn(`[INPUT-TELEMETRY] mutation-queue prev-failed session=${sessionId} err=${prevErr?.message || prevErr}`);
                }
            })
            .then(async () => {
                try {
                    return await this._withTimeout(operation(), MUTATION_TIMEOUT_MS);
                } catch (err) {
                    console.warn(`[INPUT-TELEMETRY] dropped reason=MUTATION_TIMEOUT_OR_FAILED session=${sessionId} err=${err?.message || err}`);
                    throw err;
                }
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

    _shouldUseTypingSimulation(input, type, options = {}) {
        if (options.simulateTyping === false) return false;
        if (options.simulateTyping === true) return type === 'text' && typeof input === 'string' && input.length > 0;
        if (type !== 'text' || typeof input !== 'string' || !input) return false;
        if (input.includes('\n') || input.includes('\r')) return false;
        if (/[\x00-\x1f\x7f]/.test(input)) return false;
        const chars = Array.from(input).length;
        return chars >= TYPING_SIMULATION_MIN_CHARS && chars <= TYPING_SIMULATION_MAX_CHARS;
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

    async _sendSimulatedTyping(sessionId, input, options = {}) {
        const chars = Array.from(input);
        const delayMs = Number.isFinite(Number(options.delayMs))
            ? Math.max(0, Math.min(100, Number(options.delayMs)))
            : TYPING_SIMULATION_DELAY_MS;
        console.info(`[INPUT-TELEMETRY] typing-simulation session=${sessionId} chars=${chars.length} delayMs=${delayMs}`);

        for (let i = 0; i < chars.length; i++) {
            await this._sendLiteralText(sessionId, chars[i]);
            if (delayMs > 0 && i < chars.length - 1) {
                await sleep(delayMs);
            }
        }
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
