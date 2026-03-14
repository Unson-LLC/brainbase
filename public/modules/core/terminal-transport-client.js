import { httpClient } from './http-client.js';
import { loadXterm } from './xterm-loader.js';

const SNAPSHOT_LINES = 200;
const CONNECT_TIMEOUT_MS = 4000;

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
        return { ...this.status };
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

        const wsUrl = this._buildWsUrl(sessionId);
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

            ws.addEventListener('close', () => {
                cleanup();
                this.status.connected = false;
                if (this.status.mode !== 'blocked') {
                    this.status.mode = this.status.lastSnapshotAt ? 'snapshot' : 'disconnected';
                }
                this._emitStatus();

                if (!this._manualClose && this.sessionId === sessionId && this.status.mode !== 'blocked') {
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
        this.ws.send(JSON.stringify({
            type: 'input',
            inputType: 'text',
            value
        }));
    }

    async sendKey(value) {
        if (!value) return;
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({
            type: 'input',
            inputType: 'key',
            value
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
        if (this._retryCount >= 3) return;
        this._retryCount += 1;
        this.status.mode = 'reconnecting';
        this._emitStatus();
        this._reconnectTimer = setTimeout(() => {
            if (this.sessionId !== sessionId) return;
            void this.connect(sessionId).catch(() => {});
        }, 1500 * this._retryCount);
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

    _applySnapshot(text) {
        if (!this.terminal) return;
        this.terminal.reset();
        this.terminal.write(text || '');
        this.fitAddon?.fit();
    }

    _getDimensions() {
        if (!this.terminal) return null;
        return {
            cols: this.terminal.cols,
            rows: this.terminal.rows
        };
    }

    _buildWsUrl(sessionId) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = new URL(`${protocol}//${window.location.host}/api/sessions/${encodeURIComponent(sessionId)}/terminal/ws`);
        url.searchParams.set('viewerId', this.viewerId);
        url.searchParams.set('viewerLabel', this.viewerLabel);
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
