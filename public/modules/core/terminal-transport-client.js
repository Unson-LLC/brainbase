import { httpClient } from './http-client.js';
import { loadXterm } from './xterm-loader.js';
import { MessageQueue } from './message-queue.js';

const SNAPSHOT_LINES = 200;
const CONNECT_TIMEOUT_MS = 15000;

// WebSocket reconnection settings (CommandMate pattern)
const MAX_RECONNECT_RETRIES = 10;
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const KEEPALIVE_INTERVAL_MS = 30000;

// Expected close codes that should NOT trigger reconnection
const EXPECTED_CLOSE_CODES = new Set([
    1000, // Normal Closure
    1001, // Going Away (browser navigation)
]);

// Custom close code: ownership was taken over by another viewer
const WS_CLOSE_BLOCKED = 4001;

function isLoopbackHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function shouldUseDesktopXtermTransport() {
    if (typeof window === 'undefined') return false;
    const userAgent = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
    if (/jsdom/i.test(userAgent) || typeof window.__vitest_worker__ !== 'undefined') {
        return false;
    }
    const isMobile = window.innerWidth <= 768;
    return !isMobile && isLoopbackHost(window.location.hostname);
}

export class TerminalTransportClient {
    constructor({ viewerId, viewerLabel, onStatusChange = null }) {
        this.viewerId = viewerId;
        this.viewerLabel = viewerLabel;
        this.onStatusChange = onStatusChange;
        this.hostEl = null;
        this.terminal = null;
        this.fitAddon = null;
        this.ws = null;
        this.sessionId = null;
        this.status = {
            mode: 'idle',
            copyMode: false,
            blockedAccess: null,
            connected: false,
            isFocused: false,
            lastSnapshotAt: null
        };
        this._resizeHandler = null;
        this._reconnectTimer = null;
        this._retryCount = 0;
        this._manualClose = false;
        this._connectToken = 0;
        this._keepaliveTimer = null;
        this._messageQueue = new MessageQueue();
        this._isViewportPinnedToBottom = true;
        this._pendingSnapshotText = null;
    }

    async init(hostEl) {
        this.hostEl = hostEl;
        const { Terminal, FitAddon, WebLinksAddon } = await loadXterm();
        if (this.terminal) return;

        this.terminal = new Terminal({
            fontFamily: 'Menlo, Monaco, monospace',
            fontSize: 14,
            scrollback: 5000,
            convertEol: true,
            allowTransparency: false,
            cursorBlink: false,
            theme: {
                background: '#000000',
                foreground: '#e2e8f0',
                cursor: '#f8fafc',
                selectionBackground: 'rgba(59, 130, 246, 0.35)'
            }
        });
        this.fitAddon = new FitAddon();
        this.terminal.loadAddon(this.fitAddon);
        if (WebLinksAddon) {
            this.terminal.loadAddon(new WebLinksAddon());
        }
        this.terminal.open(hostEl);
        this.fitAddon.fit();
        if (typeof this.terminal.attachCustomKeyEventHandler === 'function') {
            this.terminal.attachCustomKeyEventHandler((event) => this._handleCustomKeyEvent(event));
        }
        this.terminal.onData((data) => {
            void this.sendText(data);
        });
        this.terminal.onResize(({ cols, rows }) => {
            void this.resize(cols, rows);
        });
        this.terminal.onScroll(() => {
            this._handleTerminalScroll();
        });
        this.hostEl.addEventListener('focusin', () => {
            this.status.isFocused = true;
            this._emitStatus();
        });
        this.hostEl.addEventListener('focusout', () => {
            this.status.isFocused = false;
            this._emitStatus();
        });

        this._resizeHandler = () => {
            this.fitAddon?.fit();
            const dims = this._getDimensions();
            if (dims) {
                void this.resize(dims.cols, dims.rows);
            }
        };
        window.addEventListener('resize', this._resizeHandler);
    }

