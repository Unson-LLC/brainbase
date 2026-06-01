import fs from 'fs';

import { CodexAppServerAdapter } from './codex-app-server-adapter.js';
import {
    getCodexAppServerThreadId,
    recordCodexAppServerSessionState
} from './codex-app-server-session-state.js';

const DEFAULT_CODEX_APP_COMMAND = '/Applications/Codex.app/Contents/Resources/codex';
const MAX_TIMELINE_ITEMS = 200;
const MAX_TEXT_LENGTH = 120_000;

function noopLogger() {
    return {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {}
    };
}

function normalizeString(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized || null;
}

function truncateText(value) {
    const text = typeof value === 'string' ? value : String(value ?? '');
    if (text.length <= MAX_TEXT_LENGTH) return text;
    return `${text.slice(0, MAX_TEXT_LENGTH)}\n[truncated]`;
}

function resolveCodexCommand() {
    if (normalizeString(process.env.CODEX_APP_SERVER_COMMAND)) {
        return process.env.CODEX_APP_SERVER_COMMAND.trim();
    }
    return fs.existsSync(DEFAULT_CODEX_APP_COMMAND) ? DEFAULT_CODEX_APP_COMMAND : 'codex';
}

function resolveResultThreadId(result) {
    return normalizeString(result?.thread?.id)
        || normalizeString(result?.threadId)
        || normalizeString(result?.id)
        || null;
}

function resolveResultTurnId(result) {
    return normalizeString(result?.turn?.id)
        || normalizeString(result?.turnId)
        || normalizeString(result?.id)
        || null;
}

function resolveRuntimePolicy(session) {
    const approvalPolicy = normalizeString(session?.codexAppServer?.approvalPolicy);
    const sandboxPolicy = normalizeString(session?.codexAppServer?.sandboxPolicy)
        || normalizeString(session?.codexAppServer?.sandboxMode);
    return {
        ...(approvalPolicy ? { approvalPolicy } : {}),
        ...(sandboxPolicy ? { sandboxPolicy } : {})
    };
}

function extractText(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value.text === 'string') return value.text;
    if (typeof value.delta === 'string') return value.delta;
    if (typeof value.content === 'string') return value.content;
    if (Array.isArray(value.content)) {
        return value.content.map(extractText).filter(Boolean).join('');
    }
    return '';
}

function normalizeTimelineEvent(message) {
    const method = message?.method || '';
    const params = message?.params || {};
    const item = params.item || params.delta || params.event || params;
    const itemId = normalizeString(item?.id)
        || normalizeString(params.itemId)
        || normalizeString(params.outputItemId)
        || normalizeString(params.turnId)
        || `${method}:${Date.now()}`;
    const turnId = normalizeString(params.turn?.id)
        || normalizeString(params.turnId)
        || normalizeString(item?.turnId)
        || null;

    if (method.includes('error') || item?.type === 'error') {
        return {
            id: itemId,
            turnId,
            kind: 'error',
            status: 'complete',
            text: truncateText(item?.message || params.message || message?.error?.message || 'Codex App Server error')
        };
    }

    if (method === 'turn/started') {
        return { lifecycle: 'turn_started', turnId, status: 'running' };
    }

    if (method === 'turn/completed' || method === 'turn/failed' || method === 'turn/cancelled') {
        return {
            id: `${method}:${turnId || Date.now()}`,
            lifecycle: method.replace('/', '_'),
            turnId,
            kind: 'turn',
            status: method === 'turn/completed' ? 'complete' : 'error',
            text: method === 'turn/completed'
                ? 'Turn completed'
                : method === 'turn/cancelled'
                    ? 'Turn cancelled'
                    : (params.message || item?.message || 'Turn failed')
        };
    }

    const type = item?.type || params.type || method;
    const text = extractText(item) || extractText(params);
    if (!text) return null;

    let kind = 'assistant';
    if (type.includes('reasoning') || method.includes('reasoning')) kind = 'reasoning';
    if (type.includes('command') || method.includes('command') || method.includes('exec')) kind = 'command';
    if (type.includes('file') || method.includes('file')) kind = 'file_change';
    if (type.includes('tool') || method.includes('tool')) kind = 'tool';
    if (type.includes('input') || type.includes('approval') || method.includes('input') || method.includes('approval')) kind = 'input_request';
    if (type.includes('user')) kind = 'user';

    return {
        id: itemId,
        turnId,
        kind,
        status: method.endsWith('delta') || type.endsWith('delta') ? 'streaming' : 'complete',
        text: truncateText(text)
    };
}

