// @ts-check
/**
 * Live Feed Service
 * セッションごとの現在アクティビティを「仕事カード」として提供する。
 */
import { appStore } from '../../core/store.js';
import { deriveSessionUiState } from '../../session-ui-state.js';

const MAX_ENTRIES = 200;
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
}
