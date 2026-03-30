import { appStore } from '../core/store.js';
import { httpClient } from '../core/http-client.js';
import { buildSessionRuntimeUrl, appendViewerIdToProxyPath } from '../core/terminal-viewer.js';
import { showError, showInfo } from '../toast.js';

export function buildTerminalBlockedText(terminalAccess) {
    const ownerLabel = terminalAccess?.ownerViewerLabel || '別の場所';
    return `入力: ${ownerLabel} で表示中 (クリックで引継ぎ)`;
}

export function formatTerminalTimestamp(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ja-JP', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

export function isLoopbackHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1';
}

function isTrustedTerminalOrigin(origin) {
    if (!origin || origin === 'null') return false;

    try {
        const eventUrl = new URL(origin);
        const currentUrl = new URL(window.location.origin);
        if (eventUrl.origin === currentUrl.origin) return true;
        return isLoopbackHost(eventUrl.hostname) && isLoopbackHost(currentUrl.hostname);
    } catch {
        return false;
    }
}

/**
 * Terminal Reconnect Manager
 * Handles iframe disconnection detection and automatic reconnection
 */
export class TerminalReconnectManager {
    constructor() {
        this.maxRetries = 3;
        this.retryCount = 0;
        this.retryDelay = 2000; // 初回2秒
        this.currentSessionId = null;
        this.terminalFrame = null;
        this.isReconnecting = false;
        this.lastConnectTime = null; // 最後のWebSocket接続成功時刻
        this.wsConnected = false;
        this.lastDisconnectCode = null;
        this.lastDisconnectReason = null;
        this.lastDisconnectAt = null;
        this.lastErrorAt = null;
        this.viewerId = null;
        this.viewerLabel = null;
        this.terminalAccess = null;
        this.onStatusChange = null;
    }

    _emitStatus() {
        if (typeof this.onStatusChange !== 'function') return;
        this.onStatusChange({
            sessionId: this.currentSessionId,
            wsConnected: this.wsConnected,
            isReconnecting: this.isReconnecting,
            retryCount: this.retryCount,
            maxRetries: this.maxRetries,
            lastConnectTime: this.lastConnectTime,
            lastDisconnectCode: this.lastDisconnectCode,
            lastDisconnectReason: this.lastDisconnectReason,
            lastDisconnectAt: this.lastDisconnectAt,
            lastErrorAt: this.lastErrorAt,
            terminalAccess: this.terminalAccess
        });
    }

    setViewerContext({ viewerId, viewerLabel }) {
        this.viewerId = viewerId || null;
        this.viewerLabel = viewerLabel || null;
    }

    _getViewerProxyPath(proxyPath, port = null) {
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
    }

    _buildTerminalFrameUrl(proxyPath, port = null) {
        return this._getViewerProxyPath(proxyPath, port);
    }

    init(terminalFrame) {
        this.terminalFrame = terminalFrame;

        // iframeのエラー検知
        terminalFrame.addEventListener('error', () => {
            this.handleDisconnect();
        });

        // iframeのload成功
        terminalFrame.addEventListener('load', () => {
            this.handleConnect();
        });

        // ttyd内部WebSocket監視用のpostMessageリスナー
        this.initPostMessageListener();
        this._emitStatus();
    }

    initPostMessageListener() {
        window.addEventListener('message', (event) => {
            if (!isTrustedTerminalOrigin(event.origin)) return;

            const { type, sessionId, code, reason } = event.data || {};

            switch (type) {
                case 'ttyd-disconnect':
                    console.log(`[ttyd] Session ${sessionId} WebSocket disconnected (code: ${code})`);
                    this.handleTtydDisconnect(sessionId, code, reason);
                    break;
                case 'ttyd-error':
                    console.log(`[ttyd] Session ${sessionId} WebSocket error`);
                    this.handleTtydError(sessionId);
                    break;
                case 'ttyd-connect':
                    console.log(`[ttyd] Session ${sessionId} WebSocket connected`);
                    this.handleTtydConnect(sessionId);
                    break;
            }
        });
    }