export class CodexAppServerTranscriptService {
    constructor({
        stateStore,
        logger = noopLogger(),
        activityService = null,
        adapterFactory = (options) => new CodexAppServerAdapter(options),
        codexCommand = resolveCodexCommand(),
        codexArgs = ['app-server', '--listen', 'stdio://']
    } = {}) {
        this.stateStore = stateStore;
        this.logger = logger || noopLogger();
        this.activityService = activityService;
        this.adapterFactory = adapterFactory;
        this.codexCommand = codexCommand;
        this.codexArgs = codexArgs;
        this.sessions = new Map();
    }

    async ensureSession(sessionId) {
        const session = this._getSession(sessionId);
        if (!session) {
            const error = new Error(`Session not found: ${sessionId}`);
            error.status = 404;
            throw error;
        }
        if (session.engine !== 'codex') {
            const error = new Error('Codex App Server transcript is only available for Codex sessions');
            error.status = 400;
            throw error;
        }

        const runtime = this._getRuntime(session);
        if (runtime.status === 'error' && runtime.timeline.length > 0 && !runtime.ready) {
            return this.getSnapshot(sessionId);
        }
        if (runtime.ready) return this.getSnapshot(sessionId);
        if (runtime.readyPromise) {
            await runtime.readyPromise;
            return this.getSnapshot(sessionId);
        }

        runtime.readyPromise = this._startRuntime(session, runtime);
        try {
            await runtime.readyPromise;
            return this.getSnapshot(sessionId);
        } finally {
            runtime.readyPromise = null;
        }
    }

    async startTurn(sessionId, text) {
        const inputText = normalizeString(text);
        if (!inputText) {
            const error = new Error('text is required');
            error.status = 400;
            throw error;
        }

        let runtime;
        try {
            await this.ensureSession(sessionId);
            runtime = this.sessions.get(sessionId);
        } catch (error) {
            const session = this._getSession(sessionId);
            if (session?.engine === 'codex') {
                runtime = this._getRuntime(session);
                runtime.status = 'error';
                this._appendItem(runtime, {
                    id: `turn-error:${Date.now()}`,
                    kind: 'error',
                    status: 'complete',
                    text: error.message || 'Codex App Server startup failed',
                    createdAt: new Date().toISOString()
                });
            }
            throw error;
        }
        this._appendItem(runtime, {
            id: `local-user:${Date.now()}`,
            kind: 'user',
            status: 'complete',
            text: inputText,
            createdAt: new Date().toISOString()
        });

        let result;
        try {
            result = await runtime.adapter.startTurn({
                threadId: runtime.threadId,
                input: [{ type: 'text', text: inputText }],
                cwd: runtime.cwd,
                ...runtime.policy
            });
        } catch (error) {
            runtime.status = 'error';
            this._appendItem(runtime, {
                id: `turn-error:${Date.now()}`,
                kind: 'error',
                status: 'complete',
                text: error.message || 'Codex App Server turn failed',
                createdAt: new Date().toISOString()
            });
            await recordCodexAppServerSessionState({
                stateStore: this.stateStore,
                sessionId,
                threadId: runtime.threadId,
                lifecycle: 'turn_failed',
                eventType: 'turn/start',
                status: 'error'
            });
            this._reportActivity(runtime, {
                lifecycle: 'turn_failed',
                eventType: 'turn/start',
                status: 'done',
                activityKind: 'task_completed',
                currentStep: 'Codex App Serverのターンが失敗'
            });
            throw error;
        }
        const turnId = resolveResultTurnId(result);
        runtime.activeTurnId = turnId || runtime.activeTurnId;
        runtime.status = 'working';
        await recordCodexAppServerSessionState({
            stateStore: this.stateStore,
            sessionId,
            threadId: runtime.threadId,
            turnId,
            lifecycle: 'turn_started',
            eventType: 'turn/start',
            status: 'working'
        });
        this._reportActivity(runtime, {
            turnId,
            lifecycle: 'turn_started',
            eventType: 'turn/start',
            status: 'working',
            activityKind: 'task_started',
            currentStep: 'Codex App Serverで作業開始'
        });
        return this.getSnapshot(sessionId);
    }

