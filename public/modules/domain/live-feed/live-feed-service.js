/**
 * Live Feed Service
 * セッションごとの現在アクティビティを時系列で追える feed を提供する。
 */
import { appStore } from '../../core/store.js';
import { deriveSessionUiState } from '../../session-ui-state.js';

const MAX_ENTRIES = 200;

function buildRepoLabel(summary = {}) {
    if (!summary.repo && !summary.baseBranch) return '';
    return `${summary.repo || 'repo'}${summary.baseBranch ? `/${summary.baseBranch}` : ''}`;
}

function buildActivityCopy(session, uiState) {
    const lifecycle = uiState.lifecycle || 'active';
    const activity = uiState.activity || 'idle';
    const attention = uiState.attention || 'none';
    const recentFile = uiState.recentFile || null;
    const summary = uiState.summary || {};
    const goalSeek = uiState.goalSeek || null;
    const repoLabel = buildRepoLabel(summary);

    let status = '待機中';
    let icon = 'circle-dot';

    if (attention === 'needs-input') {
        status = recentFile?.label
            ? `${recentFile.label} について入力待ち`
            : '入力待ち';
        icon = 'message-square';
    } else if (lifecycle === 'paused') {
        status = '一時停止中';
        icon = 'pause';
    } else if (activity === 'goalseek') {
        const iteration = Number(goalSeek?.iteration || 0);
        const maxIterations = Number(goalSeek?.maxIterations || 0);
        status = iteration > 0 && maxIterations > 0
            ? `Goal Seek ${iteration}/${maxIterations} を実行中`
            : 'Goal Seek を実行中';
        icon = 'target';
    } else if (activity === 'thinking') {
        status = recentFile?.label
            ? `${recentFile.label} を処理中`
            : '応答を生成中';
        icon = 'sparkles';
    } else if (activity === 'working') {
        status = '処理を開始中';
        icon = 'play';
    } else if (activity === 'done-unread') {
        status = '応答が完了';
        icon = 'check-circle';
    } else if (uiState.transport === 'disconnected' && lifecycle === 'active') {
        status = '停止中';
        icon = 'square';
    } else if (lifecycle === 'archived') {
        status = 'アーカイブ済み';
        icon = 'archive';
    }

    const contextParts = [];
    if (repoLabel) contextParts.push(repoLabel);
    if (recentFile?.label && activity !== 'thinking' && attention !== 'needs-input') {
        contextParts.push(`直近 ${recentFile.label}`);
    }

    const detail = contextParts.length > 0
        ? `${status} · ${contextParts.join(' · ')}`
        : status;

    return { detail, icon };
}

function buildFingerprint(session, uiState) {
    const summary = uiState.summary || {};
    const recentFile = uiState.recentFile || null;
    const hookStatus = uiState.hookStatus || null;

    return JSON.stringify({
        name: session?.name || session?.id || '',
        intendedState: session?.intendedState || 'active',
        activity: uiState.activity || 'idle',
        attention: uiState.attention || 'none',
        transport: uiState.transport || 'disconnected',
        goalSeekIteration: uiState.goalSeek?.iteration || 0,
        goalSeekMaxIterations: uiState.goalSeek?.maxIterations || 0,
        repo: summary.repo || '',
        baseBranch: summary.baseBranch || '',
        recentFile: recentFile?.path || '',
        lastWorkingAt: hookStatus?.lastWorkingAt || 0,
        lastDoneAt: hookStatus?.lastDoneAt || 0,
        lastActivityAt: hookStatus?.lastActivityAt || 0,
        lastEventType: hookStatus?.lastEventType || ''
    });
}

function getActivityTimestamp(uiState) {
    const hookStatus = uiState.hookStatus || null;
    const timestamp = Math.max(
        hookStatus?.lastActivityAt || 0,
        hookStatus?.lastWorkingAt || 0,
        hookStatus?.lastDoneAt || 0
    );
    return timestamp > 0 ? new Date(timestamp) : new Date();
}

export class LiveFeedService {
    constructor({ store } = {}) {
        this.store = store || appStore;
        this.entries = [];
        this._listeners = [];
        this._unsubscribers = [];
        this._fingerprints = new Map();
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
    }

    stop() {
        this._unsubscribers.forEach(fn => fn());
        this._unsubscribers = [];
        this._started = false;
    }

    _refreshEntries({ initial = false } = {}) {
        const state = this.store.getState();
        const sessions = Array.isArray(state.sessions) ? state.sessions : [];
        const activeSessionIds = new Set();
        const nextEntries = [];

        for (const session of sessions) {
            if (!session?.id || session.intendedState === 'archived') continue;
            activeSessionIds.add(session.id);

            const uiState = deriveSessionUiState(session.id);
            const fingerprint = buildFingerprint(session, uiState);
            const previousFingerprint = this._fingerprints.get(session.id);

            if (!initial && previousFingerprint === fingerprint) {
                continue;
            }

            const { detail, icon } = buildActivityCopy(session, uiState);
            const entry = {
                id: `${session.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
                sessionId: session.id,
                timestamp: getActivityTimestamp(uiState),
                label: session.name || session.id,
                detail,
                icon
            };

            this._fingerprints.set(session.id, fingerprint);
            nextEntries.push(entry);
        }

        for (const sessionId of Array.from(this._fingerprints.keys())) {
            if (!activeSessionIds.has(sessionId)) {
                this._fingerprints.delete(sessionId);
            }
        }

        if (nextEntries.length === 0) {
            return;
        }

        nextEntries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        for (const entry of nextEntries.reverse()) {
            this._addEntry(entry);
        }
    }

    _addEntry(entry) {
        this.entries.unshift(entry);
        if (this.entries.length > MAX_ENTRIES) {
            this.entries.length = MAX_ENTRIES;
        }
        this._notify(entry);
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
