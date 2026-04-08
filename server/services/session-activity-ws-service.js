import { WebSocketServer } from 'ws';
import { logger } from '../utils/logger.js';

export class SessionActivityWsService {
    constructor({ activityService }) {
        this.activityService = activityService;
        this.wss = new WebSocketServer({ noServer: true });
        this.clients = new Set();
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
                ws.send(JSON.stringify({
                    type: 'status-full',
                    data: this.activityService.getSessionStatus()
                }));
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

    broadcast(sessionId, hookStatus) {
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