    handleTtydDisconnect(sessionId, code, reason) {
        // 現在のセッションの場合のみ処理
        if (sessionId !== this.currentSessionId) return;

        // 正常切断（code 1000）は無視（セッション切り替え等）
        if (code === 1000) return;

        // アーカイブ済みセッションの切断は再接続しない
        const state = appStore.getState();
        const session = (state.sessions || []).find(s => s.id === sessionId);
        if (session?.intendedState === 'archived') {
            console.log(`[reconnect] Ignoring disconnect for archived session ${sessionId}`);
            this.wsConnected = false;
            this._emitStatus();
            return;
        }

        // 最近接続成功した場合は無視（race condition防止）
        if (this.lastConnectTime && Date.now() - this.lastConnectTime < 3000) {
            console.log('[reconnect] Ignoring disconnect within 3s of connect');
            return;
        }

        this.wsConnected = false;
        this.terminalAccess = null;
        this.lastDisconnectCode = code;
        this.lastDisconnectReason = reason || null;
        this.lastDisconnectAt = Date.now();
        this._emitStatus();

        // 自動再接続トリガー
        if (!this.isReconnecting) {
            showInfo('ターミナル接続が切断されました。再接続中...');
            this.handleDisconnect();
        }
    }

    handleTtydError(sessionId) {
        // 現在のセッションの場合のみ処理
        if (sessionId !== this.currentSessionId) return;

        this.wsConnected = false;
        this.terminalAccess = null;
        this.lastErrorAt = Date.now();
        this._emitStatus();

        if (!this.isReconnecting) {
            this.handleDisconnect();
        }
    }

    handleTtydConnect(sessionId) {
        // 現在のセッションの場合のみ処理
        if (sessionId !== this.currentSessionId) return;

        this.wsConnected = true;
        this.lastDisconnectCode = null;
        this.lastDisconnectReason = null;
        this.lastDisconnectAt = null;
        this.lastErrorAt = null;
        this.terminalAccess = {
            state: 'owner',
            ownerViewerLabel: this.viewerLabel,
            ownerLastSeenAt: new Date().toISOString(),
            canTakeover: false
        };

        // 接続成功時刻を記録（disconnect race condition防止用）
        this.lastConnectTime = Date.now();

        if (this.retryCount > 0 || this.isReconnecting) {
            showInfo('ターミナル接続が復旧しました');
            this.retryCount = 0;
            this.isReconnecting = false;
        }
        this._emitStatus();
    }

    handleDisconnect() {
        // 再接続中または既にリトライ上限に達している場合はスキップ
        if (this.isReconnecting || !this.currentSessionId) return;

        if (this.retryCount < this.maxRetries) {
            this.isReconnecting = true;
            this.retryCount++;
            const delay = this.retryDelay * Math.pow(2, this.retryCount - 1);

            showInfo(`ターミナル再接続中... (${this.retryCount}/${this.maxRetries})`);
            this._emitStatus();

            setTimeout(() => {
                this.reconnect();
            }, delay);
        } else {
            showError('ターミナル接続に失敗しました。ページをリロードしてください。');
        }
    }

    handleConnect() {
        if (this.retryCount > 0) {
            showInfo('ターミナル接続が復旧しました');
        }
        this.retryCount = 0;
        this.isReconnecting = false;
        this._emitStatus();
    }

    async _resolveRuntimeStatus(sessionId, fallbackSession) {
        const currentRuntime = fallbackSession?.runtimeStatus;
        const currentAccess = this.terminalAccess;
        if (currentRuntime?.ttydRunning && currentRuntime?.proxyPath && currentAccess?.state !== 'blocked') {
            return {
                session: fallbackSession || null,
                runtimeStatus: currentRuntime,
                terminalAccess: currentAccess || null
            };
        }

        const runtime = await httpClient.get(buildSessionRuntimeUrl(sessionId, this.viewerId, this.viewerLabel));
        return {
            session: fallbackSession || null,
            runtimeStatus: runtime?.runtimeStatus || currentRuntime || null,
            terminalAccess: runtime?.terminalAccess || currentAccess || null
        };
    }

    _clearTerminalFrame(frameEl) {
        const frame = frameEl || this.terminalFrame;
        if (!frame) return;
        frame.classList.add('terminal-frame-clearing');
        frame.src = 'about:blank';
    }

    _showTerminalFrame(frameEl) {
        const frame = frameEl || this.terminalFrame;
        if (!frame) return;
        frame.classList.remove('terminal-frame-clearing');
    }

