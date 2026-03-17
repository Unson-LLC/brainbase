import { appStore } from './core/store.js';
import { deriveActivityState } from './core/session-activity-state.js';

const RECENT_FILES_STORAGE_KEY = 'bb:session-recent-files:v1';
const MAX_STORED_RECENT_FILES = 10;

function getSessionUiRoot() {
    return appStore.getState().sessionUi || { byId: {} };
}

function setSessionUiRoot(root) {
    appStore.setState({ sessionUi: root });
}

function safeParseRecentFiles(rawValue) {
    if (!rawValue) return {};
    try {
        const parsed = JSON.parse(rawValue);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function cloneEntry(root, sessionId) {
    const current = root.byId?.[sessionId] || {};
    return { ...current };
}

function persistRecentFiles(byId) {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(RECENT_FILES_STORAGE_KEY, JSON.stringify(byId));
    } catch (error) {
        console.warn('[session-ui-state] Failed to persist recent files:', error);
    }
}

export function hydrateSessionRecentFiles() {
    if (typeof localStorage === 'undefined') return;

    const raw = localStorage.getItem(RECENT_FILES_STORAGE_KEY);
    const recentFilesById = safeParseRecentFiles(raw);
    const root = getSessionUiRoot();
    const nextById = { ...(root.byId || {}) };

    for (const [sessionId, recentFiles] of Object.entries(recentFilesById)) {
        const entry = cloneEntry(root, sessionId);
        entry.recentFiles = Array.isArray(recentFiles) ? recentFiles : [];
        nextById[sessionId] = entry;
    }

    setSessionUiRoot({
        ...root,
        byId: nextById
    });
}

export function pruneSessionUiState(activeSessionIds = []) {
    const keep = new Set(activeSessionIds);
    const root = getSessionUiRoot();
    const nextById = {};

    for (const [sessionId, entry] of Object.entries(root.byId || {})) {
        if (keep.has(sessionId)) {
            nextById[sessionId] = entry;
        }
    }

    setSessionUiRoot({
        ...root,
        byId: nextById
    });
}

export function mergeSessionUiEntry(sessionId, updates) {
    if (!sessionId) return;
    const root = getSessionUiRoot();
    const entry = cloneEntry(root, sessionId);
    const nextEntry = {
        ...entry,
        ...updates
    };

    setSessionUiRoot({
        ...root,
        byId: {
            ...(root.byId || {}),
            [sessionId]: nextEntry
        }
    });
}

export function replaceSessionHookStatuses(statusMap = {}) {
    const root = getSessionUiRoot();
    const nextById = { ...(root.byId || {}) };
    const incomingIds = new Set(Object.keys(statusMap));

    for (const [sessionId, status] of Object.entries(statusMap)) {
        const entry = cloneEntry(root, sessionId);
        nextById[sessionId] = {
            ...entry,
            hookStatus: status
        };
    }

    for (const [sessionId, entry] of Object.entries(nextById)) {
        if (!incomingIds.has(sessionId) && entry?.hookStatus) {
            nextById[sessionId] = {
                ...entry,
                hookStatus: null
            };
        }
    }

    setSessionUiRoot({
        ...root,
        byId: nextById
    });
}

export function setSessionSummaryMap(summaryMap = {}) {
    const root = getSessionUiRoot();
    const nextById = { ...(root.byId || {}) };

    for (const [sessionId, summary] of Object.entries(summaryMap)) {
        const entry = cloneEntry(root, sessionId);
        nextById[sessionId] = {
            ...entry,
            summary
        };
    }

    setSessionUiRoot({
        ...root,
        byId: nextById
    });
}

export function getSessionUiEntry(sessionId) {
    if (!sessionId) return null;
    return getSessionUiRoot().byId?.[sessionId] || null;
}

export function getSessionStatus(sessionId) {
    return getSessionUiEntry(sessionId)?.hookStatus || null;
}

export function getSessionHookStatusMap() {
    const byId = getSessionUiRoot().byId || {};
    const hookStatusMap = {};

    for (const [sessionId, entry] of Object.entries(byId)) {
        if (entry?.hookStatus) {
            hookStatusMap[sessionId] = entry.hookStatus;
        }
    }

    return hookStatusMap;
}

export function recordRecentFileOpen(sessionId, relativePath) {
    if (!sessionId || !relativePath) return;

    const root = getSessionUiRoot();
    const entry = cloneEntry(root, sessionId);
    const previous = Array.isArray(entry.recentFiles) ? entry.recentFiles : [];
    const nextItem = {
        path: relativePath,
        label: relativePath.split('/').pop() || relativePath,
        openedAt: new Date().toISOString()
    };
    const deduped = previous.filter((item) => item?.path !== relativePath);
    const recentFiles = [nextItem, ...deduped].slice(0, MAX_STORED_RECENT_FILES);

    setSessionUiRoot({
        ...root,
        byId: {
            ...(root.byId || {}),
            [sessionId]: {
                ...entry,
                recentFiles
            }
        }
    });

    const persisted = {};
    for (const [id, uiEntry] of Object.entries(getSessionUiRoot().byId || {})) {
        if (Array.isArray(uiEntry?.recentFiles) && uiEntry.recentFiles.length > 0) {
            persisted[id] = uiEntry.recentFiles;
        }
    }
    persistRecentFiles(persisted);
}

export function deriveSessionUiState(sessionId, options = {}) {
    const state = appStore.getState();
    const session = (state.sessions || []).find((item) => item.id === sessionId);
    const entry = getSessionUiEntry(sessionId) || {};
    const hookStatus = entry.hookStatus || null;
    const currentSessionId = options.currentSessionId || state.currentSessionId;
    const isCurrent = currentSessionId === sessionId;

    const lifecycle = session?.intendedState === 'archived'
        ? 'archived'
        : session?.intendedState === 'paused'
            ? 'paused'
            : 'active';

    const activity = deriveActivityState(hookStatus);

    let transport = session?.runtimeStatus?.ttydRunning ? 'connected' : 'disconnected';
    if (isCurrent && entry.transport) {
        transport = entry.transport;
    }
    if (lifecycle !== 'active' && transport === 'connected') {
        transport = 'disconnected';
    }

    const attention = isCurrent ? (entry.attention || 'none') : 'none';

    return {
        lifecycle,
        activity,
        transport,
        attention,
        summary: entry.summary || null,
        recentFile: Array.isArray(entry.recentFiles) ? entry.recentFiles[0] || null : null,
        recentFiles: Array.isArray(entry.recentFiles) ? entry.recentFiles : [],
        hookStatus
    };
}
