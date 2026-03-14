import { httpClient } from './http-client.js';
import { loadXterm } from './xterm-loader.js';

const SNAPSHOT_LINES = 200;
const CONNECT_TIMEOUT_MS = 4000;
const SCROLL_MIN_DELTA_PX = 12;
const SCROLL_STEP_PX = 40;
const MAX_SCROLL_STEPS = 8;
const SCROLL_FLUSH_MS = 16;
const TOUCH_STEP_PX = 18;
const TOUCH_FLUSH_MS = 30;

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
        this._wheelDelta = 0;
        this._touchDelta = 0;
        this._wheelFlushTimer = null;
        this._touchFlushTimer = null;
        this._lastTouchY = null;
        this._boundPointerDownHandler = null;
        this._boundWheelHandler = null;
        this._boundTouchStartHandler = null;
        this._boundTouchMoveHandler = null;
        this._boundTouchEndHandler = null;
    }

    async init(hostEl) {
        this.hostEl = hostEl;
        const { Terminal, FitAddon } = await loadXterm();
        if (this.terminal) return;

        this.terminal = new Terminal({
            fontFamily: 'Menlo, Monaco, monospace',
            fontSize: 14,
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
        this.terminal.open(hostEl);
        this.fitAddon.fit();
        this.terminal.onData((data) => {
            void this.sendText(data);
        });
        this.terminal.onResize(({ cols, rows }) => {
            void this.resize(cols, rows);
        });
        this.hostEl.addEventListener('focusin', () => {
            this.status.isFocused = true;
            this._emitStatus();
        });
        this.hostEl.addEventListener('focusout', () => {
            this.status.isFocused = false;
            this._emitStatus();
        });
        this._attachScrollHandlers();

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
        this._detachScrollHandlers();
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
                        void this.syncViewportSize();
                        resolve({ mode: 'live' });
                        break;
                    case 'snapshot':
                        this._applySnapshot(message.text || '');
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
                if (this.status.mode !== 'blocked') {
                    this.status.mode = this.status.lastSnapshotAt ? 'snapshot' : 'disconnected';
                }
                this._emitStatus();

                const closeCode = closeEvent?.code;
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
        this._closeWs();
        this.status.connected = false;
        this.status.copyMode = false;
        if (!preserveView) {
            this.status.mode = 'idle';
            this.status.lastSnapshotAt = null;
            this.status.blockedAccess = null;
            this.terminal?.reset();
        }
        this._emitStatus();
    }

    async sendText(value) {
        if (!value) return;
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        await this._ensureInteractiveMode();
        this.ws.send(JSON.stringify({
            type: 'input',
            inputType: 'text',
            value
        }));
    }

    async sendKey(value) {
        if (!value) return;
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        await this._ensureInteractiveMode();
        this.ws.send(JSON.stringify({
            type: 'input',
            inputType: 'key',
            value
        }));
    }

    async scroll(direction, steps) {
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        const safeDirection = direction === 'down' ? 'down' : direction === 'up' ? 'up' : null;
        if (!safeDirection) return;
        const safeSteps = Math.min(MAX_SCROLL_STEPS, Math.max(1, Number(steps) || 1));
        this.ws.send(JSON.stringify({
            type: 'scroll',
            direction: safeDirection,
            steps: safeSteps
        }));
        this.status.copyMode = true;
        this._emitStatus();
    }

    async exitCopyMode() {
        if (!this.status.copyMode) return;
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ type: 'exit_copy_mode' }));
        this.status.copyMode = false;
        this._emitStatus();
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
                this._applySnapshot(res.text);
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
     * Keepalive pingの停止
     */
    _stopKeepalive() {
        if (this._keepaliveTimer) {
            clearInterval(this._keepaliveTimer);
            this._keepaliveTimer = null;
        }
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

    async _ensureInteractiveMode() {
        if (!this.status.copyMode) return;
        await this.exitCopyMode();
    }

    _attachScrollHandlers() {
        if (!this.hostEl) return;

        this._boundPointerDownHandler = () => {
            void this._ensureInteractiveMode();
        };
        this._boundWheelHandler = (event) => {
            if (!this._shouldInterceptTmuxScroll(event.target)) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            this._queueWheelDelta(event.deltaY || 0);
        };
        this._boundTouchStartHandler = (event) => {
            if (!event.touches || event.touches.length !== 1) return;
            this._lastTouchY = event.touches[0].clientY;
            this._touchDelta = 0;
        };
        this._boundTouchMoveHandler = (event) => {
            if (!this._shouldInterceptTmuxScroll(event.target)) return;
            if (!event.touches || event.touches.length !== 1) return;
            const currentY = event.touches[0].clientY;
            const previousY = this._lastTouchY;
            this._lastTouchY = currentY;
            if (!Number.isFinite(previousY)) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            this._queueTouchDelta(currentY - previousY);
        };
        this._boundTouchEndHandler = () => {
            this._lastTouchY = null;
            this._touchDelta = 0;
            if (this._touchFlushTimer) {
                clearTimeout(this._touchFlushTimer);
                this._touchFlushTimer = null;
            }
        };

        this.hostEl.addEventListener('pointerdown', this._boundPointerDownHandler, true);
        this.hostEl.addEventListener('wheel', this._boundWheelHandler, { passive: false, capture: true });
        this.hostEl.addEventListener('touchstart', this._boundTouchStartHandler, { passive: true, capture: true });
        this.hostEl.addEventListener('touchmove', this._boundTouchMoveHandler, { passive: false, capture: true });
        this.hostEl.addEventListener('touchend', this._boundTouchEndHandler, { passive: true, capture: true });
        this.hostEl.addEventListener('touchcancel', this._boundTouchEndHandler, { passive: true, capture: true });
    }

    _detachScrollHandlers() {
        if (!this.hostEl) return;
        if (this._boundPointerDownHandler) {
            this.hostEl.removeEventListener('pointerdown', this._boundPointerDownHandler, true);
            this._boundPointerDownHandler = null;
        }
        if (this._boundWheelHandler) {
            this.hostEl.removeEventListener('wheel', this._boundWheelHandler, true);
            this._boundWheelHandler = null;
        }
        if (this._boundTouchStartHandler) {
            this.hostEl.removeEventListener('touchstart', this._boundTouchStartHandler, true);
            this._boundTouchStartHandler = null;
        }
        if (this._boundTouchMoveHandler) {
            this.hostEl.removeEventListener('touchmove', this._boundTouchMoveHandler, true);
            this._boundTouchMoveHandler = null;
        }
        if (this._boundTouchEndHandler) {
            this.hostEl.removeEventListener('touchend', this._boundTouchEndHandler, true);
            this.hostEl.removeEventListener('touchcancel', this._boundTouchEndHandler, true);
            this._boundTouchEndHandler = null;
        }
    }

    _shouldInterceptTmuxScroll(target) {
        if (this.status.mode !== 'live') return false;
        if (!this._isAlternateBufferActive()) return false;
        return !target || !this.hostEl || this.hostEl.contains(target);
    }

    _isAlternateBufferActive() {
        const terminal = this.terminal;
        try {
            return Boolean(
                terminal
                && terminal.buffer
                && terminal.buffer.alternate
                && terminal.buffer.active === terminal.buffer.alternate
            );
        } catch {
            return false;
        }
    }

    _queueWheelDelta(delta) {
        if (!Number.isFinite(delta) || delta === 0) return;
        this._wheelDelta += delta;
        if (Math.abs(this._wheelDelta) < SCROLL_MIN_DELTA_PX) return;
        if (this._wheelFlushTimer) return;
        this._wheelFlushTimer = setTimeout(() => {
            this._wheelFlushTimer = null;
            const pendingDelta = this._wheelDelta;
            this._wheelDelta = 0;
            void this._flushScrollDelta(pendingDelta, {
                thresholdPx: SCROLL_STEP_PX,
                positiveDirection: 'down'
            });
        }, SCROLL_FLUSH_MS);
    }

    _queueTouchDelta(delta) {
        if (!Number.isFinite(delta) || delta === 0) return;
        this._touchDelta += delta;
        if (Math.abs(this._touchDelta) < TOUCH_STEP_PX) return;
        if (this._touchFlushTimer) return;
        this._touchFlushTimer = setTimeout(() => {
            this._touchFlushTimer = null;
            const pendingDelta = this._touchDelta;
            this._touchDelta = 0;
            void this._flushScrollDelta(pendingDelta, {
                thresholdPx: TOUCH_STEP_PX,
                positiveDirection: 'up'
            });
        }, TOUCH_FLUSH_MS);
    }

    async _flushScrollDelta(delta, { thresholdPx, positiveDirection }) {
        if (!Number.isFinite(delta) || delta === 0) return;
        const steps = Math.min(MAX_SCROLL_STEPS, Math.max(1, Math.round(Math.abs(delta) / thresholdPx)));
        const direction = delta > 0 ? positiveDirection : (positiveDirection === 'down' ? 'up' : 'down');
        await this.scroll(direction, steps);
    }

    _applySnapshot(text) {
        if (!this.terminal) return;
        this.terminal.reset();
        this.terminal.write(text || '');
        this.fitAddon?.fit();
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