    _reloadTerminalFrame(proxyPath, port = null) {
        const nextProxyPath = this._buildTerminalFrameUrl(proxyPath, port);
        if (!this.terminalFrame || !nextProxyPath) return;

        const currentSrc = this.terminalFrame.src || '';
        if (currentSrc.includes(nextProxyPath)) {
            // Avoid about:blank flash by using location.replace or cache-bust query
            try {
                this.terminalFrame.contentWindow.location.replace(nextProxyPath);
            } catch (_crossOrigin) {
                const separator = nextProxyPath.includes('?') ? '&' : '?';
                this.terminalFrame.src = `${nextProxyPath}${separator}_r=${Date.now()}`;
            }
            return;
        }

        this.terminalFrame.src = nextProxyPath;
    }

    _setBlocked(terminalAccess) {
        this.wsConnected = false;
        this.isReconnecting = false;
        this.terminalAccess = terminalAccess || {
            state: 'blocked',
            ownerViewerLabel: null,
            ownerLastSeenAt: null,
            canTakeover: true
        };
        this._emitStatus();
    }

    async reconnect() {
        if (!this.currentSessionId) {
            this.isReconnecting = false;
            return;
        }

        // アーカイブ済みセッションの再接続をスキップ
        const state = appStore.getState();
        const fallbackSession = (state.sessions || []).find(s => s.id === this.currentSessionId);
        const currentSession = fallbackSession;
        if (currentSession?.intendedState === 'archived') {
            console.log(`[reconnect] Skipping: session ${this.currentSessionId} is archived`);
            this.isReconnecting = false;
            this.retryCount = 0;
            return;
        }

        try {
            const { session, runtimeStatus, terminalAccess } = await this._resolveRuntimeStatus(this.currentSessionId, fallbackSession);
            const targetSession = session || fallbackSession;
            this.terminalAccess = terminalAccess || null;

            if (terminalAccess?.state === 'blocked') {
                console.warn(`[reconnect] Session ${this.currentSessionId} is owned by another viewer`);
                this._setBlocked(terminalAccess);
                return;
            }

            if (runtimeStatus?.ttydRunning && runtimeStatus?.proxyPath) {
                console.log('[reconnect] Reusing existing ttyd proxyPath:', runtimeStatus.proxyPath);
                this._reloadTerminalFrame(runtimeStatus.proxyPath, runtimeStatus.port);
                return;
            }

            if (!runtimeStatus) {
                console.warn(`[reconnect] Runtime lookup failed for session ${this.currentSessionId}, skipping restart`);
                this.isReconnecting = false;
                if (this.retryCount >= this.maxRetries) {
                    showError('ターミナル接続に失敗しました。ページをリロードしてください。');
                }
                return;
            }

            const payload = { sessionId: this.currentSessionId };

            const sessionCwd = targetSession?.worktree?.path || targetSession?.path;
            if (typeof sessionCwd === 'string' && sessionCwd.trim()) {
                payload.cwd = sessionCwd;
            }
            if (typeof targetSession?.initialCommand === 'string') {
                payload.initialCommand = targetSession.initialCommand;
            }
            if (typeof targetSession?.engine === 'string' && targetSession.engine.trim()) {
                payload.engine = targetSession.engine;
            }
            payload.viewerId = this.viewerId;
            payload.viewerLabel = this.viewerLabel;

            const res = await httpClient.post('/api/sessions/start', payload);

            if (res?.proxyPath) {
                this.terminalAccess = res.terminalAccess || this.terminalAccess;
                this._reloadTerminalFrame(res.proxyPath, res.port);
            } else {
                this.isReconnecting = false;
                this.handleDisconnect();
            }
        } catch (error) {
            console.error('Reconnect failed:', error);
            this.isReconnecting = false;
            if (error?.message?.includes('already open in another viewer')) {
                this._setBlocked({
                    state: 'blocked',
                    ownerViewerLabel: null,
                    ownerLastSeenAt: null,
                    canTakeover: true
                });
                return;
            }
            // 無限ループ防止: catchでは再試行せず、ユーザーにリロードを促す
            if (this.retryCount >= this.maxRetries) {
                showError('ターミナル接続に失敗しました。ページをリロードしてください。');
            }
        }
    }

    setCurrentSession(sessionId) {
        this.currentSessionId = sessionId;
        this.retryCount = 0;
        this.isReconnecting = false;
        this.wsConnected = false;
        this.lastDisconnectCode = null;
        this.lastDisconnectReason = null;
        this.lastDisconnectAt = null;
        this.lastErrorAt = null;
        this.terminalAccess = null;
        this._emitStatus();
    }
}
