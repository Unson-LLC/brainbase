import { appStore } from '../core/store.js';
import { httpClient } from '../core/http-client.js';
import { eventBus, EVENTS } from '../core/event-bus.js';
import { buildSessionRuntimeUrl } from '../core/terminal-viewer.js';

export function applySessionManagementMixin(AppClass) {
    Object.assign(AppClass.prototype, {
        async _resolveSessionRuntime(sessionId, session) {
            const currentRuntime = session?.runtimeStatus;
            const currentAccess = this.reconnectManager?.terminalAccess || null;
            if (currentRuntime?.ttydRunning && currentRuntime?.proxyPath && currentAccess?.state !== 'blocked') {
                return {
                    runtimeStatus: {
                        ...currentRuntime,
                        proxyPath: this._getViewerProxyPath(currentRuntime.proxyPath, currentRuntime.port)
                    },
                    terminalAccess: currentAccess
                };
            }

            const runtime = await httpClient.get(buildSessionRuntimeUrl(sessionId, this.viewerId, this.viewerLabel));
            return {
                runtimeStatus: runtime?.runtimeStatus || currentRuntime || null,
                terminalAccess: runtime?.terminalAccess || currentAccess || null
            };
        },

        async _resolveTtydProxyPath(sessionId, session, options = {}) {
            let proxyPath = typeof options.proxyPath === 'string' && options.proxyPath.trim()
                ? this._getViewerProxyPath(options.proxyPath, options.port)
                : null;

            if (proxyPath) {
                return {
                    proxyPath,
                    terminalAccess: this.reconnectManager?.terminalAccess || null
                };
            }

            const { runtimeStatus, terminalAccess } = await this._resolveSessionRuntime(sessionId, session);
            if (terminalAccess?.state === 'blocked') {
                return { proxyPath: null, terminalAccess };
            }

            if (runtimeStatus?.ttydRunning && runtimeStatus?.proxyPath) {
                return {
                    proxyPath: this._getViewerProxyPath(runtimeStatus.proxyPath, runtimeStatus.port),
                    terminalAccess
                };
            }

            const res = await httpClient.post(`/api/sessions/${encodeURIComponent(session.id)}/terminal/ensure`, {
                initialCommand: session.initialCommand || '',
                cwd: session.path,
                engine: session.engine || 'claude',
                viewerId: this.viewerId,
                forceTtyd: Boolean(options.forceTtyd)
            });
            return {
                proxyPath: res?.proxyPath ? this._getViewerProxyPath(res.proxyPath, res.port) : null,
                terminalAccess: res?.terminalAccess || terminalAccess || null
            };
        },

        async _openSessionInTtydFrame(sessionId, frameEl, options = {}) {
            const session = this._getSessionById(sessionId);
            if (!session) {
                this._clearTerminalFrame(frameEl);
                return { ok: false, reason: 'missing-session' };
            }

            const { proxyPath, terminalAccess, runtimeStatus } = await this._resolveTtydProxyPath(sessionId, session, options);
            if (terminalAccess?.state === 'blocked') {
                this._clearTerminalFrame(frameEl);
                return { ok: false, blocked: true, terminalAccess };
            }

            if (!proxyPath) {
                this._clearTerminalFrame(frameEl);
                return {
                    ok: false,
                    reason: 'no-proxy-path',
                    runtimeStatus
                };
            }

            this._showTerminalFrame(frameEl);
            frameEl.src = proxyPath;
            return { ok: true, proxyPath, terminalAccess };
        },

        async openMobileLiveTerminal(sessionId) {
            if (!this.mobileLiveTerminalModalEl) {
                this.mobileLiveTerminalModalEl = document.getElementById('mobile-live-terminal-modal');
            }
            if (!this.mobileLiveTerminalFrameEl) {
                this.mobileLiveTerminalFrameEl = document.getElementById('mobile-live-terminal-frame');
            }
            if (!this.isMobile() || !this.mobileLiveTerminalModalEl || !this.mobileLiveTerminalFrameEl) return;

            const session = this._getSessionById(sessionId);
            if (!session || session.intendedState === 'archived') return;

            const result = await this._openSessionInTtydFrame(sessionId, this.mobileLiveTerminalFrameEl, { forceTtyd: true });
            if (!result.ok) {
                if (result.blocked) {
                    this.reconnectManager?.setCurrentSession(sessionId);
                    if (typeof this.reconnectManager?._setBlocked === 'function') {
                        this.reconnectManager._setBlocked(result.terminalAccess);
                    }
                    this._updateTerminalInputStatus();
                } else {
                    this.closeMobileLiveTerminal();
                }
                return;
            }

            this._mobileTerminalMode = 'interactive';
            this._mobileLiveTerminalSessionId = sessionId;
            this._stopMobileSnapshotPolling();
            this.mobileLiveTerminalModalEl.classList.add('active');
            this.reconnectManager?.setCurrentSession(sessionId);
            if (this.reconnectManager) {
                this.reconnectManager.terminalAccess = result.terminalAccess || {
                    state: 'owner',
                    ownerViewerLabel: this.viewerLabel,
                    ownerLastSeenAt: new Date().toISOString(),
                    canTakeover: false
                };
            }
            this._terminalLastNavigateAt = Date.now();
            this.scheduleTerminalFrameLayoutSync(this._latestMobileViewportLayout);
            this._updateTerminalInputStatus();
        },

        async switchSession(sessionId, options = {}) {
            const terminalFrame = document.getElementById('terminal-frame');
            const terminalXtermHost = document.getElementById('terminal-xterm-host');
            const switchToken = options.switchToken ?? ++this._sessionSwitchToken;
            if (!terminalFrame) {
                console.warn('Terminal frame not found');
                return { ok: false, reason: 'missing-terminal-frame' };
            }
            this.terminalFrame = terminalFrame;
            this.terminalXtermHost = terminalXtermHost;
            const initialSelectedSessionId = appStore.getState().currentSessionId;
            const previousSessionId = options.previousSessionId
                ?? this._terminalPresentationSessionId
                ?? (initialSelectedSessionId && initialSelectedSessionId !== sessionId ? initialSelectedSessionId : null);

            try {
                const { sessions } = appStore.getState();
                const session = sessions.find(s => s.id === sessionId);

                if (!session) {
                    console.error('Session not found:', sessionId);
                    this._clearTerminalFrame(terminalFrame);
                    return { ok: false, reason: 'missing-session' };
                }

                if (appStore.getState().currentSessionId !== sessionId) {
                    appStore.setState({ currentSessionId: sessionId });
                }
                // Update lastAccessedAt for sort ordering
                const now = new Date().toISOString();
                session.lastAccessedAt = now;
                httpClient.patch(`/api/state/sessions/${sessionId}`, { lastAccessedAt: now }).catch(() => {});
                this._setActiveSessionRow?.(sessionId);
                this._beginTerminalSwitch?.(sessionId, {
                    previousSessionId,
                    switchToken,
                    surface: this.isMobile() ? 'mobile' : 'desktop'
                });

                if (session.intendedState === 'archived') {
                    console.log(`[switchSession] Skipping archived session ${sessionId}`);
                    this.closeMobileLiveTerminal();
                    this._stopMobileSnapshotPolling();
                    this.terminalTransportClient?.disconnect({ preserveView: false });
                    this.terminalTransportClient?.hide();
                    this._showTtydIframe();
                    this._clearTerminalFrame(terminalFrame);
                    this._finishTerminalSwitch?.(null, switchToken, { state: 'idle' });
                    return { ok: true, archived: true };
                }

                if (this.isMobile()) {
                    const { runtimeStatus, terminalAccess } = await this._resolveSessionRuntime(sessionId, session);
                    if (!this._isSessionSwitchCurrent(sessionId, switchToken)) return { ok: false, reason: 'stale' };
                    let snapshot = this._terminalSnapshotCache.get(sessionId) || null;
                    if (!snapshot) {
                        try {
                            snapshot = await this._loadTerminalSnapshot(sessionId, { force: true, mode: 'fast' });
                        } catch (error) {
                            this._failTerminalSwitch?.(sessionId, switchToken, {
                                previousSessionId,
                                error,
                                errorMessage: 'セッション表示の準備に失敗しました'
                            });
                            return { ok: false, reason: 'snapshot-load-failed' };
                        }
                    }
                    if (!this._isSessionSwitchCurrent(sessionId, switchToken)) return { ok: false, reason: 'stale' };
                    this._closeMobileLiveTerminalModalDom?.();
                    this.terminalTransportClient?.disconnect({ preserveView: false });
                    this.terminalTransportClient?.hide();
                    this._terminalTransportStatus = null;
                    this._mobileTerminalMode = 'snapshot';
                    this._mobileLiveTerminalSessionId = null;
                    this._showSnapshotDisplay(sessionId, { title: 'Terminal display', snapshot });
                    this._clearTerminalFrame(terminalFrame);
                    this._renderTerminalSnapshotPanel({
                        visible: true,
                        snapshot,
                        title: 'Terminal display'
                    });
                    if (this.reconnectManager) {
                        this.reconnectManager.setCurrentSession(sessionId);
                        this.reconnectManager.terminalAccess = terminalAccess || null;
                        if (terminalAccess?.state === 'blocked') {
                            this.reconnectManager._setBlocked?.(terminalAccess);
                        }
                    }
                    if (runtimeStatus?.ttydRunning || runtimeStatus?.proxyPath || terminalAccess?.state === 'blocked') {
                        this._terminalLastNavigateAt = Date.now();
                    }
                    this._finishTerminalSwitch?.(sessionId, switchToken, { state: 'ready_snapshot' });
                    this._syncMobileSnapshotPolling({ immediate: false, force: true });
                    this._updateTerminalInputStatus();
                    this._setCurrentSessionUiState({
                        transport: terminalAccess?.state === 'blocked' ? 'blocked' : 'connected',
                        attention: 'none'
                    });
                    return { ok: true, mode: 'snapshot' };
                }

                if (!options.forceTtyd && !options.proxyPath && this._shouldUseXtermTransport() && this.terminalTransportClient && this.terminalXtermHost) {
                    // Show snapshot immediately so the user sees content right away
                    const cachedSnapshot = this._terminalSnapshotCache.get(sessionId) || null;
                    this._showSnapshotDisplay(sessionId, {
                        title: 'Terminal display',
                        snapshot: cachedSnapshot
                    });
                    this._finishTerminalSwitch?.(sessionId, switchToken, { state: 'ready_snapshot', hideOverlay: true });

                    // Load fresh snapshot in background if cache was empty
                    if (!cachedSnapshot) {
                        this._loadTerminalSnapshot?.(sessionId, { force: false, mode: 'fast' }).then((snapshot) => {
                            if (this._isSessionSwitchCurrent(sessionId) && this._isCurrentSessionSnapshotDisplay?.(sessionId)) {
                                this._renderTerminalSnapshotPanel?.({ visible: true, snapshot, title: 'Terminal display' });
                            }
                        }).catch(() => {});
                    }

                    this._setCurrentSessionUiState({
                        transport: 'reconnecting',
                        attention: 'none'
                    });

                    // Connect terminal in background — snapshot stays visible until connected
                    const initialRuntime = await this._resolveSessionRuntime(sessionId, session);
                    if (!this._isSessionSwitchCurrent(sessionId, switchToken)) return { ok: false, reason: 'stale' };
                    try {
                        await this._ensureDesktopTerminalRuntime(session, initialRuntime?.runtimeStatus || null);
                        if (!this._isSessionSwitchCurrent(sessionId, switchToken)) return { ok: false, reason: 'stale' };
                    } catch (error) {
                        // Terminal startup failed — keep snapshot visible as fallback
                        console.warn('[switchSession] Terminal startup failed, keeping snapshot display:', error.message);
                        this._setCurrentSessionUiState({
                            transport: 'disconnected',
                            attention: 'none'
                        });
                        return { ok: true, mode: 'snapshot_fallback' };
                    }

                    const transportResult = await this._connectXtermTransport(session, { deferDisplay: true });
                    if (!this._isSessionSwitchCurrent(sessionId, switchToken)) {
                        this.terminalTransportClient?.disconnect({ preserveView: false });
                        return { ok: false, reason: 'stale' };
                    }
                    if (transportResult.ok) {
                        this.reconnectManager?.setCurrentSession(sessionId);
                        this._terminalLastNavigateAt = Date.now();
                        this._setCurrentSessionUiState({
                            transport: 'reconnecting',
                            attention: 'none'
                        });
                        if (this._shouldAutoFocusTerminalSurface()) {
                            this._triggerTerminalAutoFocus('switchSession');
                        }

                        return { ok: true, mode: 'xterm' };
                    }

                    if (transportResult.blocked) {
                        this.reconnectManager?.setCurrentSession(sessionId);
                        this.terminalTransportClient.show();
                        this._terminalTransportStatus = {
                            mode: 'blocked',
                            copyMode: false,
                            blockedAccess: transportResult.terminalAccess || null,
                            connected: false,
                            isFocused: false,
                            lastSnapshotAt: null
                        };
                        this._showXtermTransport();
                        this._updateTerminalInputStatus();
                        return { ok: true, blocked: true };
                    }

                    // Connection failed — keep snapshot visible as fallback
                    console.warn('[switchSession] Terminal connection failed, keeping snapshot display');
                    this._setCurrentSessionUiState({
                        transport: 'disconnected',
                        attention: 'none'
                    });
                    return { ok: true, mode: 'snapshot_fallback' };
                }

                // Show snapshot immediately for ttyd iframe path too
                {
                    const cachedSnapshot = this._terminalSnapshotCache.get(sessionId) || null;
                    this._showSnapshotDisplay(sessionId, {
                        title: 'Terminal display',
                        snapshot: cachedSnapshot
                    });
                    this._finishTerminalSwitch?.(sessionId, switchToken, { state: 'ready_snapshot', hideOverlay: true });
                    if (!cachedSnapshot) {
                        this._loadTerminalSnapshot?.(sessionId, { force: false, mode: 'fast' }).then((snapshot) => {
                            if (this._isSessionSwitchCurrent(sessionId) && this._isCurrentSessionSnapshotDisplay?.(sessionId)) {
                                this._renderTerminalSnapshotPanel?.({ visible: true, snapshot, title: 'Terminal display' });
                            }
                        }).catch(() => {});
                    }
                }

                const result = await this._resolveTtydProxyPath(sessionId, session, options);
                if (!this._isSessionSwitchCurrent(sessionId, switchToken)) return { ok: false, reason: 'stale' };

                if (result?.terminalAccess?.state === 'blocked') {
                    console.warn(`[switchSession] Session ${sessionId} is owned by another viewer`);
                    this.terminalTransportClient?.disconnect({ preserveView: false });
                    this.terminalTransportClient?.hide();
                    this._terminalTransportStatus = null;
                    this._showTtydIframe();
                    this._clearTerminalFrame(terminalFrame);
                    this.reconnectManager?.setCurrentSession(sessionId);
                    this.reconnectManager._setBlocked?.(result.terminalAccess);
                    this._updateTerminalInputStatus();
                    return { ok: true, blocked: true };
                }

                if (!result?.proxyPath) {
                    // Keep snapshot visible as fallback
                    console.warn('[switchSession] No proxy path, keeping snapshot display');
                    this._setCurrentSessionUiState({
                        transport: 'disconnected',
                        attention: 'none'
                    });
                    return { ok: true, mode: 'snapshot_fallback' };
                }

                try {
                    terminalFrame.classList.add('hidden');
                    await this._awaitTerminalFrameReady(terminalFrame, result.proxyPath);
                } catch (error) {
                    // Keep snapshot visible as fallback
                    console.warn('[switchSession] Frame load failed, keeping snapshot display:', error.message);
                    this._setCurrentSessionUiState({
                        transport: 'disconnected',
                        attention: 'none'
                    });
                    return { ok: true, mode: 'snapshot_fallback' };
                }
                if (!this._isSessionSwitchCurrent(sessionId, switchToken)) return { ok: false, reason: 'stale' };

                this.terminalTransportClient?.disconnect({ preserveView: false });
                this.terminalTransportClient?.hide();
                this._terminalTransportStatus = null;
                this._showTtydIframe();
                console.log('Terminal switched to:', result.proxyPath);
                this.reconnectManager?.setCurrentSession(sessionId);
                if (this.reconnectManager) {
                    this.reconnectManager.terminalAccess = result.terminalAccess || {
                        state: 'owner',
                        ownerViewerLabel: this.viewerLabel,
                        ownerLastSeenAt: new Date().toISOString(),
                        canTakeover: false
                    };
                }
                this._terminalLastNavigateAt = Date.now();
                this._setCurrentSessionUiState({
                    transport: 'reconnecting',
                    attention: 'none'
                });
                if (this._shouldAutoFocusTerminalSurface()) {
                    this._triggerTerminalAutoFocus('switchSession');
                }
                return { ok: true, mode: 'ttyd' };
            } catch (error) {
                this._failTerminalSwitch?.(sessionId, switchToken, {
                    previousSessionId,
                    error
                });
                this._setCurrentSessionUiState({
                    transport: 'disconnected',
                    attention: 'none'
                });
                return { ok: false, reason: 'exception', error };
            }
        },

        async loadSessionData(sessionId) {
            try {
                const startTime = performance.now();
                await Promise.all([
                    this.taskService.loadTasks(),
                    this.scheduleService.loadSchedule()
                ]);
                const duration = performance.now() - startTime;
                console.log(`[SessionSwitch] Data loaded in ${duration.toFixed(2)}ms`);

                console.log('Session data loaded for:', sessionId);
            } catch (error) {
                console.error('Failed to load session data:', error);
            }
        },

        _resolveInitialSessionId(currentSessionId, sessions = []) {
            const sessionList = Array.isArray(sessions) ? sessions : [];
            const currentSession = currentSessionId
                ? sessionList.find((session) => session.id === currentSessionId)
                : null;

            if (currentSession && currentSession.intendedState !== 'archived') {
                return currentSession.id;
            }

            return sessionList.find((session) => session.intendedState !== 'archived')?.id || null;
        },

        async _loadSessionsForStartup(maxAttempts = 3, delayMs = 350) {
            let lastError = null;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    return await this.sessionService.loadSessions();
                } catch (error) {
                    lastError = error;
                    if (attempt >= maxAttempts) break;
                    console.warn(
                        `Sessions not available during startup (attempt ${attempt}/${maxAttempts}), retrying...`,
                        error.message
                    );
                    await new Promise((resolve) => window.setTimeout(resolve, delayMs));
                }
            }

            throw lastError || new Error('Failed to load sessions during startup');
        },

        async loadInitialData() {
            try {
                try {
                    await this._loadSessionsForStartup();
                } catch (error) {
                    console.warn('Sessions not available, using empty state:', error.message);
                }

                let { currentSessionId, sessions } = appStore.getState();

                const resolvedCurrentSessionId = this._resolveInitialSessionId(currentSessionId, sessions);
                const shouldAutoSelectInitialSession = resolvedCurrentSessionId !== currentSessionId;
                if (shouldAutoSelectInitialSession) {
                    currentSessionId = resolvedCurrentSessionId;
                }

                if (shouldAutoSelectInitialSession && currentSessionId) {
                    console.log('Auto-selecting initial session:', currentSessionId);
                    await eventBus.emit(EVENTS.SESSION_CHANGED, { sessionId: currentSessionId });
                } else if (shouldAutoSelectInitialSession) {
                    appStore.setState({ currentSessionId: null });
                }

                if (sessions && sessions.length > 0) {
                    const summaryIds = this.isMobile() && currentSessionId
                        ? [currentSessionId]
                        : sessions
                            .filter((session) => session.intendedState !== 'archived')
                            .map((session) => session.id);
                    void this.refreshSessionUiSummaries(summaryIds);
                    this._scheduleSnapshotPrefetch?.();
                }

                if (currentSessionId) {
                    await this.loadSessionData(currentSessionId);
                    this._updateSessionGoalBanner(currentSessionId);
                } else {
                    try {
                        await this.taskService.loadTasks();
                    } catch (error) {
                        console.warn('Tasks not available, using empty state:', error.message);
                    }

                    try {
                        await this.scheduleService.loadSchedule();
                    } catch (error) {
                        console.warn('Schedule not available, using empty state:', error.message);
                    }
                }

                console.log('Initial data loaded successfully');
            } catch (error) {
                console.error('Failed to load initial data:', error);
                console.warn('App started with empty data due to errors');
            }
        },

        _updateSessionGoalBanner(_sessionId) {
            this.views?.sessionContextBarView?.refresh?.({ forceLoading: false });
        }
    });
}