    getSnapshot(sessionId) {
        const runtime = this.sessions.get(sessionId);
        if (!runtime) {
            return {
                sessionId,
                threadId: null,
                status: 'not_started',
                timeline: []
            };
        }
        return {
            sessionId,
            threadId: runtime.threadId,
            activeTurnId: runtime.activeTurnId || null,
            status: runtime.status,
            timeline: runtime.timeline.map((item) => ({ ...item }))
        };
    }

    async stopSession(sessionId, { status = 'stopped' } = {}) {
        const runtime = this.sessions.get(sessionId);
        if (!runtime) return false;

        runtime.ready = false;
        runtime.readyPromise = null;
        runtime.status = status;

        const adapter = runtime.adapter;
        if (adapter) {
            adapter.removeAllListeners?.();
            try {
                await adapter.stop?.();
            } catch (error) {
                runtime.adapter = adapter;
                this.logger.warn?.('[CodexAppServerTranscriptService] failed to stop adapter', {
                    sessionId,
                    error: error?.message || String(error)
                });
                throw error;
            }
        }
        runtime.adapter = null;
        this.sessions.delete(sessionId);
        return true;
    }

    async stopAll({ status = 'stopped' } = {}) {
        const sessionIds = Array.from(this.sessions.keys());
        await Promise.all(sessionIds.map((sessionId) => this.stopSession(sessionId, { status })));
        return { stopped: sessionIds.length };
    }

    _getSession(sessionId) {
        const state = this.stateStore?.get?.() || {};
        return Array.isArray(state.sessions)
            ? state.sessions.find((session) => session?.id === sessionId)
            : null;
    }

    _getRuntime(session) {
        if (this.sessions.has(session.id)) return this.sessions.get(session.id);
        const runtime = {
            sessionId: session.id,
            cwd: session.path || process.cwd(),
            threadId: getCodexAppServerThreadId(session),
            activeTurnId: session.codexAppServer?.activeTurnId || null,
            status: session.codexAppServer?.status || session.codexAppServer?.lifecycle || 'starting',
            adapter: null,
            ready: false,
            readyPromise: null,
            policy: resolveRuntimePolicy(session),
            timeline: [],
            byItemId: new Map()
        };
        this.sessions.set(session.id, runtime);
        return runtime;
    }

    async _startRuntime(session, runtime) {
        runtime.adapter = this.adapterFactory({
            codexCommand: this.codexCommand,
            codexArgs: [...this.codexArgs],
            cwd: runtime.cwd,
            logger: this.logger
        });
        runtime.adapter.on('notification', (message) => {
            this._handleNotification(runtime, message).catch((error) => {
                this.logger.warn?.('[CodexAppServerTranscriptService] notification handling failed', { error: error.message });
            });
        });
        runtime.adapter.on('exit', () => {
            runtime.ready = false;
            runtime.status = 'exited';
        });
        runtime.adapter.on('child_error', (error) => {
            runtime.status = 'error';
            this._appendItem(runtime, {
                id: `child-error:${Date.now()}`,
                kind: 'error',
                status: 'complete',
                text: error.message,
                createdAt: new Date().toISOString()
            });
        });

        try {
            await runtime.adapter.start();
            const resumedExistingThread = Boolean(runtime.threadId);
            if (resumedExistingThread) {
                await runtime.adapter.request('thread/resume', {
                    threadId: runtime.threadId,
                    cwd: runtime.cwd,
                    ...runtime.policy
                });
            } else {
                const result = await runtime.adapter.startThread({
                    cwd: runtime.cwd,
                    ...runtime.policy
                });
                runtime.threadId = resolveResultThreadId(result);
            }

            runtime.ready = true;
            runtime.status = 'ready';
            await this._loadThreadHistory(runtime);
            await recordCodexAppServerSessionState({
                stateStore: this.stateStore,
                sessionId: session.id,
                threadId: runtime.threadId,
                lifecycle: 'thread_started',
                eventType: resumedExistingThread ? 'thread/resume' : 'thread/start',
                status: 'ready'
            });
        } catch (error) {
            await this._discardFailedRuntime(session.id, runtime, error);
            throw error;
        }
    }

    async _discardFailedRuntime(sessionId, runtime, error) {
        runtime.ready = false;
        runtime.readyPromise = null;
        runtime.status = 'error';
        const adapter = runtime.adapter;
        runtime.adapter = null;
        if (adapter?.removeAllListeners) adapter.removeAllListeners();
        if (adapter?.stop) {
            try {
                await adapter.stop();
            } catch (stopError) {
                this.logger.warn?.('[CodexAppServerTranscriptService] failed to stop startup-failed adapter', {
                    sessionId,
                    error: stopError.message
                });
            }
        }
        if (this.sessions.get(sessionId) === runtime) {
            this.sessions.delete(sessionId);
        }
        this.logger.warn?.('[CodexAppServerTranscriptService] discarded startup-failed runtime', {
            sessionId,
            error: error?.message
        });
    }

