import { WebSocketServer } from 'ws';
import { logger } from '../utils/logger.js';

export class SessionActivityWsService {
    constructor({ activityService, fullStatusIntervalMs = 0 }) {
        this.activityService = activityService;
        this.wss = new WebSocketServer({ noServer: true });
        this.clients = new Set();
        this._fullStatusInterval = null;
        if (fullStatusIntervalMs > 0) {
            this._fullStatusInterval = setInterval(() => {
                this.broadcastFullStatus();
            }, fullStatusIntervalMs);
            this._fullStatusInterval.unref?.();
        }
    }

    isActivityWsRequest(request) {
        const url = request?.url || request?.originalUrl || '';
        return url.startsWith('/api/sessions/activity/ws');
    }

    handleUpgrade(request, socket, head) {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
            this.clients.add(ws);
            logger.info(`[ActivityWs] Client connected (total: ${this.clients.size})`);

            try {
                ws.send(this._createFullStatusMessage());
            } catch (err) {
                logger.warn(`[ActivityWs] Failed to send initial status: ${err.message}`);
            }

            ws.on('close', () => {
                this.clients.delete(ws);
                logger.info(`[ActivityWs] Client disconnected (total: ${this.clients.size})`);
            });
            ws.on('error', () => {
                this.clients.delete(ws);
            });
        });
    }

    _createFullStatusMessage() {
        return JSON.stringify({
            type: 'status-full',
            data: this.activityService.getSessionStatus()
        });
    }

    broadcastFullStatus() {
        if (this.clients.size === 0) return;
        let msg;
        try {
            msg = this._createFullStatusMessage();
        } catch (err) {
            logger.warn(`[ActivityWs] Failed to create full status: ${err.message}`);
            return;
        }
        for (const ws of this.clients) {
            if (ws.readyState === 1) {
                try {
                    ws.send(msg);
                } catch {}
            }
        }
    }

    close() {
        if (this._fullStatusInterval) {
            clearInterval(this._fullStatusInterval);
            this._fullStatusInterval = null;
        }
        for (const ws of this.clients) {
            try {
                ws.close();
            } catch {}
        }
        this.clients.clear();
        this.wss.close();
    }

    broadcast(sessionId, hookStatus) {
        const state = hookStatus?.isWorking ? 'working' : hookStatus?.isDone ? 'done' : 'idle';
        logger.debug(`[ActivityWs] broadcast ${sessionId}: ${state} (clients=${this.clients.size})`);
        if (this.clients.size === 0) return;
        const msg = JSON.stringify({
            type: 'status-update',
            sessionId,
            data: hookStatus
        });
        for (const ws of this.clients) {
            if (ws.readyState === 1) {
                try {
                    ws.send(msg);
                } catch {}
            }
        }
    }
}
