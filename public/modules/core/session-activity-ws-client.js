/**
 * session-activity-ws-client.js
 *
 * WebSocket client for real-time session activity status updates.
 * Replaces 3-second polling with push-based updates.
 */

const MAX_RECONNECT_DELAY_MS = 30000;
const BASE_RECONNECT_DELAY_MS = 1000;

export class SessionActivityWsClient {
    constructor({ onStatusFull, onStatusUpdate, onConnectionChange }) {
        this.onStatusFull = onStatusFull;
        this.onStatusUpdate = onStatusUpdate;
        this.onConnectionChange = onConnectionChange || (() => {});
        this.ws = null;
        this._reconnectAttempt = 0;
        this._reconnectTimer = null;
        this._closed = false;
    }

    connect() {
        if (this._closed) return;
        this._clearReconnectTimer();

        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${location.host}/api/sessions/activity/ws`);
        this.ws = ws;

        ws.onopen = () => {
            this._reconnectAttempt = 0;
            this.onConnectionChange(true);
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'status-full' && msg.data) {
                    this.onStatusFull(msg.data);
                } else if (msg.type === 'status-update' && msg.sessionId) {
                    this.onStatusUpdate(msg.sessionId, msg.data);
                }
            } catch {}
        };

        ws.onclose = () => {
            if (this.ws === ws) this.ws = null;
            if (!this._closed) {
                this.onConnectionChange(false);
                this._scheduleReconnect();
            }
        };

        ws.onerror = () => {};
    }

    _scheduleReconnect() {
        if (this._closed) return;
        this._clearReconnectTimer();
        const delay = Math.min(
            BASE_RECONNECT_DELAY_MS * Math.pow(2, this._reconnectAttempt),
            MAX_RECONNECT_DELAY_MS
        );
        const jitter = Math.random() * delay * 0.3;
        this._reconnectAttempt++;
        this._reconnectTimer = setTimeout(() => this.connect(), delay + jitter);
    }

    _clearReconnectTimer() {
        if (this._reconnectTimer !== null) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }

    close() {
        this._closed = true;
        this._clearReconnectTimer();
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
    }
}