    destroy() {
        this._stopKeepalive();
        this.disconnect();
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }
        this.terminal?.dispose();
        this.terminal = null;
        this.fitAddon = null;
    }

    getStatus() {
        return { ...this.status, reconnectAttempts: this._retryCount };
    }

    isActiveForSession(sessionId) {
        return this.sessionId === sessionId && (this.status.mode === 'live' || this.status.mode === 'snapshot' || this.status.mode === 'blocked');
    }

    show() {
        this.hostEl?.classList.remove('hidden');
    }

    hide() {
        this.hostEl?.classList.add('hidden');
    }

    focus() {
        this.terminal?.focus();
        this.status.isFocused = true;
        this._emitStatus();
    }

    _handleCustomKeyEvent(event) {
        if (!event || event.type !== 'keydown') return true;

        if (event.key === 'Enter' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
            void this.sendKey('M-Enter');
            if (typeof event.preventDefault === 'function') {
                event.preventDefault();
            }
            return false;
        }

        return true;
    }

    async connect(sessionId) {
        this._connectToken += 1;
        const connectToken = this._connectToken;
        this._manualClose = false;
        this.sessionId = sessionId;
        this.status.mode = 'reconnecting';
        this.status.connected = false;
        this.status.blockedAccess = null;
        this._emitStatus();

        this._clearReconnectTimer();
        this._closeWs();

        const initialDimensions = this._measureViewport();
        const wsUrl = this._buildWsUrl(sessionId, initialDimensions);
        const ws = new WebSocket(wsUrl);
        this.ws = ws;

        return await new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                if (this._connectToken !== connectToken) return;
                reject(new Error('Terminal transport connect timeout'));
            }, CONNECT_TIMEOUT_MS);

            const cleanup = () => {
                clearTimeout(timeoutId);
            };

            ws.addEventListener('message', (event) => {
                if (this._connectToken !== connectToken) return;
                const message = this._parseMessage(event.data);
                if (!message) return;

                switch (message.type) {
                    case 'ready':
                        cleanup();
                        this._retryCount = 0;
                        this.status.mode = 'live';
                        this.status.connected = true;
                        this._emitStatus();
                        this._startKeepalive();
                        this._flushMessageQueue();
                        void this.syncViewportSize();
                        resolve({ mode: 'live' });
                        break;
                    case 'snapshot':
                        this._queueOrApplySnapshot(message.colorText || message.text || '');
                        this.status.lastSnapshotAt = message.capturedAt || new Date().toISOString();
                        if (!this.status.connected) {
                            this.status.mode = 'snapshot';
                        }
                        this._emitStatus();
                        break;
                    case 'status':
                        this.status.copyMode = Boolean(message.copyMode);
                        if (typeof message.mode === 'string') {
                            this.status.mode = message.mode;
                            this.status.connected = message.mode === 'live';
                        }
                        this._emitStatus();
                        break;
                    case 'blocked':
                        cleanup();
                        this.status.mode = 'blocked';
                        this.status.blockedAccess = message.terminalAccess || null;
                        this.status.connected = false;
                        this._emitStatus();
                        resolve({ mode: 'blocked', terminalAccess: message.terminalAccess || null });
                        break;
                    case 'error': {
                        cleanup();
                        this._manualClose = true;
                        const error = new Error(message.message || 'Terminal transport error');
                        error.code = message.code || 'TERMINAL_TRANSPORT_ERROR';
                        reject(error);
                        break;
                    }
                    default:
                        break;
                }
            });

            ws.addEventListener('close', (closeEvent) => {
                cleanup();
                this._stopKeepalive();
                this.status.connected = false;

                const closeCode = closeEvent?.code;

                // 4001 = ownership taken over: treat as blocked even if blocked message was missed
                if (closeCode === WS_CLOSE_BLOCKED) {
                    this.status.mode = 'blocked';
                } else if (this.status.mode !== 'blocked') {
                    this.status.mode = this.status.lastSnapshotAt ? 'snapshot' : 'disconnected';
                }
                this._emitStatus();

                const isExpected = closeCode != null && this._isExpectedClose(closeCode);

                if (!this._manualClose && !isExpected && this.sessionId === sessionId && this.status.mode !== 'blocked') {
                    void this._refreshSnapshot();
                    this._scheduleReconnect(sessionId);
                }
            }, { once: true });

            ws.addEventListener('error', () => {
                cleanup();
            }, { once: true });
        });
    }

    disconnect({ preserveView = false } = {}) {
        this._manualClose = true;
        this._clearReconnectTimer();
        this._stopKeepalive();
        this._messageQueue.clear();
        this._closeWs();
        this.status.connected = false;
        this.status.copyMode = false;
        if (!preserveView) {
            this.status.mode = 'idle';
            this.status.lastSnapshotAt = null;
            this.status.blockedAccess = null;
            this._pendingSnapshotText = null;
            this._isViewportPinnedToBottom = true;
            this.terminal?.reset();
        }
        this._emitStatus();
    }

    async sendText(value) {
        if (!value) return;
        const message = { type: 'input', inputType: 'text', value };
        if (this.ws?.readyState !== WebSocket.OPEN) {
            // Queue for later (CommandMate pattern)
            this._messageQueue.enqueue(message);
            return;
        }
        await this._ensureInteractiveMode();
        this.ws.send(JSON.stringify(message));
    }

    async sendKey(value) {
        if (!value) return;
        const message = { type: 'input', inputType: 'key', value };
        if (this.ws?.readyState !== WebSocket.OPEN) {
            this._messageQueue.enqueue(message);
            return;
        }
        await this._ensureInteractiveMode();
        this.ws.send(JSON.stringify(message));
    }

    /**
     * セッション中断（CommandMateのInterruptButtonパターン）
     * AI処理中にCtrl+Cを送信して中断する
     */
    async interrupt() {
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        await this._ensureInteractiveMode();
        this.ws.send(JSON.stringify({
            type: 'input',
            inputType: 'key',
            value: 'C-c'
        }));
    }

    async resize(cols, rows) {
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({
            type: 'resize',
            cols,
            rows
        }));
    }

    async syncViewportSize() {
        const dims = this._measureViewport();
        if (!dims) return;
        await this.resize(dims.cols, dims.rows);
    }

    async reconnect() {
        if (!this.sessionId) return;
        await this.connect(this.sessionId);
    }

    async _refreshSnapshot() {
        if (!this.sessionId) return;
        try {
            const res = await httpClient.get(`/api/sessions/${encodeURIComponent(this.sessionId)}/terminal/snapshot?viewerId=${encodeURIComponent(this.viewerId)}&viewerLabel=${encodeURIComponent(this.viewerLabel)}&lines=${SNAPSHOT_LINES}`);
            if (typeof res?.text === 'string') {
                this._queueOrApplySnapshot(res.colorText || res.text);
                this.status.lastSnapshotAt = res.capturedAt || new Date().toISOString();
                this.status.copyMode = Boolean(res.copyMode);
                this.status.mode = 'snapshot';
                this._emitStatus();
            }
        } catch (error) {
            // best effort only
        }
    }

    _scheduleReconnect(sessionId) {
        if (!this._shouldRetry()) return;
        const delay = this._getReconnectDelay(this._retryCount);
        this._retryCount += 1;
        this.status.mode = 'reconnecting';
        this._emitStatus();
        this._reconnectTimer = setTimeout(() => {
            if (this.sessionId !== sessionId) return;
            void this.connect(sessionId).catch(() => {});
        }, delay);
    }

    /**
     * 指数バックオフ + ジッター（CommandMateパターン）
     * base * 2^attempt + random jitter (0-50% of base delay)
     */
    _getReconnectDelay(attempt) {
        const exponential = Math.min(
            BASE_RECONNECT_DELAY_MS * Math.pow(2, attempt),
            MAX_RECONNECT_DELAY_MS
        );
        const jitter = exponential * 0.5 * Math.random();
        return exponential + jitter;
    }

    /**
     * リトライ可能かどうか判定
     */
    _shouldRetry() {
        return this._retryCount < MAX_RECONNECT_RETRIES;
    }

    /**
     * Expected close codeかどうか判定
     * 正常クローズやブラウザナビゲーションではリトライしない
     */
    _isExpectedClose(code) {
        return EXPECTED_CLOSE_CODES.has(code);
    }

    /**
     * Keepalive pingの開始
     */
    _startKeepalive() {
        this._stopKeepalive();
        this._keepaliveTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, KEEPALIVE_INTERVAL_MS);
    }

    /**
     * キューに保存されたメッセージを再接続後に送信
     */
    _flushMessageQueue() {
        if (this._messageQueue.isEmpty()) return;
        const messages = this._messageQueue.drain();
        for (const msg of messages) {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(msg));
            }
        }
    }

    /**
     * Keepalive pingの停止
     */
    _stopKeepalive() {
        if (this._keepaliveTimer) {
            clearInterval(this._keepaliveTimer);
            this._keepaliveTimer = null;
        }
    }

    async _ensureInteractiveMode() {
        if (!this.status.copyMode) return;
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ type: 'exit_copy_mode' }));
        this.status.copyMode = false;
        this._emitStatus();
    }

    _clearReconnectTimer() {
        if (!this._reconnectTimer) return;
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
    }

    _closeWs() {
        if (!this.ws) return;
        const ws = this.ws;
        this.ws = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
        }
    }

    _captureViewportState() {
        const buffer = this.terminal?.buffer?.active;
        if (!buffer) return null;

        const baseY = Number.isFinite(buffer.baseY) ? buffer.baseY : 0;
        const viewportY = Number.isFinite(buffer.viewportY) ? buffer.viewportY : baseY;
        const distanceFromBottom = Math.max(0, baseY - viewportY);

        return {
            distanceFromBottom,
            wasPinnedToBottom: distanceFromBottom === 0
        };
    }

    _computeIsViewportPinnedToBottom() {
        const viewportState = this._captureViewportState();
        return viewportState ? viewportState.wasPinnedToBottom : true;
    }

    _handleTerminalScroll() {
        this._isViewportPinnedToBottom = this._computeIsViewportPinnedToBottom();
        if (!this._isViewportPinnedToBottom || !this._pendingSnapshotText) return;

        const nextSnapshot = this._pendingSnapshotText;
        this._pendingSnapshotText = null;
        this._applySnapshot(nextSnapshot, {
            forceViewportState: {
                distanceFromBottom: 0,
                wasPinnedToBottom: true
            }
        });
    }

    _queueOrApplySnapshot(text) {
        if (!this.terminal) return;

        if (!this._computeIsViewportPinnedToBottom()) {
            this._isViewportPinnedToBottom = false;
            this._pendingSnapshotText = text || '';
            return;
        }

        this._isViewportPinnedToBottom = true;
        this._pendingSnapshotText = null;
        this._applySnapshot(text);
    }

    _restoreViewportState(viewportState) {
        if (!viewportState || !this.terminal) return;

        if (viewportState.wasPinnedToBottom) {
            this.terminal.scrollToBottom?.();
            return;
        }

        const buffer = this.terminal.buffer?.active;
        if (!buffer || typeof this.terminal.scrollToLine !== 'function') return;

        const nextBaseY = Number.isFinite(buffer.baseY) ? buffer.baseY : 0;
        const targetLine = Math.max(0, nextBaseY - viewportState.distanceFromBottom);
        this.terminal.scrollToLine(targetLine);
    }

    _applySnapshot(text, options = {}) {
        if (!this.terminal) return;
        const viewportState = options.forceViewportState || this._captureViewportState();
        this.terminal.reset();
        this.terminal.write(text || '', () => {
            this.fitAddon?.fit();
            this._restoreViewportState(viewportState);
            this._isViewportPinnedToBottom = this._computeIsViewportPinnedToBottom();
        });
    }

    _measureViewport() {
        this.fitAddon?.fit();
        const dims = this._getDimensions();
        if (!dims) return null;
        if (!Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return null;
        if (dims.cols <= 0 || dims.rows <= 0) return null;
        return dims;
    }

    _getDimensions() {
        if (!this.terminal) return null;
        return {
            cols: this.terminal.cols,
            rows: this.terminal.rows
        };
    }

    _buildWsUrl(sessionId, dimensions = null) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = new URL(`${protocol}//${window.location.host}/api/sessions/${encodeURIComponent(sessionId)}/terminal/ws`);
        url.searchParams.set('viewerId', this.viewerId);
        url.searchParams.set('viewerLabel', this.viewerLabel);
        if (dimensions?.cols && dimensions?.rows) {
            url.searchParams.set('cols', String(dimensions.cols));
            url.searchParams.set('rows', String(dimensions.rows));
        }
        return url.toString();
    }

    _parseMessage(raw) {
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    _emitStatus() {
        if (typeof this.onStatusChange !== 'function') return;
        this.onStatusChange(this.getStatus());
    }
}