    async _loadThreadHistory(runtime) {
        if (!runtime.threadId) return;
        try {
            const result = await runtime.adapter.request('thread/read', {
                threadId: runtime.threadId,
                includeTurns: true
            }, { timeoutMs: 15_000 });
            const items = result?.items || result?.thread?.items || result?.turns || [];
            for (const item of Array.isArray(items) ? items : []) {
                const text = extractText(item);
                if (!text) continue;
                this._appendItem(runtime, {
                    id: normalizeString(item.id) || `history:${runtime.timeline.length}`,
                    kind: item.role === 'user' ? 'user' : 'assistant',
                    status: 'complete',
                    text: truncateText(text),
                    createdAt: item.createdAt || new Date().toISOString()
                });
            }
        } catch (error) {
            this.logger.debug?.('[CodexAppServerTranscriptService] thread/read skipped', { error: error.message });
        }
    }

    async _handleNotification(runtime, message) {
        const event = normalizeTimelineEvent(message);
        if (!event) return;
        if (event.lifecycle) {
            const isTerminalTurnLifecycle = [
                'turn_completed',
                'turn_failed',
                'turn_cancelled'
            ].includes(event.lifecycle);
            runtime.activeTurnId = isTerminalTurnLifecycle ? null : (event.turnId || runtime.activeTurnId);
            runtime.status = event.status === 'error' ? 'error' : event.status;
            if (event.text) {
                this._appendItem(runtime, {
                    id: event.id,
                    turnId: event.turnId,
                    kind: event.kind || 'turn',
                    status: event.status,
                    text: event.text,
                    createdAt: new Date().toISOString()
                });
            }
            await recordCodexAppServerSessionState({
                stateStore: this.stateStore,
                sessionId: runtime.sessionId,
                threadId: runtime.threadId,
                turnId: event.turnId,
                lifecycle: event.lifecycle,
                eventType: message.method,
                status: runtime.status
            });
            this._reportActivity(runtime, {
                turnId: event.turnId,
                lifecycle: event.lifecycle,
                eventType: message.method,
                status: isTerminalTurnLifecycle ? 'done' : 'working',
                activityKind: isTerminalTurnLifecycle ? 'task_completed' : 'task_started',
                currentStep: event.lifecycle === 'turn_completed'
                    ? 'Codex App Serverのターンが完了'
                    : event.lifecycle === 'turn_cancelled'
                        ? 'Codex App Serverのターンがキャンセル'
                        : event.lifecycle === 'turn_failed'
                            ? 'Codex App Serverのターンが失敗'
                            : 'Codex App Serverで作業開始'
            });
            return;
        }
        this._appendItem(runtime, {
            ...event,
            createdAt: new Date().toISOString()
        });
    }

    _reportActivity(runtime, {
        turnId = null,
        lifecycle,
        eventType,
        status,
        activityKind,
        currentStep
    } = {}) {
        if (!this.activityService || typeof this.activityService.reportActivity !== 'function') return;
        this.activityService.reportActivity(runtime.sessionId, status, Date.now(), {
            lifecycle,
            eventType,
            ...(turnId ? { turnId } : {}),
            activityKind,
            currentStep,
            latestEvidence: 'codex app-server transcript'
        });
    }

    _appendItem(runtime, event) {
        const id = event.id || `${event.kind}:${Date.now()}`;
        const existing = runtime.byItemId.get(id);
        if (existing && event.status === 'streaming') {
            existing.text = truncateText(`${existing.text || ''}${event.text || ''}`);
            existing.status = 'streaming';
            return existing;
        }
        const item = {
            id,
            turnId: event.turnId || runtime.activeTurnId || null,
            kind: event.kind || 'assistant',
            status: event.status || 'complete',
            text: truncateText(event.text || ''),
            createdAt: event.createdAt || new Date().toISOString()
        };
        runtime.timeline.push(item);
        runtime.byItemId.set(id, item);
        while (runtime.timeline.length > MAX_TIMELINE_ITEMS) {
            const removed = runtime.timeline.shift();
            if (removed?.id) runtime.byItemId.delete(removed.id);
        }
        return item;
    }
}
