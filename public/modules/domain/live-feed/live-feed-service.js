// @ts-check
/**
 * Live Feed Service
 * セッションごとの現在アクティビティを「仕事カード」として提供する。
 */
import { appStore } from '../../core/store.js';
import { deriveSessionUiState } from '../../session-ui-state.js';

const MAX_ENTRIES = 200;
const MAX_HISTORY_ENTRIES = 200;
const STALE_WORKING_MS = 3 * 60 * 1000;
const STALE_REFRESH_MS = 30 * 1000;
const JAPANESE_TEXT_PATTERN = /[\u3040-\u30ff\u3400-\u9fff]/;

function containsReadableJapanese(value) {
    return typeof value === 'string' && JAPANESE_TEXT_PATTERN.test(value);
}

function buildRepoLabel(summary = {}) {
    if (!summary.repo && !summary.baseBranch) return '';
    return `${summary.repo || 'repo'}${summary.baseBranch ? `/${summary.baseBranch}` : ''}`;
}

function truncate(value, maxLength = 96) {
    if (!value) return '';
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 1)}…`;
}

function stableHash(value) {
    const text = String(value || '');
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    return Math.abs(hash).toString(36);
}

function normalizeTimestamp(value, fallback = Date.now()) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

function normalizeHistoryText(value, maxLength = 160) {
    if (typeof value !== 'string') return '';
    const normalized = value
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' / ');
    return truncate(normalized, maxLength);
}

function historyKindLabel(kind) {
    if (kind === 'startup_prompt') return '初回依頼';
    if (kind === 'user_prompt') return 'ユーザー入力';
    if (kind === 'agent_waiting') return '入力待ち';
    if (kind === 'agent_done') return '完了';
    if (kind === 'agent_blocked') return '停止';
    if (kind === 'evidence') return '根拠';
    if (kind === 'model_summary') return '生成要約';
    return '作業状況';
}

function historyIcon(actor, kind) {
    if (actor === 'user') return 'message-square';
    if (kind === 'agent_done') return 'check-circle';
    if (kind === 'agent_waiting') return 'circle-help';
    if (kind === 'agent_blocked') return 'circle-alert';
    if (kind === 'evidence') return 'file-text';
    if (kind === 'model_summary') return 'sparkles';
    return 'activity';
}

function historyTone(actor, kind) {
    if (actor === 'user') return 'prompt';
    if (kind === 'agent_done') return 'done';
    if (kind === 'agent_waiting') return 'waiting';
    if (kind === 'agent_blocked') return 'blocked';
    if (kind === 'model_summary') return 'summary';
    return 'working';
}

function provenanceLabel(textSource, evidenceSource) {
    if (textSource === 'raw_prompt') return 'raw prompt';
    if (textSource === 'model_summary') return 'generated summary';
    if (evidenceSource === 'activity_report') return 'structured activity';
    if (textSource === 'structured_field') return 'structured field';
    return 'deterministic';
}

function buildStatus(uiState, timestampMs) {
    const lifecycle = uiState.lifecycle || 'active';
    const activity = uiState.activity || 'idle';
    const attention = uiState.attention || 'none';
    const recentFile = uiState.recentFile || null;
    let text = '待機中';
    let icon = 'circle-dot';
    let tone = 'idle';

    if (attention === 'needs-input') {
        text = recentFile?.label
            ? `${recentFile.label} について入力待ち`
            : '入力待ち';
        icon = 'message-square';
        tone = 'waiting';
    } else if (lifecycle === 'paused') {
        text = '一時停止中';
        icon = 'pause';
        tone = 'paused';
    } else if (activity === 'thinking') {
        text = recentFile?.label
            ? `${recentFile.label} を処理中`
            : '応答を生成中';
        icon = 'sparkles';
        tone = 'working';
    } else if (activity === 'working') {
        text = '処理を開始中';
        icon = 'play';
        tone = 'working';
    } else if (activity === 'done-unread') {
        text = '応答が完了';
        icon = 'check-circle';
        tone = 'done';
    } else if (uiState.transport === 'disconnected' && lifecycle === 'active') {
        text = '停止中';
        icon = 'square';
        tone = 'blocked';
    } else if (lifecycle === 'archived') {
        text = 'アーカイブ済み';
        icon = 'archive';
        tone = 'idle';
    }

    if (tone === 'working' && timestampMs > 0 && (Date.now() - timestampMs) >= STALE_WORKING_MS) {
        text = `${Math.round((Date.now() - timestampMs) / 60000)}分更新なし`;
        icon = 'clock-3';
        tone = 'blocked';
    }

    return { text, icon, tone };
}

function buildTaskBrief(session, uiState, liveActivity) {
    const explicitTask = truncate(liveActivity?.taskBrief || '', 88);
    if (explicitTask && explicitTask !== session?.name) return explicitTask;

    const persistedTask = truncate(session?.taskBrief || '', 88);
    if (persistedTask && persistedTask !== session?.name) return persistedTask;

    const firstPromptTask = truncate(session?.conversationSummary?.firstPromptSummary || '', 88);
    if (firstPromptTask && firstPromptTask !== session?.name) return firstPromptTask;

    return '';
}

function buildAssistantSnippet(session, liveActivity) {
    if (containsReadableJapanese(liveActivity?.assistantSnippet)) {
        return truncate(liveActivity.assistantSnippet, 88);
    }
    if (containsReadableJapanese(session?.lastAssistantSnippet)) {
        return truncate(session.lastAssistantSnippet, 88);
    }
    return '';
}

function buildCurrentStep(session, uiState, liveActivity, status) {
    return buildAssistantSnippet(session, liveActivity);
}

function buildLatestEvidence(session, uiState, liveActivity, status) {
    return '';
}

function buildFingerprint(session, uiState) {
    const summary = uiState.summary || {};
    const recentFile = uiState.recentFile || null;
    const hookStatus = uiState.hookStatus || null;
    const liveActivity = hookStatus?.liveActivity || null;

    return JSON.stringify({
        name: session?.name || session?.id || '',
        intendedState: session?.intendedState || 'active',
        activity: uiState.activity || 'idle',
        attention: uiState.attention || 'none',
        transport: uiState.transport || 'disconnected',
        repo: summary.repo || '',
        baseBranch: summary.baseBranch || '',
        recentFile: recentFile?.path || '',
        lastWorkingAt: hookStatus?.lastWorkingAt || 0,
        lastDoneAt: hookStatus?.lastDoneAt || 0,
        lastActivityAt: hookStatus?.lastActivityAt || 0,
        lastEventType: hookStatus?.lastEventType || '',
        liveActivityKind: liveActivity?.activityKind || '',
        liveActivityTask: liveActivity?.taskBrief || '',
        liveActivityAssistantSnippet: liveActivity?.assistantSnippet || '',
        liveActivityUpdatedAt: liveActivity?.updatedAt || 0,
        liveActivityAssistantSnippetUpdatedAt: liveActivity?.assistantSnippetUpdatedAt || 0,
        sessionTaskBrief: session?.taskBrief || '',
        sessionTaskBriefUpdatedAt: session?.taskBriefUpdatedAt || '',
        sessionAssistantSnippet: session?.lastAssistantSnippet || '',
        sessionAssistantSnippetAt: session?.lastAssistantSnippetAt || ''
    });
}

function buildMovementKey(session, uiState, status, taskBrief) {
    const lifecycle = uiState.lifecycle || 'active';
    const activity = uiState.activity || 'idle';
    const attention = uiState.attention || 'none';
    const hookStatus = uiState.hookStatus || null;
    const liveActivity = hookStatus?.liveActivity || null;

    return JSON.stringify({
        intendedState: session?.intendedState || 'active',
        lifecycle,
        activity,
        attention,
        transport: uiState.transport || 'disconnected',
        statusTone: status?.tone || 'idle',
        activityKind: liveActivity?.activityKind || '',
        taskBrief: taskBrief || ''
    });
}

function getActivityTimestamp(session, uiState) {
    const hookStatus = uiState.hookStatus || null;
    const liveActivity = hookStatus?.liveActivity || null;
    const sessionTaskUpdatedAt = typeof session?.taskBriefUpdatedAt === 'string'
        ? (Date.parse(session.taskBriefUpdatedAt) || 0)
        : (Number(session?.taskBriefUpdatedAt) || 0);
    const sessionAssistantSnippetAt = typeof session?.lastAssistantSnippetAt === 'string'
        ? (Date.parse(session.lastAssistantSnippetAt) || 0)
        : (Number(session?.lastAssistantSnippetAt) || 0);
    const timestamp = Math.max(
        sessionTaskUpdatedAt,
        sessionAssistantSnippetAt,
        liveActivity?.assistantSnippetUpdatedAt || 0,
        liveActivity?.updatedAt || 0,
        hookStatus?.lastActivityAt || 0,
        hookStatus?.lastWorkingAt || 0,
        hookStatus?.lastDoneAt || 0
    );
    return timestamp > 0 ? new Date(timestamp) : new Date();
}

function getActivityEventTimestamp(session, uiState, liveActivity) {
    const hookStatus = uiState.hookStatus || null;
    const sessionTaskUpdatedAt = typeof session?.taskBriefUpdatedAt === 'string'
        ? (Date.parse(session.taskBriefUpdatedAt) || 0)
        : (Number(session?.taskBriefUpdatedAt) || 0);
    const sessionAssistantSnippetAt = typeof session?.lastAssistantSnippetAt === 'string'
        ? (Date.parse(session.lastAssistantSnippetAt) || 0)
        : (Number(session?.lastAssistantSnippetAt) || 0);
    const timestamp = Math.max(
        liveActivity?.assistantSnippetUpdatedAt || 0,
        sessionAssistantSnippetAt,
        sessionTaskUpdatedAt,
        hookStatus?.lastWorkingAt || 0,
        hookStatus?.lastDoneAt || 0
    );
    if (timestamp > 0) return new Date(timestamp);
    const fallback = liveActivity?.updatedAt || hookStatus?.lastActivityAt || 0;
    return fallback > 0 ? new Date(fallback) : getActivityTimestamp(session, uiState);
}

function buildHistoryEventFromEnvelope(session, event) {
    const text = normalizeHistoryText(event?.text, 180);
    if (!session?.id || !text) return null;
    const occurredAtMs = normalizeTimestamp(event.occurredAt || event.timestamp || event.updatedAt, Date.now());
    const actor = event.actor || 'user';
    const kind = event.kind || (actor === 'user' ? 'user_prompt' : 'agent_working');
    const textSource = event.textSource || (actor === 'user' ? 'raw_prompt' : 'structured_field');
    const evidenceSource = event.evidenceSource || 'session_state';
    const dedupeKey = event.dedupeKey || `${session.id}:${kind}:${stableHash(`${text}:${occurredAtMs}`)}`;

    return {
        id: event.id || `history-${stableHash(`${session.id}:${dedupeKey}`)}`,
        sessionId: session.id,
        timestamp: new Date(occurredAtMs),
        label: session.name || session.id,
        icon: historyIcon(actor, kind),
        statusTone: historyTone(actor, kind),
        statusText: historyKindLabel(kind),
        actor,
        kind,
        text,
        textSource,
        evidenceSource,
        provenanceLabel: provenanceLabel(textSource, evidenceSource),
        dedupeKey
    };
}

function buildHistoryEventFromLiveActivity(session, uiState, liveActivity, status, taskBrief) {
    if (!session?.id) return null;
    const timestamp = getActivityEventTimestamp(session, uiState, liveActivity);
    const text = normalizeHistoryText(
        liveActivity?.currentStep
            || liveActivity?.latestEvidence
            || liveActivity?.assistantSnippet
            || taskBrief
            || status?.text,
        180
    );
    if (!text) return null;
    const kind = status?.tone === 'waiting'
        ? 'agent_waiting'
        : status?.tone === 'done'
            ? 'agent_done'
            : status?.tone === 'blocked'
                ? 'agent_blocked'
                : 'agent_working';
    const dedupeKey = [
        session.id,
        liveActivity ? 'activity_report' : 'session_status',
        liveActivity?.activityKind || '',
        kind,
        stableHash(text)
    ].join(':');
    return {
        id: `activity-${stableHash(dedupeKey)}`,
        sessionId: session.id,
        timestamp,
        label: session.name || session.id,
        icon: historyIcon('agent', kind),
        statusTone: historyTone('agent', kind),
        statusText: historyKindLabel(kind),
        actor: 'agent',
        kind,
        text,
        textSource: 'structured_field',
        evidenceSource: liveActivity ? 'activity_report' : 'session_state',
        provenanceLabel: provenanceLabel('structured_field', liveActivity ? 'activity_report' : 'session_state'),
        dedupeKey
    };
}

export class LiveFeedService {
    /** @param {{ store?: any }} [config] */
    constructor({ store } = {}) {
        this.store = store || appStore;
        this.entries = [];
        this._listeners = [];
        this._unsubscribers = [];
        this._fingerprints = new Map();
        this._movementKeys = new Map();
        this._staleRefreshTimer = null;
        this._started = false;
    }

    start() {
        if (this._started) return;
        this._started = true;

        this._refreshEntries({ initial: true });
        const unsubStore = this.store.subscribe(() => {
            this._refreshEntries();
        });
        this._unsubscribers.push(unsubStore);
        if (typeof setInterval === 'function') {
            this._staleRefreshTimer = setInterval(() => {
                this._refreshEntries({ force: true });
            }, STALE_REFRESH_MS);
        }
    }

    stop() {
        this._unsubscribers.forEach(fn => fn());
        this._unsubscribers = [];
        if (this._staleRefreshTimer) {
            clearInterval(this._staleRefreshTimer);
            this._staleRefreshTimer = null;
        }
        this._started = false;
    }

    _refreshEntries({ initial = false, force = false } = {}) {
        const state = this.store.getState();
        const sessions = Array.isArray(state.sessions) ? state.sessions : [];
        const activeSessionIds = new Set();
        const entryUpdates = [];

        for (const session of sessions) {
            if (!session?.id || session.intendedState === 'archived') continue;
            activeSessionIds.add(session.id);

            const uiState = deriveSessionUiState(session.id);
            const fingerprint = buildFingerprint(session, uiState);
            const previousFingerprint = this._fingerprints.get(session.id);

            const timestamp = getActivityTimestamp(session, uiState);
            const timestampMs = timestamp.getTime();
            const liveActivity = uiState.hookStatus?.liveActivity || null;
            const status = buildStatus(uiState, timestampMs);
            const taskBrief = buildTaskBrief(session, uiState, liveActivity);
            const movementKey = buildMovementKey(session, uiState, status, taskBrief);
            const previousMovementKey = this._movementKeys.get(session.id);

            if (!initial && !force && previousFingerprint === fingerprint) {
                continue;
            }
            const entry = {
                id: session.id,
                sessionId: session.id,
                timestamp,
                label: session.name || session.id,
                icon: status.icon,
                statusTone: status.tone,
                taskBrief,
                currentStep: buildCurrentStep(session, uiState, liveActivity, status),
                latestEvidence: buildLatestEvidence(session, uiState, liveActivity, status),
                statusText: status.text
            };

            const previousEntry = this.entries.find((item) => item.sessionId === session.id);
            const previousContentKey = previousEntry ? JSON.stringify({
                timestamp: previousEntry.timestamp?.getTime?.() || 0,
                icon: previousEntry.icon || '',
                statusTone: previousEntry.statusTone || '',
                taskBrief: previousEntry.taskBrief || '',
                currentStep: previousEntry.currentStep || '',
                latestEvidence: previousEntry.latestEvidence || '',
                statusText: previousEntry.statusText || ''
            }) : '';
            const nextContentKey = JSON.stringify({
                timestamp: entry.timestamp.getTime(),
                icon: entry.icon || '',
                statusTone: entry.statusTone || '',
                taskBrief: entry.taskBrief || '',
                currentStep: entry.currentStep || '',
                latestEvidence: entry.latestEvidence || '',
                statusText: entry.statusText || ''
            });
            if (!initial && force && previousFingerprint === fingerprint && previousMovementKey === movementKey && previousContentKey === nextContentKey) {
                continue;
            }

            this._fingerprints.set(session.id, fingerprint);
            this._movementKeys.set(session.id, movementKey);
            entryUpdates.push({
                entry,
                shouldMove: initial || !previousMovementKey || previousMovementKey !== movementKey
            });
        }

        const previousEntryCount = this.entries.length;
        for (const sessionId of Array.from(this._fingerprints.keys())) {
            if (!activeSessionIds.has(sessionId)) {
                this._fingerprints.delete(sessionId);
                this._movementKeys.delete(sessionId);
            }
        }
        this.entries = this.entries.filter((entry) => activeSessionIds.has(entry.sessionId));

        if (entryUpdates.length === 0) {
            if (this.entries.length !== previousEntryCount) {
                this._notify(null);
            }
            return;
        }

        this._applyEntryUpdates(entryUpdates);
    }

    _applyEntryUpdates(entryUpdates) {
        const moveUpdates = [];

        for (const [sourceIndex, update] of entryUpdates.entries()) {
            if (update.shouldMove) {
                moveUpdates.push({ entry: update.entry, sourceIndex });
                continue;
            }
            const index = this.entries.findIndex((item) => item.sessionId === update.entry.sessionId);
            if (index >= 0) {
                this.entries[index] = update.entry;
            } else {
                moveUpdates.push({ entry: update.entry, sourceIndex });
            }
        }

        moveUpdates.sort((a, b) => {
            const timestampDiff = a.entry.timestamp.getTime() - b.entry.timestamp.getTime();
            if (timestampDiff !== 0) return timestampDiff;
            return b.sourceIndex - a.sourceIndex;
        });
        for (const { entry } of moveUpdates) {
            this.entries = this.entries.filter((item) => item.sessionId !== entry.sessionId);
            this.entries.unshift(entry);
        }

        if (this.entries.length > MAX_ENTRIES) {
            this.entries.length = MAX_ENTRIES;
        }
        this._notify(moveUpdates[moveUpdates.length - 1]?.entry || entryUpdates[entryUpdates.length - 1]?.entry || null);
    }

    onEntry(callback) {
        this._listeners.push(callback);
        return () => {
            this._listeners = this._listeners.filter(fn => fn !== callback);
        };
    }

    _notify(entry) {
        for (const fn of this._listeners) {
            try {
                fn(entry);
            } catch {
                // noop
            }
        }
    }

    getEntries() {
        return this.entries;
    }

    getHistoryEntries({ mode = 'all', sessionId = null } = {}) {
        const state = this.store.getState();
        const sessions = Array.isArray(state.sessions) ? state.sessions : [];
        const events = [];
        const seen = new Set();

        for (const session of sessions) {
            if (!session?.id || session.intendedState === 'archived') continue;
            if (mode === 'session' && sessionId && session.id !== sessionId) continue;

            const uiState = deriveSessionUiState(session.id);
            const liveActivity = uiState.hookStatus?.liveActivity || null;
            const status = buildStatus(uiState, getActivityTimestamp(session, uiState).getTime());
            const taskBrief = buildTaskBrief(session, uiState, liveActivity);
            const sourceEvents = Array.isArray(session.activityHistory) ? session.activityHistory : [];

            for (const sourceEvent of sourceEvents) {
                const event = buildHistoryEventFromEnvelope(session, sourceEvent);
                if (!event || seen.has(event.dedupeKey)) continue;
                seen.add(event.dedupeKey);
                events.push(event);
            }

            const activityEvent = buildHistoryEventFromLiveActivity(session, uiState, liveActivity, status, taskBrief);
            if (activityEvent && !seen.has(activityEvent.dedupeKey)) {
                seen.add(activityEvent.dedupeKey);
                events.push(activityEvent);
            }
        }

        events.sort((a, b) => {
            const timestampDiff = b.timestamp.getTime() - a.timestamp.getTime();
            if (timestampDiff !== 0) return mode === 'session' ? -timestampDiff : timestampDiff;
            return String(a.id).localeCompare(String(b.id));
        });

        return events.slice(0, MAX_HISTORY_ENTRIES);
    }

    getSessionHistoryGroups({ limitPerSession = 5 } = {}) {
        const state = this.store.getState();
        const sessions = Array.isArray(state.sessions) ? state.sessions : [];
        return sessions
            .filter((session) => session?.id && session.intendedState !== 'archived')
            .map((session) => {
                const entries = this.getHistoryEntries({ mode: 'session', sessionId: session.id })
                    .slice(-limitPerSession);
                return {
                    sessionId: session.id,
                    label: session.name || session.id,
                    entries,
                    latestTimestamp: entries[entries.length - 1]?.timestamp || null
                };
            })
            .filter((group) => group.entries.length > 0)
            .slice(0, MAX_HISTORY_ENTRIES);
    }
}
