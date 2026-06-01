import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import readline from 'readline';

const DEFAULT_CODEX_COMMAND = 'codex';
const DEFAULT_CODEX_ARGS = ['app-server'];
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function noopLogger() {
    return {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {}
    };
}

function buildDefaultClientInfo() {
    return {
        name: 'brainbase',
        title: 'Brainbase',
        version: process.env.npm_package_version || '0.0.0'
    };
}

function normalizeError(error) {
    if (error instanceof Error) return error;
    if (error && typeof error.message === 'string') {
        const normalized = new Error(error.message);
        if (error.code !== undefined) normalized.code = error.code;
        return normalized;
    }
    return new Error(String(error || 'Unknown Codex App Server error'));
}

export class CodexAppServerAdapter extends EventEmitter {
    constructor({
        codexCommand = DEFAULT_CODEX_COMMAND,
        codexArgs = DEFAULT_CODEX_ARGS,
        cwd = process.cwd(),
        env = process.env,
        spawnFn = spawn,
        clientInfo = buildDefaultClientInfo(),
        requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
        logger = noopLogger()
    } = {}) {
        super();
        this.codexCommand = codexCommand;
        this.codexArgs = [...codexArgs];
        this.cwd = cwd;
        this.env = env;
        this.spawnFn = spawnFn;
        this.clientInfo = clientInfo;
        this.requestTimeoutMs = requestTimeoutMs;
        this.logger = logger || noopLogger();

        this.proc = null;
        this.readline = null;
        this.nextRequestId = 1;
        this.pending = new Map();
        this.running = false;
        this.initialized = false;
        this.startPromise = null;
    }

    async start() {
        if (this.running && this.initialized) return this;
        if (this.startPromise) return this.startPromise;

        this.startPromise = this._start();
        try {
            await this.startPromise;
            return this;
        } finally {
            this.startPromise = null;
        }
    }

    async _start() {
        if (this.proc) {
            throw new Error('Codex App Server process already exists but is not initialized');
        }

        this.proc = this.spawnFn(this.codexCommand, this.codexArgs, {
            cwd: this.cwd,
            env: this.env,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        this.running = true;
        this.initialized = false;

        this._attachProcessHandlers(this.proc);

        try {
            const initializeResult = await this._sendRequest('initialize', {
                clientInfo: this.clientInfo
            }, { allowBeforeInitialized: true });
            this.notify('initialized', {});
            this.initialized = true;
            this.emit('initialized', initializeResult);
            return this;
        } catch (error) {
            await this.stop();
            throw error;
        }
    }

    async stop() {
        const proc = this.proc;
        this._rejectAllPending(new Error('Codex App Server adapter stopped'));
        this.initialized = false;
        this.running = false;

        if (this.readline) {
            this.readline.close();
            this.readline = null;
        }

        if (proc && !proc.killed) {
            proc.kill('SIGTERM');
        }
        this.proc = null;
    }

    request(method, params = {}, options = {}) {
        if (!this.initialized && !options.allowBeforeInitialized) {
            return Promise.reject(new Error('Codex App Server adapter is not initialized'));
        }
        return this._sendRequest(method, params, options);
    }

    notify(method, params = {}) {
        this._writeMessage({ method, params });
    }

    startThread({ model, cwd, metadata, approvalPolicy, sandboxPolicy } = {}) {
        const params = {};
        if (model) params.model = model;
        if (cwd) params.cwd = cwd;
        if (metadata) params.metadata = metadata;
        if (approvalPolicy) params.approvalPolicy = approvalPolicy;
        if (sandboxPolicy) params.sandboxPolicy = sandboxPolicy;
        return this.request('thread/start', params);
    }

    startTurn({ threadId, input, model, cwd, approvalPolicy, sandboxPolicy } = {}) {
        if (!threadId) {
            return Promise.reject(new Error('threadId is required'));
        }
        if (input === undefined) {
            return Promise.reject(new Error('input is required'));
        }
        const params = { threadId };
        params.input = input;
        if (model) params.model = model;
        if (cwd) params.cwd = cwd;
        if (approvalPolicy) params.approvalPolicy = approvalPolicy;
        if (sandboxPolicy) params.sandboxPolicy = sandboxPolicy;
        return this.request('turn/start', params);
    }

    interruptTurn({ threadId, turnId } = {}) {
        if (!threadId) {
            return Promise.reject(new Error('threadId is required'));
        }
        if (!turnId) {
            return Promise.reject(new Error('turnId is required'));
        }
        const params = { threadId, turnId };
        return this.request('turn/interrupt', params);
    }

    _sendRequest(method, params = {}, options = {}) {
        if (!this.running || !this.proc?.stdin?.writable) {
            return Promise.reject(new Error('Codex App Server process is not running'));
        }

        const id = this.nextRequestId++;
        const timeoutMs = Number(options.timeoutMs) || this.requestTimeoutMs;
        const message = { method, id, params };

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Codex App Server request timed out: ${method}`));
            }, timeoutMs);

            this.pending.set(id, {
                method,
                resolve,
                reject,
                timeout
            });

            try {
                this._writeMessage(message);
            } catch (error) {
                clearTimeout(timeout);
                this.pending.delete(id);
                reject(error);
            }
        });
    }

    _writeMessage(message) {
        if (!this.proc?.stdin?.writable) {
            throw new Error('Codex App Server stdin is not writable');
        }
        this.proc.stdin.write(`${JSON.stringify(message)}\n`);
    }

    _attachProcessHandlers(proc) {
        if (proc.stdout) {
            this.readline = readline.createInterface({ input: proc.stdout });
            this.readline.on('line', (line) => this._handleStdoutLine(line));
        }

        if (proc.stderr) {
            proc.stderr.on('data', (chunk) => {
                const text = chunk.toString();
                this.emit('stderr', text);
                this.logger.debug?.('[CodexAppServerAdapter] stderr', { text });
            });
        }

        proc.on('error', (error) => {
            const normalized = normalizeError(error);
            this.running = false;
            this.initialized = false;
            this.proc = null;
            this._rejectAllPending(normalized);
            this.emit('child_error', normalized);
            if (this.listenerCount('error') > 0) {
                this.emit('error', normalized);
            }
        });

        proc.on('exit', (code, signal) => {
            const error = new Error(`Codex App Server exited: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
            this.running = false;
            this.initialized = false;
            this.proc = null;
            this._rejectAllPending(error);
            this.emit('exit', { code, signal });
        });
    }

    _handleStdoutLine(line) {
        let message;
        try {
            message = JSON.parse(line);
        } catch (error) {
            const parseError = normalizeError(error);
            this.emit('parse_error', { error: parseError, line });
            return;
        }

        if (Object.prototype.hasOwnProperty.call(message, 'id')) {
            this._handleResponse(message);
            return;
        }

        if (message?.method) {
            this.emit('notification', message);
            this.emit(`notification:${message.method}`, message.params || {});
        }
    }

    _handleResponse(message) {
        const pending = this.pending.get(message.id);
        if (!pending) {
            this.emit('unmatched_response', message);
            return;
        }

        clearTimeout(pending.timeout);
        this.pending.delete(message.id);

        if (message.error) {
            pending.reject(normalizeError(message.error));
            return;
        }

        pending.resolve(message.result);
    }

    _rejectAllPending(error) {
        for (const [id, pending] of this.pending.entries()) {
            clearTimeout(pending.timeout);
            pending.reject(error);
            this.pending.delete(id);
        }
    }
}

export default CodexAppServerAdapter;
