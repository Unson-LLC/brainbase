import { appStore } from '../core/store.js';
import { httpClient } from '../core/http-client.js';
import { eventBus, EVENTS } from '../core/event-bus.js';
import { appendViewerIdToProxyPath } from '../core/terminal-viewer.js';
import { shouldUseXtermTransport } from '../core/terminal-transport-client.js';
import { updateSessionIndicators } from '../session-indicators.js';
import { isBrowserPreviewablePath, resolvePreviewRelativePath } from '../file-preview-config.js';
import { showInfo, showError } from '../toast.js';
import { buildTerminalBlockedText, formatTerminalTimestamp, isLoopbackHost } from '../terminal/terminal-reconnect-manager.js';
import { ansiToHtml } from '../utils/ansi-to-html.js';
import { getSessionUiEntry, mergeSessionUiEntry } from '../session-ui-state.js';

export function applyTerminalInputUxMixin(AppClass) {
    AppClass.prototype._setCurrentSessionUiState = function(updates = {}, options = {}) {
        const sessionId = appStore.getState().currentSessionId;
        if (!sessionId) return;
        const { emit = false } = options;
        const previous = getSessionUiEntry(sessionId) || {};
        const changed = Object.entries(updates).some(([key, value]) => previous?.[key] !== value);
        if (!changed) return;
        mergeSessionUiEntry(sessionId, updates);
        if (emit) {
            void eventBus.emit(EVENTS.SESSION_UI_STATE_CHANGED, { sessionIds: [sessionId] });
        }
    };

    AppClass.prototype.refreshSessionUiSummaries = async function(sessionIds = []) {
        return await this.sessionService.refreshSessionUiSummaries(sessionIds);
    };

    AppClass.prototype._collectVisibleSessionIds = function(container) {
        if (!container || !container.isConnected) return [];
        const containerRect = container.getBoundingClientRect();
        if (containerRect.width <= 0 || containerRect.height <= 0) return [];

        return Array.from(container.querySelectorAll('.session-child-row[data-id]'))
            .filter((row) => {
                const rect = row.getBoundingClientRect();
                return rect.height > 0
                    && rect.bottom >= containerRect.top
                    && rect.top <= containerRect.bottom;
            })
            .map((row) => row.dataset.id)
            .filter(Boolean);
    };

    AppClass.prototype._getSessionUiSummaryRefreshIds = function() {
        const ids = new Set();
        const state = appStore.getState();
        if (state.currentSessionId) {
            ids.add(state.currentSessionId);
        }

        for (const containerId of ['session-list', 'mobile-session-list']) {
            const container = document.getElementById(containerId);
            for (const sessionId of this._collectVisibleSessionIds(container)) {
                ids.add(sessionId);
            }
        }

        return Array.from(ids);
    };

    AppClass.prototype._runDeferredSessionSwitchWork = function(sessionId, switchToken) {
        if (switchToken !== this._sessionSwitchToken) return;
        if (appStore.getState().currentSessionId !== sessionId) return;

        void this.loadSessionData(sessionId);
        updateSessionIndicators(sessionId);
    };

    AppClass.prototype._getViewerProxyPath = function(proxyPath, port = null) {
        if (!proxyPath) return proxyPath;

        let nextProxyPath = appendViewerIdToProxyPath(proxyPath, this.viewerId);
        if (!nextProxyPath) return nextProxyPath;

        try {
            const absoluteUrl = new URL(nextProxyPath);
            if (this.viewerId && !absoluteUrl.searchParams.has('viewerId')) {
                absoluteUrl.searchParams.set('viewerId', this.viewerId);
            }
            return absoluteUrl.toString();
        } catch {
            // Relative path: fall through and optionally rewrite to loopback ttyd.
        }

        if (port && isLoopbackHost(window.location.hostname)) {
            return `http://127.0.0.1:${port}${nextProxyPath}`;
        }

        return nextProxyPath;
    };

    AppClass.prototype._buildTerminalFrameUrl = function(proxyPath, port = null) {
        return this._getViewerProxyPath(proxyPath, port);
    };

    AppClass.prototype._buildTerminalStartPayload = function(session) {
        const payload = {
            sessionId: session.id,
            initialCommand: session.initialCommand || '',
            cwd: session.path,
            engine: session.engine || 'claude',
            viewerId: this.viewerId,
            viewerLabel: this.viewerLabel
        };
        return payload;
    };

    AppClass.prototype._recoverSessionRuntime = async function(session) {
        if (!session?.id) return null;
        return await httpClient.post(`/api/sessions/${encodeURIComponent(session.id)}/recover`, {
            viewerId: this.viewerId,
            viewerLabel: this.viewerLabel,
            engine: session.engine || 'claude',
            initialCommand: session.initialCommand || '',
            cwd: session.path
        });
    };

    AppClass.prototype.releaseTerminalOwnership = async function(sessionId) {
        if (!sessionId) return;
        try {
            await httpClient.post(`/api/sessions/${encodeURIComponent(sessionId)}/release-terminal`, {
                viewerId: this.viewerId
            });
        } catch (error) {
            // best-effort only
        }
    };

    AppClass.prototype._connectXtermTransport = async function(session) {
        if (!this.terminalTransportClient || !session?.id) {
            return { ok: false };
        }

        this._showXtermTransport();
        this.terminalTransportClient.show();
        this.terminalFrame?.classList.add('hidden');

        try {
            const firstAttempt = await this.terminalTransportClient.connect(session.id);
            if (firstAttempt?.mode === 'blocked') {
                return { ok: false, blocked: true, terminalAccess: firstAttempt.terminalAccess || null };
            }
            this.hideTerminalLoadingOverlay();
            return { ok: true };
        } catch (error) {
            console.warn('Xterm transport unavailable:', error);
            this.terminalTransportClient.disconnect({ preserveView: false });
            this.terminalTransportClient.show();
            this._showXtermTransport();
            this._terminalTransportStatus = {
                mode: 'disconnected',
                copyMode: false,
                blockedAccess: null,
                connected: false,
                isFocused: false,
                lastSnapshotAt: null,
                transport: 'streaming'
            };
            this._updateTerminalInputStatus();
            return { ok: false, error };
        }
    };

    AppClass.prototype._ensureDesktopTerminalRuntime = async function(session, runtimeStatus = null) {
        if (!session?.id) return null;
        const currentRuntimeStatus = runtimeStatus || session.runtimeStatus || null;
        if (currentRuntimeStatus?.recoveryState === 'broken') {
            const error = new Error('Session is broken and cannot be recovered automatically.');
            error.code = 'SESSION_BROKEN';
            error.recoveryState = 'broken';
            error.recoveryReason = currentRuntimeStatus?.recoveryReason || null;
            throw error;
        }
        if (currentRuntimeStatus?.recoveryState === 'recoverable') {
            await this._recoverSessionRuntime(session);
        }
        const ensurePayload = {
            initialCommand: session.initialCommand || '',
            cwd: session.path,
            engine: session.engine || 'claude',
            viewerId: this.viewerId
        };
        try {
            return await httpClient.post(`/api/sessions/${encodeURIComponent(session.id)}/terminal/ensure`, ensurePayload);
        } catch (error) {
            if (error?.recoveryState !== 'recoverable') {
                throw error;
            }
            await this._recoverSessionRuntime(session);
            return await httpClient.post(`/api/sessions/${encodeURIComponent(session.id)}/terminal/ensure`, ensurePayload);
        }
    };

    AppClass.prototype._preferXtermForCurrentSession = async function() {
        const sessionId = appStore.getState().currentSessionId;
        if (!sessionId) return false;
        if (!this._shouldUseXtermTransport() || !this.terminalTransportClient || !this.terminalXtermHost) {
            return false;
        }

        const { sessions } = appStore.getState();
        const session = (sessions || []).find(item => item.id === sessionId);
        if (!session || session.intendedState === 'archived') {
            return false;
        }

        if (this._isXtermTransportActive(sessionId)) {
            return false;
        }

        await this.switchSession(sessionId);
        return true;
    };

    AppClass.prototype.takeOverCurrentTerminal = async function() {
        const sessionId = appStore.getState().currentSessionId;
        if (!sessionId) return;

        const { sessions } = appStore.getState();
        const session = (sessions || []).find(item => item.id === sessionId);
        if (!session) return;

        const payload = {
            ...this._buildTerminalStartPayload(session),
            forceTakeover: true
        };

        try {
            const res = await httpClient.post('/api/sessions/start', payload);
            if (this._shouldUseXtermTransport() && this.terminalTransportClient) {
                const transportResult = await this._connectXtermTransport(session);
                if (transportResult.ok) {
                    this._updateTerminalInputStatus();
                    showInfo('ターミナルを引き継いだよ');
                    return;
                }
            }

            if (res?.proxyPath) {
                this.reconnectManager?.setCurrentSession(sessionId);
                if (this.reconnectManager) {
                    this.reconnectManager.terminalAccess = res.terminalAccess || {
                        state: 'owner',
                        ownerViewerLabel: this.viewerLabel,
                        ownerLastSeenAt: new Date().toISOString(),
                        canTakeover: false
                    };
                }
                this._terminalLastNavigateAt = Date.now();
                if (this._mobileTerminalMode === 'interactive' && this.mobileLiveTerminalFrameEl) {
                    this.mobileLiveTerminalFrameEl.src = this._getViewerProxyPath(res.proxyPath);
                    this.scheduleTerminalFrameLayoutSync(this._latestMobileViewportLayout);
                } else if (!this.isMobile() && this.terminalFrame) {
                    this.terminalFrame.src = this._getViewerProxyPath(res.proxyPath);
                } else {
                    this._syncMobileSnapshotPolling({ immediate: true, force: true });
                }
                this._updateTerminalInputStatus();
                showInfo('ターミナルを引き継いだよ');
            }
        } catch (error) {
            console.error('Failed to take over terminal:', error);
            showError('ターミナルの引き継ぎに失敗した');
        }
    };

    AppClass.prototype._setTerminalInputStatus = function({ hidden, stateClass, text, title }) {
        const el = this.terminalInputStatusEl;
        if (!el) return;

        // 前回と同じならDOM操作スキップ
        const key = hidden ? 'hidden' : `${stateClass}|${text}|${title}`;
        if (this._lastTerminalStatusKey === key) return;
        this._lastTerminalStatusKey = key;

        const classes = ['ready', 'needs-focus', 'reconnecting', 'disconnected', 'blocked', 'copy-mode'];
        el.classList.remove(...classes);

        if (hidden) {
            el.classList.add('hidden');
            el.textContent = '';
            el.title = '';
            return;
        }

        el.classList.remove('hidden');
        if (stateClass) el.classList.add(stateClass);
        el.textContent = text || '';
        el.title = title || '';
    };

    AppClass.prototype._setTerminalHeaderChip = function(el, { hidden = false, text = '', title = '' } = {}) {
        if (!el) return;
        const key = hidden || !text ? 'hidden' : `${text}|${title}`;
        const cacheKey = el.id || el.className;
        if (!this._terminalChipCache) this._terminalChipCache = new Map();
        if (this._terminalChipCache.get(cacheKey) === key) return;
        this._terminalChipCache.set(cacheKey, key);

        if (hidden || !text) {
            el.classList.add('hidden');
            el.textContent = '';
            el.title = '';
            return;
        }

        el.classList.remove('hidden');
        el.textContent = text;
        el.title = title || '';
    };

    AppClass.prototype._setTerminalHeaderAction = function(button, visible) {
        if (!button) return;
        button.classList.toggle('hidden', !visible);
    };

    AppClass.prototype._resetTerminalChrome = function() {
        this._setTerminalHeaderChip(this.terminalTransportPillEl, { hidden: true });
        this._setTerminalHeaderChip(this.terminalOwnerLabelEl, { hidden: true });
        this._setTerminalHeaderChip(this.terminalSnapshotMetaEl, { hidden: true });
        this._setTerminalHeaderAction(this.terminalReconnectBtn, false);
        this._setTerminalHeaderAction(this.terminalTakeoverBtn, false);
        this._setTerminalHeaderAction(this.terminalOpenFallbackBtn, false);
        this._renderTerminalSnapshotPanel({ visible: false });
    };

    AppClass.prototype._loadTerminalSnapshot = async function(sessionId, { force = false, mode = 'full' } = {}) {
        if (!sessionId) return null;
        const cached = this._terminalSnapshotCache.get(sessionId);
        const cachedMode = cached?.mode === 'full' ? 'full' : 'fast';
        const cacheSatisfiesMode = mode === 'fast'
            ? Boolean(cached)
            : cachedMode === 'full';
        if (cached && !force && cacheSatisfiesMode) {
            return cached;
        }

        const inFlight = this._terminalSnapshotRequests.get(sessionId) || null;
        if (inFlight) {
            const inFlightSatisfiesMode = mode === 'fast'
                ? true
                : inFlight.mode === 'full';
            if (inFlightSatisfiesMode) {
                return inFlight.promise;
            }
        }

        const requestKey = `${sessionId}:${mode}:${force ? 'force' : 'cached'}:${Date.now()}`;
        this._terminalSnapshotRequestKeys.set(sessionId, requestKey);
        const requestPromise = (async () => {
            const res = await httpClient.get(
                `/api/sessions/${encodeURIComponent(sessionId)}/terminal/snapshot?viewerId=${encodeURIComponent(this.viewerId)}&viewerLabel=${encodeURIComponent(this.viewerLabel)}&mode=${encodeURIComponent(mode)}`
            );

            if (this._terminalSnapshotRequestKeys.get(sessionId) !== requestKey) {
                return this._terminalSnapshotCache.get(sessionId) || null;
            }

            const snapshot = {
                text: typeof res?.text === 'string' ? res.text : '',
                colorText: typeof res?.colorText === 'string' ? res.colorText : null,
                capturedAt: res?.capturedAt || null,
                mode: res?.mode === 'fast' ? 'fast' : 'full',
                source: typeof res?.source === 'string' ? res.source : 'capture',
                stale: Boolean(res?.stale)
            };
            this._cacheTerminalSnapshot(sessionId, snapshot);
            return snapshot;
        })();
        this._terminalSnapshotRequests.set(sessionId, { mode, promise: requestPromise });
        try {
            return await requestPromise;
        } finally {
            if (this._terminalSnapshotRequests.get(sessionId)?.promise === requestPromise) {
                this._terminalSnapshotRequests.delete(sessionId);
            }
        }
    };

    AppClass.prototype._cacheTerminalSnapshot = function(sessionId, snapshot) {
        if (!sessionId || !snapshot) return null;
        const normalized = {
            text: typeof snapshot?.text === 'string' ? snapshot.text : '',
            colorText: typeof snapshot?.colorText === 'string' ? snapshot.colorText : null,
            capturedAt: snapshot?.capturedAt || null,
            mode: snapshot?.mode === 'fast' ? 'fast' : 'full',
            source: typeof snapshot?.source === 'string' ? snapshot.source : 'capture',
            stale: Boolean(snapshot?.stale)
        };
        this._terminalSnapshotCache.set(sessionId, normalized);
        return normalized;
    };

    AppClass.prototype._getSnapshotPrefetchCandidates = function(limit = 8) {
        const { sessions = [] } = appStore.getState();
        const visibleIds = [];
        for (const containerId of ['session-list', 'mobile-session-list']) {
            const container = document.getElementById(containerId);
            for (const sessionId of this._collectVisibleSessionIds(container)) {
                if (!visibleIds.includes(sessionId)) {
                    visibleIds.push(sessionId);
                }
            }
        }

        const nonArchived = sessions.filter((session) => session?.id && session.intendedState !== 'archived');
        const sourceSessions = visibleIds.length > 0
            ? visibleIds
                .map((id) => nonArchived.find((session) => session.id === id))
                .filter(Boolean)
            : nonArchived;

        const rank = (session) => {
            if (session.intendedState === 'active') return 0;
            if (session.intendedState === 'paused') return 1;
            return 2;
        };

        return sourceSessions
            .slice()
            .sort((a, b) => rank(a) - rank(b))
            .filter((session) => {
                const cached = this._terminalSnapshotCache.get(session.id);
                return cached?.mode !== 'full';
            })
            .slice(0, limit)
            .map((session) => session.id);
    };

    AppClass.prototype._prefetchTerminalSnapshots = async function(sessionIds = []) {
        const queue = Array.from(new Set((sessionIds || []).filter(Boolean))).filter(
            (sessionId) => !this._snapshotPrefetchInFlight.has(sessionId)
        );
        if (queue.length === 0) return;

        const maxConcurrency = 2;
        let index = 0;
        const worker = async () => {
            while (index < queue.length) {
                const sessionId = queue[index++];
                this._snapshotPrefetchInFlight.add(sessionId);
                try {
                    const cached = this._terminalSnapshotCache.get(sessionId);
                    if (cached?.mode !== 'full') {
                        await this._loadTerminalSnapshot(sessionId, { mode: 'fast' });
                    }
                } catch {
                    // best-effort prefetch only
                } finally {
                    this._snapshotPrefetchInFlight.delete(sessionId);
                }
            }
        };

        await Promise.all(
            Array.from({ length: Math.min(maxConcurrency, queue.length) }, () => worker())
        );
    };

    AppClass.prototype._scheduleSnapshotPrefetch = function() {
        if (this._snapshotPrefetchScheduled) return;
        this._snapshotPrefetchScheduled = true;
        const run = () => {
            this._snapshotPrefetchScheduled = false;
            const candidates = this._getSnapshotPrefetchCandidates(8);
            void this._prefetchTerminalSnapshots(candidates);
        };

        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(() => {
                requestAnimationFrame(run);
            }, { timeout: 750 });
            return;
        }

        window.setTimeout(() => {
            requestAnimationFrame(run);
        }, 0);
    };

    AppClass.prototype._renderTerminalSnapshotPanel = function({ visible = false, snapshot = null, title = 'Snapshot fallback' } = {}) {
        this._cacheTerminalUiElements();
        if (!this.terminalSnapshotPanelEl || !this.terminalSnapshotContentEl) return;

        // 前回と同じ内容ならDOM操作スキップ
        const snapshotKey = visible
            ? `v|${title}|${snapshot?.capturedAt || ''}|${snapshot?.colorText?.length || snapshot?.text?.length || 0}`
            : 'hidden';
        if (this._lastSnapshotPanelKey === snapshotKey) return;
        this._lastSnapshotPanelKey = snapshotKey;

        if (!visible) {
            this.terminalSnapshotPanelEl.classList.add('hidden');
            this.terminalSnapshotContentEl.textContent = '';
            if (this.terminalSnapshotTimestampEl) {
                this.terminalSnapshotTimestampEl.textContent = '';
            }
            return;
        }

        this.terminalSnapshotPanelEl.classList.remove('hidden');
        if (this.terminalSnapshotTitleEl) {
            this.terminalSnapshotTitleEl.textContent = title;
        }
        const snapshotText = this._normalizeTerminalSnapshotText(snapshot?.text);
        if (snapshot?.colorText) {
            this.terminalSnapshotContentEl.innerHTML = ansiToHtml(snapshot.colorText);
        } else {
            this.terminalSnapshotContentEl.textContent = snapshotText || 'Snapshotを読み込み中...';
        }
        if (this.terminalSnapshotTimestampEl) {
            this.terminalSnapshotTimestampEl.textContent = formatTerminalTimestamp(snapshot?.capturedAt);
        }
        this.terminalSnapshotContentEl.scrollTop = this.terminalSnapshotContentEl.scrollHeight;
        this._bindSnapshotLinks();
    };

    AppClass.prototype._bindSnapshotLinks = function() {
        if (!this.terminalSnapshotContentEl) return;

        this.terminalSnapshotContentEl.querySelectorAll('.snapshot-url-link').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.open(el.href, '_blank', 'noopener');
            });
        });

        this.terminalSnapshotContentEl.querySelectorAll('.snapshot-file-link').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const filePath = el.dataset.path;
                if (!filePath) return;
                const line = el.dataset.line ? parseInt(el.dataset.line, 10) : undefined;
                window.postMessage({
                    type: 'OPEN_FILE',
                    filePath,
                    line,
                    sessionId: appStore.getState().currentSessionId
                }, window.location.origin);
            });
        });
    };

    AppClass.prototype._normalizeTerminalSnapshotText = function(text) {
        if (typeof text !== 'string') return '';
        return text
            .replace(/\r\n/g, '\n')
            .replace(/^(?:\s*\n)+/, '')
            .replace(/(?:\n[ \t]*){3,}/g, '\n\n')
            .trimEnd();
    };

    AppClass.prototype._syncTerminalSnapshotPanel = function({ sessionId, visible, title }) {
        if (!visible || !sessionId) {
            this._renderTerminalSnapshotPanel({ visible: false });
            return;
        }

        const cached = this._terminalSnapshotCache.get(sessionId) || null;
        this._renderTerminalSnapshotPanel({
            visible: true,
            snapshot: cached,
            title
        });

        if (cached) return;

        void this._loadTerminalSnapshot(sessionId)
            .then((snapshot) => {
                if (appStore.getState().currentSessionId !== sessionId) return;
                this._renderTerminalSnapshotPanel({
                    visible: true,
                    snapshot,
                    title
                });
                this._updateTerminalInputStatus();
            })
            .catch(() => {
                if (appStore.getState().currentSessionId !== sessionId) return;
                this._renderTerminalSnapshotPanel({
                    visible: true,
                    snapshot: {
                        text: 'Snapshotの取得に失敗した',
                        capturedAt: null
                    },
                    title
                });
            });
    };

    AppClass.prototype.openTerminalIframeFallback = async function() {
        const sessionId = appStore.getState().currentSessionId;
        if (!sessionId) return;
        this._terminalSnapshotCache.delete(sessionId);
        await this.switchSession(sessionId, { forceTtyd: true });
    };

    AppClass.prototype._scheduleTerminalInputStatusUpdate = function() {
        if (this._terminalStatusRafId) return;
        this._terminalStatusRafId = requestAnimationFrame(() => {
            this._terminalStatusRafId = null;
            this._updateTerminalInputStatus();
        });
    };

    AppClass.prototype._updateTerminalInputStatus = function() {
        this._cacheTerminalUiElements();
        if (!this.terminalInputStatusEl) return;

        if (!this._isConsoleVisible()) {
            this._setTerminalInputStatus({ hidden: true });
            this._resetTerminalChrome();
            return;
        }

        const sessionId = appStore.getState().currentSessionId;
        const frame = this._mobileTerminalMode === 'interactive'
            ? this.mobileLiveTerminalFrameEl || document.getElementById('mobile-live-terminal-frame')
            : this.terminalFrame || document.getElementById('terminal-frame');
        const xtermStatus = this._terminalTransportStatus || null;
        const xtermActive = this._isXtermTransportActive(sessionId);
        const usingMobileDisplay = this._isMobileTerminalDisplayMode();
        const session = this._getSessionById(sessionId);

        if (!sessionId || (!frame && !xtermActive)) {
            this._setTerminalInputStatus({ hidden: true });
            this._resetTerminalChrome();
            return;
        }

        const overlayState = this._getTerminalOverlayState();
        const consoleArea = document.getElementById('console-area');
        const usingDesktopSnapshot = !usingMobileDisplay && consoleArea?.classList.contains('using-snapshot');
        const isFocused = xtermActive
            ? Boolean(xtermStatus?.isFocused)
            : document.activeElement === frame;
        const frameSrcAttr = frame?.getAttribute('src');
        const frameBlank = xtermActive
            ? false
            : (!frameSrcAttr || frameSrcAttr === 'about:blank');
        const wsConnected = Boolean(this.reconnectManager?.wsConnected);
        const isReconnecting = Boolean(this.reconnectManager?.isReconnecting);
        const terminalAccess = xtermActive
            ? (xtermStatus?.blockedAccess || null)
            : (this.reconnectManager?.terminalAccess || null);
        const isCopyMode = xtermActive
            ? Boolean(xtermStatus?.copyMode)
            : this._terminalCopyModeSessions.has(sessionId);
        const retryCount = this.reconnectManager?.retryCount ?? 0;
        const maxRetries = this.reconnectManager?.maxRetries ?? 3;
        const lastCode = this.reconnectManager?.lastDisconnectCode;
        const recentlyNavigated = this._terminalLastNavigateAt && Date.now() - this._terminalLastNavigateAt < 2500;

        // モバイルではMobile Input Dockから入力するため、iframeフォーカスは不要
        const isMobile = window.innerWidth <= 768;

        let stateClass = 'blocked';
        let text = '入力: 不明';
        let title = `session=${sessionId}`;
        let transportState = 'blocked';
        let attentionState = 'none';
        let presentationMode = 'blocked';
        let snapshotVisible = false;
        let snapshotTitle = 'Snapshot fallback';
        let ownerLabel = '';

        if (usingMobileDisplay) {
            presentationMode = 'snapshot';
            snapshotVisible = true;
            snapshotTitle = 'Terminal display';
            transportState = terminalAccess?.state === 'blocked' ? 'blocked' : 'connected';
            if (overlayState.any) {
                stateClass = 'blocked';
                if (overlayState.choiceActive) {
                    text = '入力: 選択中';
                    title = '選択UIが開いている間はターミナル入力できません';
                } else if (overlayState.dropActive) {
                    text = '入力: ドロップ待ち';
                    title = 'ファイルドロップ中はターミナル入力できません';
                } else {
                    text = '入力: メニュー表示中';
                    title = 'メニューを閉じるとターミナル入力できます';
                }
            } else if (terminalAccess?.state === 'blocked') {
                stateClass = 'blocked';
                transportState = 'blocked';
                text = buildTerminalBlockedText(terminalAccess);
                title = terminalAccess?.ownerViewerLabel
                    ? `${terminalAccess.ownerViewerLabel} がこのセッションを表示中。クリックで引き継ぎ`
                    : '別の viewer がこのセッションを表示中。クリックで引き継ぎ';
                ownerLabel = terminalAccess?.ownerViewerLabel || '';
            } else if (session?.hookStatus?.isWorking) {
                stateClass = 'ready';
                text = '入力: 表示更新中';
                title = `session=${sessionId} snapshot display`;
            } else {
                stateClass = 'ready';
                text = '入力: 表示';
                title = `session=${sessionId} snapshot display`;
            }
        } else if (overlayState.any) {
            stateClass = 'blocked';
            transportState = 'blocked';
            presentationMode = 'blocked';
            if (overlayState.choiceActive) {
                text = '入力: 選択中';
                title = '選択UIが開いている間はターミナル入力できません';
            } else if (overlayState.dropActive) {
                text = '入力: ドロップ待ち';
                title = 'ファイルドロップ中はターミナル入力できません';
            } else {
                text = '入力: メニュー表示中';
                title = 'メニューを閉じるとターミナル入力できます';
            }
        } else if (terminalAccess?.state === 'blocked') {
            stateClass = 'blocked';
            presentationMode = 'blocked';
            text = buildTerminalBlockedText(terminalAccess);
            title = terminalAccess?.ownerViewerLabel
                ? `${terminalAccess.ownerViewerLabel} がこのセッションを表示中。クリックで引き継ぎ`
                : '別の viewer がこのセッションを表示中。クリックで引き継ぎ';
            ownerLabel = terminalAccess?.ownerViewerLabel || '';
        } else if (xtermActive && xtermStatus?.mode === 'snapshot') {
            // snapshotモードでもxtermに内容が描画済みなのでlive風に見せる
            // クリックで再接続をトリガーできるようにする
            stateClass = 'needs-focus';
            transportState = 'connected';
            attentionState = 'needs-focus';
            presentationMode = 'live';
            text = '入力: クリックで再接続';
            title = `session=${sessionId} (click to reconnect)`;
        } else if (xtermActive && xtermStatus?.mode === 'reconnecting') {
            stateClass = 'reconnecting';
            transportState = 'reconnecting';
            presentationMode = 'reconnecting';
            text = '入力: 再接続中...';
            title = `session=${sessionId} xterm reconnecting`;
        } else if (xtermActive && xtermStatus?.mode === 'live') {
            presentationMode = 'live';
            if (!isFocused && !isMobile) {
                stateClass = 'needs-focus';
                transportState = 'connected';
                attentionState = 'needs-focus';
                text = '入力: クリックでフォーカス';
                title = `session=${sessionId} (click to focus)`;
            } else if (isCopyMode) {
                stateClass = 'copy-mode';
                transportState = 'connected';
                attentionState = 'copy-mode';
                text = '入力: スクロール中 (クリックで戻る)';
                title = `session=${sessionId} copy-mode (click to exit)`;
            } else {
                stateClass = 'ready';
                transportState = 'connected';
                text = '入力: Live';
                title = `session=${sessionId} xterm live`;
            }
        } else if (isReconnecting) {
            stateClass = 'reconnecting';
            transportState = 'reconnecting';
            presentationMode = 'reconnecting';
            text = `入力: 再接続中 (${retryCount}/${maxRetries})`;
            title = `session=${sessionId} reconnecting`;
        } else if (usingDesktopSnapshot && frameBlank) {
            presentationMode = 'snapshot';
            snapshotVisible = true;
            snapshotTitle = 'Terminal display';
            if (recentlyNavigated) {
                stateClass = 'reconnecting';
                transportState = 'reconnecting';
                text = '入力: 接続中...';
                title = `session=${sessionId} snapshot connecting`;
            } else {
                stateClass = 'disconnected';
                transportState = 'disconnected';
                text = '入力: 未接続';
                title = `session=${sessionId} snapshot display`;
            }
        } else if (frameBlank) {
            if (recentlyNavigated) {
                stateClass = 'reconnecting';
                transportState = 'reconnecting';
                presentationMode = 'reconnecting';
                text = '入力: 接続中...';
                title = `session=${sessionId} connecting`;
            } else {
                stateClass = 'disconnected';
                transportState = 'disconnected';
                presentationMode = 'snapshot';
                text = '入力: 未接続';
                title = `session=${sessionId} iframe=about:blank`;
                snapshotVisible = true;
            }
        } else if (!wsConnected) {
            if (recentlyNavigated) {
                stateClass = 'reconnecting';
                transportState = 'reconnecting';
                presentationMode = 'reconnecting';
                text = '入力: 接続中...';
                title = `session=${sessionId} connecting`;
            } else {
                stateClass = 'disconnected';
                transportState = 'disconnected';
                presentationMode = 'snapshot';
                text = '入力: 切断';
                title = `session=${sessionId} disconnected${typeof lastCode === 'number' ? ` (code ${lastCode})` : ''}`;
                snapshotVisible = true;
            }
        } else if (!isFocused && !isMobile) {
            // デスクトップのみ: フォーカスが外れていたらクリックを促す
            // モバイルではMobile Input Dockから入力するためフォーカス不要
            stateClass = 'needs-focus';
            transportState = 'connected';
            attentionState = 'needs-focus';
            presentationMode = 'live';
            text = '入力: クリックでフォーカス';
            title = `session=${sessionId} (click to focus)`;
        } else if (isCopyMode) {
            stateClass = 'copy-mode';
            transportState = 'connected';
            attentionState = 'copy-mode';
            presentationMode = 'live';
            text = '入力: スクロール中 (クリックで戻る)';
            title = `session=${sessionId} copy-mode (click to exit)`;
        } else {
            stateClass = 'ready';
            transportState = 'connected';
            presentationMode = 'live';
            text = '入力: OK';
            title = `session=${sessionId} connected`;
        }

        this._setTerminalInputStatus({ hidden: false, stateClass, text, title });
        const transportPillText = presentationMode === 'snapshot'
            ? 'Snapshot'
            : (xtermActive ? 'xterm' : ((usingMobileDisplay || usingDesktopSnapshot) ? 'display' : 'ttyd'));
        const transportPillTitle = presentationMode === 'snapshot'
            ? 'snapshot terminal display'
            : (xtermActive ? 'xterm transport' : ((usingMobileDisplay || usingDesktopSnapshot) ? 'snapshot terminal display' : 'ttyd iframe fallback'));
        this._setTerminalHeaderChip(this.terminalTransportPillEl, {
            hidden: false,
            text: transportPillText,
            title: transportPillTitle
        });
        this._setTerminalHeaderChip(this.terminalOwnerLabelEl, {
            hidden: !ownerLabel,
            text: ownerLabel,
            title: ownerLabel ? `現在のowner: ${ownerLabel}` : ''
        });

        const snapshotSource = this._terminalSnapshotCache.get(sessionId) || null;
        this._setTerminalHeaderChip(this.terminalSnapshotMetaEl, {
            hidden: presentationMode !== 'snapshot',
            text: snapshotSource?.capturedAt ? `Snapshot ${formatTerminalTimestamp(snapshotSource.capturedAt)}` : 'Snapshot fallback',
            title: snapshotSource?.capturedAt ? `Snapshot captured at ${snapshotSource.capturedAt}` : 'Snapshot fallback'
        });

        this._setTerminalHeaderAction(this.terminalReconnectBtn, presentationMode === 'snapshot' || presentationMode === 'reconnecting');
        this._setTerminalHeaderAction(this.terminalTakeoverBtn, terminalAccess?.state === 'blocked');
        this._setTerminalHeaderAction(
            this.terminalOpenFallbackBtn,
            xtermActive && shouldUseXtermTransport()
        );

        this._syncTerminalSnapshotPanel({
            sessionId,
            visible: snapshotVisible,
            title: snapshotTitle
        });

        const previous = getSessionUiEntry(sessionId) || {};
        const shouldEmit = previous.transport !== transportState || previous.attention !== attentionState;
        this._setCurrentSessionUiState(
            {
                transport: transportState,
                attention: attentionState
            },
            { emit: shouldEmit }
        );
    };

    AppClass.prototype._cacheTerminalUiElements = function() {
        this.terminalHeaderEl = document.getElementById('terminal-header');
        this.terminalInputStatusEl = document.getElementById('terminal-input-status');
        this.terminalTransportPillEl = document.getElementById('terminal-transport-pill');
        this.terminalOwnerLabelEl = document.getElementById('terminal-owner-label');
        this.terminalSnapshotMetaEl = document.getElementById('terminal-snapshot-meta');
        this.terminalSnapshotPanelEl = document.getElementById('terminal-snapshot-panel');
        this.terminalSnapshotTitleEl = document.getElementById('terminal-snapshot-title');
        this.terminalSnapshotTimestampEl = document.getElementById('terminal-snapshot-timestamp');
        this.terminalSnapshotContentEl = document.getElementById('terminal-snapshot-content');
        this.terminalReconnectBtn = document.getElementById('terminal-reconnect-btn');
        this.terminalTakeoverBtn = document.getElementById('terminal-takeover-btn');
        this.terminalOpenFallbackBtn = document.getElementById('terminal-open-fallback-btn');
        this.terminalMoreBtn = document.getElementById('terminal-more-btn');
        this.terminalMoreActionsEl = document.getElementById('terminal-more-actions');
        this.terminalRecoveryPanelEl = document.getElementById('terminal-recovery-panel');
        this.terminalRecoveryBadgeEl = document.getElementById('terminal-recovery-badge');
        this.terminalRecoveryTitleEl = document.getElementById('terminal-recovery-title');
        this.terminalRecoveryMessageEl = document.getElementById('terminal-recovery-message');
        this.terminalRecoverBtn = document.getElementById('terminal-recover-btn');
        this.mobileLiveTerminalModalEl = document.getElementById('mobile-live-terminal-modal');
        this.mobileLiveTerminalFrameEl = document.getElementById('mobile-live-terminal-frame');
    };

    AppClass.prototype._formatRecoveryMessage = function(session, runtimeStatus) {
        const recoveryState = runtimeStatus?.recoveryState || session?.recoveryState || null;
        const recoveryReason = runtimeStatus?.recoveryReason || session?.recoveryReason || null;
        const engine = session?.engine === 'codex' ? 'Codex' : 'Claude';

        if (recoveryState === 'broken') {
            if (recoveryReason === 'binding_missing') {
                return `${engine} の会話 binding が見つからないため、このセッションは新規起動させず停止しています。`;
            }
            if (recoveryReason === 'cwd_missing') {
                return '会話 binding はありますが、復旧先の workspace が見つからないため停止しています。';
            }
            return 'このセッションは復旧に必要な情報が不足しています。';
        }

        return 'tmux runtime が消えています。新規起動すると履歴が別セッションに化けるため、自動再生成は止めています。';
    };

    AppClass.prototype._showTerminalRecoveryPanel = function(session, runtimeStatus, { preserveSnapshot = false } = {}) {
        this._cacheTerminalUiElements();
        const panel = this.terminalRecoveryPanelEl;
        if (!panel) return;

        const recoveryState = runtimeStatus?.recoveryState || session?.recoveryState || 'recoverable';
        const canRecover = Boolean(runtimeStatus?.canRecover);
        if (this.terminalRecoveryBadgeEl) {
            this.terminalRecoveryBadgeEl.textContent = recoveryState === 'broken' ? '復旧不可' : '要復旧';
            this.terminalRecoveryBadgeEl.classList.toggle('broken', recoveryState === 'broken');
        }
        if (this.terminalRecoveryTitleEl) {
            this.terminalRecoveryTitleEl.textContent = recoveryState === 'broken'
                ? 'このセッションは自動再起動されません'
                : 'このセッションは明示復旧が必要です';
        }
        if (this.terminalRecoveryMessageEl) {
            this.terminalRecoveryMessageEl.textContent = this._formatRecoveryMessage(session, runtimeStatus);
        }
        if (this.terminalRecoverBtn) {
            this.terminalRecoverBtn.classList.toggle('hidden', !canRecover || recoveryState === 'broken');
            this.terminalRecoverBtn.disabled = !canRecover || recoveryState === 'broken';
            this.terminalRecoverBtn.dataset.sessionId = session?.id || '';
        }

        this.terminalTransportClient?.disconnect({ preserveView: false });
        this.terminalTransportClient?.hide();
        this.terminalFrame?.classList.add('hidden');
        this.terminalXtermHost?.classList.add('hidden');
        if (!preserveSnapshot) {
            this.terminalSnapshotPanelEl?.classList.add('hidden');
            const consoleArea = document.getElementById('console-area');
            consoleArea?.classList.remove('using-snapshot');
        }
        panel.classList.remove('hidden');
    };

    AppClass.prototype._hideTerminalRecoveryPanel = function() {
        this.terminalRecoveryPanelEl?.classList.add('hidden');
    };

    AppClass.prototype.setupTerminalInputUx = function() {
        if (!this.terminalFrame) return;

        this._cacheTerminalUiElements();
        const consoleArea = document.getElementById('console-area');
        const closeMobileLiveTerminalBtn = document.getElementById('close-mobile-live-terminal-btn');

        // Keep status in sync with session selection, focus changes, overlay visibility, and WS events.
        const unsub = appStore.subscribeToSelector(
            state => state.currentSessionId,
            () => {
                // Mark navigation time to show "connecting..." briefly.
                this._terminalLastNavigateAt = Date.now();
                this._scheduleTerminalInputStatusUpdate();
            }
        );
        this._terminalInputUxCleanup.push(unsub);

        const onFocusChange = () => this._scheduleTerminalInputStatusUpdate();
        document.addEventListener('focusin', onFocusChange, true);
        window.addEventListener('blur', onFocusChange);
        this._terminalInputUxCleanup.push(() => document.removeEventListener('focusin', onFocusChange, true));
        this._terminalInputUxCleanup.push(() => window.removeEventListener('blur', onFocusChange));

        // Observe overlay class changes (menu/drop/choice) to update status.
        const overlays = ['menu-overlay', 'drop-overlay', 'choice-overlay']
            .map(id => document.getElementById(id))
            .filter(Boolean);
        const observer = new MutationObserver(() => this._scheduleTerminalInputStatusUpdate());
        overlays.forEach(el => observer.observe(el, { attributes: true, attributeFilter: ['class'] }));
        this._terminalInputUxCleanup.push(() => observer.disconnect());

        // Reconnect manager status callback.
        if (this.reconnectManager) {
            this.reconnectManager.onStatusChange = () => this._scheduleTerminalInputStatusUpdate();
        }

        // Track tmux copy-mode (entered by TMUX_SCROLL; exited by TERMINAL_INTERACT).
        const onTerminalMessage = (event) => {
            // Only trust same-origin messages coming from the current terminal iframe.
            if (event.origin !== window.location.origin) return;
            if (this.terminalFrame?.contentWindow && event.source !== this.terminalFrame.contentWindow) return;

            const type = event.data?.type;
            if (type !== 'TMUX_SCROLL' && type !== 'TERMINAL_INTERACT') return;

            const sessionId = appStore.getState().currentSessionId;
            if (!sessionId) return;

            if (type === 'TMUX_SCROLL') {
                this._terminalCopyModeSessions.add(sessionId);
            } else if (type === 'TERMINAL_INTERACT') {
                this._terminalCopyModeSessions.delete(sessionId);
            }
            this._scheduleTerminalInputStatusUpdate();
        };
        window.addEventListener('message', onTerminalMessage);
        this._terminalInputUxCleanup.push(() => window.removeEventListener('message', onTerminalMessage));

        const onMobileInputSent = () => {
            if (!this._isMobileTerminalDisplayMode()) return;
            this._syncMobileSnapshotPolling({ immediate: true, force: true });
        };
        const unsubMobileInputSent = eventBus.on(EVENTS.MOBILE_INPUT_SENT, onMobileInputSent);
        this._terminalInputUxCleanup.push(unsubMobileInputSent);

        // Handle OPEN_FILE from terminal link clicks
        const onOpenFileMessage = (event) => {
            if (event.origin !== window.location.origin) return;
            if (event.data?.type !== 'OPEN_FILE') return;

            const {
                filePath,
                previewPath,
                previewable,
                line,
                sessionId: msgSessionId
            } = event.data;
            if (!filePath) return;
            console.log('[OPEN_FILE] received', {
                filePath,
                previewPath,
                previewable,
                line,
                sessionId: msgSessionId || null
            });

            const currentSessionId = msgSessionId || appStore.getState().currentSessionId;
            const session = appStore.getState().sessions.find(s => s.id === currentSessionId);
            const workspaceRoot = session?.worktree?.path || session?.path || null;
            const previewRelativePath = previewPath
                || resolvePreviewRelativePath(filePath, workspaceRoot, currentSessionId)
                || null;
            const shouldOpenInBrowser = Boolean(previewRelativePath)
                || Boolean(previewable)
                || isBrowserPreviewablePath(filePath);
            console.log('[OPEN_FILE] resolved', {
                currentSessionId,
                workspaceRoot,
                previewRelativePath,
                shouldOpenInBrowser
            });

            if (shouldOpenInBrowser && this.fileViewerService) {
                void this.fileViewerService.openFile(currentSessionId, previewRelativePath || filePath);
                if (this.isMobile() && this.mobileTabController) {
                    this.mobileTabController.showFileViewer();
                } else {
                    this.showFileViewer?.();
                }
                return;
            }

            if (this.isMobile()) return;

            fetch('/api/open-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: filePath, mode: 'file', line, sessionId: currentSessionId })
            }).catch(err => console.error('[OPEN_FILE] Error:', err));
        };
        window.addEventListener('message', onOpenFileMessage);
        this._terminalInputUxCleanup.push(() => window.removeEventListener('message', onOpenFileMessage));

        // Click-to-focus: clicking on the console background (including the menu overlay) should restore focus.
        const onConsoleClick = (e) => {
            if (!this._isConsoleVisible()) return;
            if (this._isEditableTarget(e.target)) return;

            const overlayState = this._getTerminalOverlayState();
            // Don't steal focus while modal overlays (choices/drag) are active.
            if (overlayState.choiceActive || overlayState.dropActive) return;

            // Don't steal focus when clicking toolbar buttons or other buttons.
            if (e.target?.closest?.('button')) return;

            if (this._isMobileTerminalDisplayMode()) {
                void this.openMobileLiveTerminal(appStore.getState().currentSessionId);
                return;
            }

            // snapshotモード中にクリックしたら即reconnect
            if (this._isXtermTransportActive() && this.terminalTransportClient?.status?.mode === 'snapshot') {
                void this.terminalTransportClient.reconnect().catch(() => {});
                this._updateTerminalInputStatus();
                return;
            }

            this.focusTerminal('console-click');
        };
        consoleArea?.addEventListener('click', onConsoleClick, true);
        this._terminalInputUxCleanup.push(() => consoleArea?.removeEventListener('click', onConsoleClick, true));

        const onConsoleTouchStart = (event) => {
            if (!this._isMobileTerminalDisplayMode()) return;
            if (this._isEditableTarget(event.target)) return;
            this._mobileTapTracking = {
                startX: event.touches?.[0]?.clientX ?? 0,
                startY: event.touches?.[0]?.clientY ?? 0,
                moved: false
            };
        };
        const onConsoleTouchMove = (event) => {
            if (!this._mobileTapTracking) return;
            const touch = event.touches?.[0];
            if (!touch) return;
            const dx = Math.abs(touch.clientX - this._mobileTapTracking.startX);
            const dy = Math.abs(touch.clientY - this._mobileTapTracking.startY);
            if (dx > 8 || dy > 8) {
                this._mobileTapTracking.moved = true;
            }
        };
        const onConsoleTouchEnd = (event) => {
            if (!this._isMobileTerminalDisplayMode() || !this._mobileTapTracking || this._mobileTapTracking.moved) {
                this._mobileTapTracking = null;
                return;
            }
            if (this._isEditableTarget(event.target)) {
                this._mobileTapTracking = null;
                return;
            }
            const overlayState = this._getTerminalOverlayState();
            if (!overlayState.any) {
                void this.openMobileLiveTerminal(appStore.getState().currentSessionId);
            }
            this._mobileTapTracking = null;
        };
        consoleArea?.addEventListener('touchstart', onConsoleTouchStart, { passive: true });
        consoleArea?.addEventListener('touchmove', onConsoleTouchMove, { passive: true });
        consoleArea?.addEventListener('touchend', onConsoleTouchEnd, { passive: true });
        this._terminalInputUxCleanup.push(() => consoleArea?.removeEventListener('touchstart', onConsoleTouchStart, { passive: true }));
        this._terminalInputUxCleanup.push(() => consoleArea?.removeEventListener('touchmove', onConsoleTouchMove, { passive: true }));
        this._terminalInputUxCleanup.push(() => consoleArea?.removeEventListener('touchend', onConsoleTouchEnd, { passive: true }));

        const onSnapshotClick = (event) => {
            if (!this._isMobileTerminalDisplayMode()) return;
            if (this._isEditableTarget(event.target)) return;
            if (event.target.closest('.snapshot-url-link, .snapshot-file-link')) return;
            const overlayState = this._getTerminalOverlayState();
            if (overlayState.choiceActive || overlayState.dropActive) return;
            event.stopPropagation();
            void this.openMobileLiveTerminal(appStore.getState().currentSessionId);
        };
        this.terminalSnapshotPanelEl?.addEventListener('click', onSnapshotClick, true);
        this._terminalInputUxCleanup.push(() => this.terminalSnapshotPanelEl?.removeEventListener('click', onSnapshotClick, true));

        const onSnapshotTouchStart = (event) => {
            if (!this._isMobileTerminalDisplayMode()) return;
            if (this._isEditableTarget(event.target)) return;
            if (event.target.closest('.snapshot-url-link, .snapshot-file-link')) return;
            this._mobileTapTracking = {
                startX: event.touches?.[0]?.clientX ?? 0,
                startY: event.touches?.[0]?.clientY ?? 0,
                moved: false
            };
        };
        const onSnapshotTouchMove = (event) => {
            if (!this._mobileTapTracking) return;
            const touch = event.touches?.[0];
            if (!touch) return;
            const dx = Math.abs(touch.clientX - this._mobileTapTracking.startX);
            const dy = Math.abs(touch.clientY - this._mobileTapTracking.startY);
            if (dx > 8 || dy > 8) {
                this._mobileTapTracking.moved = true;
            }
        };
        const onSnapshotTouchEnd = (event) => {
            if (!this._isMobileTerminalDisplayMode() || !this._mobileTapTracking || this._mobileTapTracking.moved) {
                this._mobileTapTracking = null;
                return;
            }
            if (this._isEditableTarget(event.target)) {
                this._mobileTapTracking = null;
                return;
            }
            const overlayState = this._getTerminalOverlayState();
            if (!overlayState.any) {
                event.stopPropagation();
                void this.openMobileLiveTerminal(appStore.getState().currentSessionId);
            }
            this._mobileTapTracking = null;
        };
        this.terminalSnapshotPanelEl?.addEventListener('touchstart', onSnapshotTouchStart, { passive: true });
        this.terminalSnapshotPanelEl?.addEventListener('touchmove', onSnapshotTouchMove, { passive: true });
        this.terminalSnapshotPanelEl?.addEventListener('touchend', onSnapshotTouchEnd, { passive: true });
        this._terminalInputUxCleanup.push(() => this.terminalSnapshotPanelEl?.removeEventListener('touchstart', onSnapshotTouchStart, { passive: true }));
        this._terminalInputUxCleanup.push(() => this.terminalSnapshotPanelEl?.removeEventListener('touchmove', onSnapshotTouchMove, { passive: true }));
        this._terminalInputUxCleanup.push(() => this.terminalSnapshotPanelEl?.removeEventListener('touchend', onSnapshotTouchEnd, { passive: true }));

        const onMobileLiveTerminalLoad = () => {
            if (this._mobileTerminalMode !== 'interactive') return;
            this.scheduleTerminalFrameLayoutSync(this._latestMobileViewportLayout);
        };
        this.mobileLiveTerminalFrameEl?.addEventListener('load', onMobileLiveTerminalLoad);
        this._terminalInputUxCleanup.push(() => this.mobileLiveTerminalFrameEl?.removeEventListener('load', onMobileLiveTerminalLoad));

        const onTerminalFrameLoad = () => {
            this._scheduleTerminalInputStatusUpdate();
            if (this._mobileTerminalMode === 'interactive') return;
            this._scheduleTerminalAutoFocus('terminal-frame-load', [60, 180]);
        };
        this.terminalFrame?.addEventListener('load', onTerminalFrameLoad);
        this._terminalInputUxCleanup.push(() => this.terminalFrame?.removeEventListener('load', onTerminalFrameLoad));

        const onMobileLiveTerminalClose = (event) => {
            event?.preventDefault?.();
            this.closeMobileLiveTerminal();
        };
        closeMobileLiveTerminalBtn?.addEventListener('click', onMobileLiveTerminalClose);
        this._terminalInputUxCleanup.push(() => closeMobileLiveTerminalBtn?.removeEventListener('click', onMobileLiveTerminalClose));

        const onMobileLiveTerminalOverlayClick = (event) => {
            if (event.target === this.mobileLiveTerminalModalEl) {
                this.closeMobileLiveTerminal();
            }
        };
        this.mobileLiveTerminalModalEl?.addEventListener('click', onMobileLiveTerminalOverlayClick);
        this._terminalInputUxCleanup.push(() => this.mobileLiveTerminalModalEl?.removeEventListener('click', onMobileLiveTerminalOverlayClick));

        const onEscapeClose = (event) => {
            if (event.key === 'Escape' && this._mobileTerminalMode === 'interactive') {
                this.closeMobileLiveTerminal();
            }
        };
        document.addEventListener('keydown', onEscapeClose);
        this._terminalInputUxCleanup.push(() => document.removeEventListener('keydown', onEscapeClose));

        // Status badge click: focus, and if disconnected, trigger reconnect.
        const onStatusClick = (e) => {
            e.preventDefault();
            const overlayState = this._getTerminalOverlayState();
            if (overlayState.any) return;

            if (this._isMobileTerminalDisplayMode()) {
                void this.openMobileLiveTerminal(appStore.getState().currentSessionId);
                return;
            }

            const xtermActive = this._isXtermTransportActive();
            if ((xtermActive && this._terminalTransportStatus?.blockedAccess?.state === 'blocked')
                || this.reconnectManager?.terminalAccess?.state === 'blocked') {
                void this.takeOverCurrentTerminal();
                return;
            }

            const sessionId = appStore.getState().currentSessionId;
            if (xtermActive && this._terminalTransportStatus?.copyMode) {
                void this.terminalTransportClient?.exitCopyMode().catch(() => {});
            } else if (sessionId && this._terminalCopyModeSessions.has(sessionId)) {
                // Best-effort: exit tmux copy-mode so input works again.
                fetch(`/api/sessions/${sessionId}/exit_copy_mode`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                }).catch(() => {});
                this._terminalCopyModeSessions.delete(sessionId);
            }

            if (xtermActive && this._terminalTransportStatus?.mode === 'snapshot') {
                void this.terminalTransportClient?.reconnect().catch(() => {});
            } else if (!this.reconnectManager?.wsConnected && !this.reconnectManager?.isReconnecting) {
                this.reconnectManager?.handleDisconnect?.();
            }

            // モバイルでは focusTerminal を呼ばない（iframe.focus() でキーボードが閉じる問題を回避）
            const isMobile = window.innerWidth <= 768;
            if (!isMobile) {
                this.focusTerminal('status-click');
            }

            this._updateTerminalInputStatus();
        };
        this.terminalInputStatusEl?.addEventListener('click', onStatusClick);
        this._terminalInputUxCleanup.push(() => this.terminalInputStatusEl?.removeEventListener('click', onStatusClick));

        const onReconnectClick = (e) => {
            e.preventDefault();
            if (this._isMobileTerminalDisplayMode()) {
                void this.openMobileLiveTerminal(appStore.getState().currentSessionId);
                return;
            }
            if (this._isXtermTransportActive()) {
                void this.terminalTransportClient?.reconnect().catch(() => {});
                return;
            }
            if (!this.reconnectManager?.isReconnecting) {
                this.reconnectManager?.handleDisconnect?.();
            }
        };
        this.terminalReconnectBtn?.addEventListener('click', onReconnectClick);
        this._terminalInputUxCleanup.push(() => this.terminalReconnectBtn?.removeEventListener('click', onReconnectClick));

        const onTakeoverClick = (e) => {
            e.preventDefault();
            void this.takeOverCurrentTerminal();
        };
        this.terminalTakeoverBtn?.addEventListener('click', onTakeoverClick);
        this._terminalInputUxCleanup.push(() => this.terminalTakeoverBtn?.removeEventListener('click', onTakeoverClick));

        const onOpenFallbackClick = (e) => {
            e.preventDefault();
            void this.openTerminalIframeFallback();
        };
        this.terminalOpenFallbackBtn?.addEventListener('click', onOpenFallbackClick);
        this._terminalInputUxCleanup.push(() => this.terminalOpenFallbackBtn?.removeEventListener('click', onOpenFallbackClick));

        const closeMoreActions = () => {
            this.terminalMoreActionsEl?.classList.remove('open');
        };
        const onMoreClick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.terminalMoreActionsEl?.classList.toggle('open');
        };
        const onDocumentClick = (e) => {
            if (!this.terminalHeaderEl?.contains(e.target)) {
                closeMoreActions();
            }
        };
        this.terminalMoreBtn?.addEventListener('click', onMoreClick);
        document.addEventListener('click', onDocumentClick, true);
        this._terminalInputUxCleanup.push(() => this.terminalMoreBtn?.removeEventListener('click', onMoreClick));
        this._terminalInputUxCleanup.push(() => document.removeEventListener('click', onDocumentClick, true));

        // Type-to-focus: if user starts typing while terminal isn't focused, focus it and inject the first key.
        const onKeydownCapture = (e) => {
            if (!this._isConsoleVisible()) return;
            if (e.defaultPrevented) return;
            if (e.isComposing) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (this._isEditableTarget(e.target)) return;

            const sessionId = appStore.getState().currentSessionId;
            if (!sessionId) return;
            if (document.activeElement === this.terminalFrame) return;
            if (this.terminalFrame?.getAttribute?.('src') === 'about:blank') return;
            if (this._isXtermTransportActive(sessionId)) return;
            if (this.reconnectManager?.terminalAccess?.state === 'blocked') return;

            const overlayState = this._getTerminalOverlayState();
            if (overlayState.any) return;

            // If the websocket is down, attempting a reconnect here reduces "typed but nothing happened".
            if (this.reconnectManager && !this.reconnectManager.wsConnected && !this.reconnectManager.isReconnecting) {
                this.reconnectManager.handleDisconnect?.();
            }

            const key = e.key;

            // Only inject safe/simple keys.
            if (key === 'Enter' && e.shiftKey) {
                this.focusTerminal('type-to-focus');
                httpClient.post(`/api/sessions/${sessionId}/input`, { input: 'M-Enter', type: 'key' }).catch(() => {});
                e.preventDefault();
                return;
            }

            if (key === 'Enter') {
                this.focusTerminal('type-to-focus');
                httpClient.post(`/api/sessions/${sessionId}/input`, { input: 'Enter', type: 'key' }).catch(() => {});
                e.preventDefault();
                return;
            }

            if (typeof key === 'string' && key.length === 1 && key !== ' ') {
                this.focusTerminal('type-to-focus');
                httpClient.post(`/api/sessions/${sessionId}/input`, { input: key, type: 'text' }).catch(() => {});
                e.preventDefault();
            }
        };
        document.addEventListener('keydown', onKeydownCapture, true);
        this._terminalInputUxCleanup.push(() => document.removeEventListener('keydown', onKeydownCapture, true));

        // Initial paint
        if (appStore.getState().currentSessionId) {
            this._terminalLastNavigateAt = Date.now();
        }
        closeMoreActions();
        this._updateTerminalInputStatus();
    };
}
