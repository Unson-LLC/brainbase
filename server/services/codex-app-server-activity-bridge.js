import { recordCodexAppServerSessionState } from './codex-app-server-session-state.js';

const START_METHODS = new Set([
    'turn/started',
    'task_started'
]);

const COMPLETE_METHODS = new Set([
    'turn/completed',
    'task_complete',
    'codex/event/task_complete'
]);

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

function resolveNestedSessionId(params = {}) {
    return normalizeString(params.sessionId)
        || normalizeString(params.session_id)
        || normalizeString(params.brainbaseSessionId)
        || normalizeString(params.brainbase_session_id)
        || normalizeString(params.metadata?.sessionId)
        || normalizeString(params.metadata?.brainbaseSessionId)
        || normalizeString(params.turn?.sessionId)
        || normalizeString(params.turn?.session_id)
        || normalizeString(params.turn?.metadata?.sessionId)
        || normalizeString(params.turn?.metadata?.brainbaseSessionId)
        || normalizeString(params.thread?.sessionId)
        || normalizeString(params.thread?.session_id)
        || normalizeString(params.thread?.metadata?.sessionId)
        || normalizeString(params.thread?.metadata?.brainbaseSessionId)
        || null;
}

function resolveTurnId(params = {}) {
    return normalizeString(params.turnId)
        || normalizeString(params.turn_id)
        || normalizeString(params.turn?.id)
        || normalizeString(params.task?.turnId)
        || normalizeString(params.task?.turn_id)
        || null;
}

function resolveThreadId(params = {}) {
    return normalizeString(params.threadId)
        || normalizeString(params.thread_id)
        || normalizeString(params.thread?.id)
        || normalizeString(params.turn?.threadId)
        || normalizeString(params.turn?.thread_id)
        || normalizeString(params.turn?.thread?.id)
        || normalizeString(params.task?.threadId)
        || normalizeString(params.task?.thread_id)
        || null;
}

function resolveReportedAt(params = {}, now) {
    const numeric = Number(params.reportedAt ?? params.timestamp ?? params.createdAt);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;

    const text = normalizeString(params.reportedAt)
        || normalizeString(params.timestamp)
        || normalizeString(params.createdAt)
        || normalizeString(params.turn?.createdAt)
        || normalizeString(params.turn?.created_at);
    if (text) {
        const parsed = Date.parse(text);
        if (Number.isFinite(parsed)) return parsed;
    }

    return now();
}

function defaultSessionIdResolver(params) {
    return resolveNestedSessionId(params);
}

export class CodexAppServerActivityBridge {
    constructor({
        adapter,
        activityService,
        sessionId = null,
        sessionIdResolver = defaultSessionIdResolver,
        stateStore = null,
        now = Date.now,
        logger = noopLogger()
    } = {}) {
        if (!adapter || typeof adapter.on !== 'function' || typeof adapter.off !== 'function') {
            throw new Error('adapter must be an EventEmitter-compatible object');
        }
        if (!activityService || typeof activityService.reportActivity !== 'function') {
            throw new Error('activityService.reportActivity is required');
        }

        this.adapter = adapter;
        this.activityService = activityService;
        this.sessionId = normalizeString(sessionId);
        this.sessionIdResolver = sessionIdResolver;
        this.stateStore = stateStore;
        this.now = typeof now === 'function' ? now : Date.now;
        this.logger = logger || noopLogger();
        this.attached = false;
        this._onNotification = (notification) => {
            this.handleNotification(notification);
        };
    }

    attach() {
        if (this.attached) return this;
        this.adapter.on('notification', this._onNotification);
        this.attached = true;
        return this;
    }

    detach() {
        if (!this.attached) return this;
        this.adapter.off('notification', this._onNotification);
        this.attached = false;
        return this;
    }

    handleNotification(notification = {}) {
        const method = normalizeString(notification.method);
        const params = notification.params && typeof notification.params === 'object'
            ? notification.params
            : {};

        if (!START_METHODS.has(method) && !COMPLETE_METHODS.has(method)) {
            return { handled: false, reason: 'unsupported_method', method };
        }

        const resolvedSessionId = this.sessionId
            || normalizeString(this.sessionIdResolver?.(params, notification))
            || null;
        if (!resolvedSessionId) {
            this.logger.debug?.('[CodexAppServerActivityBridge] Ignored notification without session id', { method });
            return { handled: false, reason: 'missing_session_id', method };
        }

        const isStart = START_METHODS.has(method);
        const turnId = resolveTurnId(params);
        const threadId = resolveThreadId(params);
        const reportedAt = resolveReportedAt(params, this.now);
        const status = isStart ? 'working' : 'done';
        const lifecycle = isStart ? 'turn_started' : 'turn_completed';
        const activityKind = isStart ? 'task_started' : 'task_completed';
        const currentStep = isStart ? 'Codex App Serverで作業開始' : 'Codex App Serverのターンが完了';

        this.activityService.reportActivity(resolvedSessionId, status, reportedAt, {
            lifecycle,
            eventType: method,
            ...(turnId ? { turnId } : {}),
            activityKind,
            currentStep,
            latestEvidence: 'codex app-server notification'
        });

        const stateUpdate = recordCodexAppServerSessionState({
            stateStore: this.stateStore,
            sessionId: resolvedSessionId,
            threadId,
            turnId,
            lifecycle,
            eventType: method,
            reportedAt,
            status
        }).catch((error) => {
            this.logger.warn?.('[CodexAppServerActivityBridge] Failed to persist session-state metadata', {
                sessionId: resolvedSessionId,
                method,
                error: error?.message || String(error)
            });
            return { updated: false, reason: 'persist_failed' };
        });

        return {
            handled: true,
            method,
            sessionId: resolvedSessionId,
            status,
            lifecycle,
            turnId,
            threadId,
            stateUpdate
        };
    }
}

export default CodexAppServerActivityBridge;
