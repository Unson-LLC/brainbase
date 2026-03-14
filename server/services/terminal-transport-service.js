import { WebSocketServer } from 'ws';

const DEFAULT_SNAPSHOT_LINES = 200;
const DEFAULT_POLL_INTERVAL_MS = 350;
const READY_TIMEOUT_MS = 5000;
const MAX_SCROLL_STEPS = 8;

function safeJsonParse(raw) {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function buildTerminalWsMatch(urlString = '') {
    try {
        const parsed = new URL(urlString, 'http://localhost');
        const match = parsed.pathname.match(/^\/api\/sessions\/([^/]+)\/terminal\/ws$/);
        if (!match) return null;
        const cols = Number(parsed.searchParams.get('cols'));
        const rows = Number(parsed.searchParams.get('rows'));
        return {
            sessionId: decodeURIComponent(match[1]),
            viewerId: parsed.searchParams.get('viewerId') || '',
            viewerLabel: parsed.searchParams.get('viewerLabel') || '',
            cols: Number.isFinite(cols) && cols > 0 ? cols : null,
            rows: Number.isFinite(rows) && rows > 0 ? rows : null
        };
    } catch {
        return null;
    }
}

export class TerminalTransportService {
    constructor({ sessionManager, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS }) {
        this.sessionManager = sessionManager;
        this.pollIntervalMs = pollIntervalMs;
        this.wss = new WebSocketServer({ noServer: true });
        this.wss.on('connection', (ws, request, clientInfo) => {
            void this._handleConnection(ws, request, clientInfo);
        });
    }

    isTerminalTransportRequest(request) {
        return Boolean(buildTerminalWsMatch(request?.url || request?.originalUrl || ''));
    }

    handleUpgrade(request, socket, head) {
        const clientInfo = buildTerminalWsMatch(request?.url || request?.originalUrl || '');
        if (!clientInfo) {
            socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }

        this.wss.handleUpgrade(request, socket, head, (ws) => {
            this.wss.emit('connection', ws, request, clientInfo);
        });
    }

    async _handleConnection(ws, request, clientInfo) {
        const { sessionId, viewerId, viewerLabel, cols, rows } = clientInfo;
        if (!sessionId || !viewerId) {
            ws.send(JSON.stringify({ type: 'error', code: 'INVALID_REQUEST', message: 'sessionId and viewerId are required' }));
            ws.close();
            return;
        }

        const ownership = this.sessionManager.ensureTerminalOwnership(sessionId, viewerId, viewerLabel);
        if (!ownership.allowed) {
            ws.send(JSON.stringify({ type: 'blocked', terminalAccess: ownership.terminalAccess }));
            ws.close();
            return;
        }

        const tmuxRunning = await this.sessionManager.isTmuxSessionRunning(sessionId);
        if (!tmuxRunning) {
            ws.send(JSON.stringify({ type: 'error', code: 'SESSION_NOT_RUNNING', message: 'tmux session not found' }));
            ws.close();
            return;
        }

        const connection = {
            ws,
            sessionId,
            viewerId,
            viewerLabel,
            cols: cols || 120,
            rows: rows || 40,
            closed: false,
            lastSnapshot: null,
            lastCopyMode: null,
            pollTimer: null
        };

        const closeConnection = () => {
            if (connection.closed) return;
            connection.closed = true;
            if (connection.pollTimer) {
                clearInterval(connection.pollTimer);
                connection.pollTimer = null;
            }
        };

        ws.on('close', closeConnection);
        ws.on('error', closeConnection);
        ws.on('message', (raw) => {
            void this._handleMessage(connection, raw.toString());
        });

        if (cols && rows) {
            await this.sessionManager.resizeSessionWindow(sessionId, cols, rows).catch(() => {});
        }
        await this._sendReady(connection);
        connection.pollTimer = setInterval(() => {
            void this._pollConnection(connection);
        }, this.pollIntervalMs);
    }

    async _sendReady(connection) {
        const { sessionId, viewerId, viewerLabel, ws, cols, rows } = connection;
        this.sessionManager.touchTerminalOwnership(sessionId, viewerId, viewerLabel);
        const snapshot = await this._getSnapshotPayload(sessionId);
        connection.lastSnapshot = snapshot.text;
        connection.lastCopyMode = snapshot.copyMode;
        if (ws.readyState !== 1) return;
        ws.send(JSON.stringify({
            type: 'ready',
            sessionId,
            cols,
            rows
        }));
        ws.send(JSON.stringify({
            type: 'snapshot',
            text: snapshot.text,
            capturedAt: snapshot.capturedAt
        }));
        ws.send(JSON.stringify({
            type: 'status',
            mode: 'live',
            copyMode: snapshot.copyMode
        }));
    }

    async _pollConnection(connection) {
        if (connection.closed) return;
        const { ws, sessionId, viewerId, viewerLabel } = connection;
        if (ws.readyState !== 1) return;

        this.sessionManager.touchTerminalOwnership(sessionId, viewerId, viewerLabel);
        const ownership = this.sessionManager.ensureTerminalOwnership(sessionId, viewerId, viewerLabel);
        if (!ownership.allowed) {
            ws.send(JSON.stringify({ type: 'blocked', terminalAccess: ownership.terminalAccess }));
            ws.close();
            return;
        }

        const tmuxRunning = await this.sessionManager.isTmuxSessionRunning(sessionId);
        if (!tmuxRunning) {
            ws.send(JSON.stringify({ type: 'error', code: 'SESSION_NOT_RUNNING', message: 'tmux session not found' }));
            ws.close();
            return;
        }

        const snapshot = await this._getSnapshotPayload(sessionId);
        if (snapshot.text !== connection.lastSnapshot) {
            connection.lastSnapshot = snapshot.text;
            ws.send(JSON.stringify({
                type: 'snapshot',
                text: snapshot.text,
                capturedAt: snapshot.capturedAt
            }));
        }

        if (snapshot.copyMode !== connection.lastCopyMode) {
            connection.lastCopyMode = snapshot.copyMode;
            ws.send(JSON.stringify({
                type: 'status',
                mode: 'live',
                copyMode: snapshot.copyMode
            }));
        }
    }

    async _handleMessage(connection, rawMessage) {
        const message = safeJsonParse(rawMessage);
        if (!message || typeof message.type !== 'string') return;

        const { sessionId, viewerId, viewerLabel, ws } = connection;
        switch (message.type) {
            case 'ping': {
                if (ws.readyState === 1) {
                    ws.send(JSON.stringify({ type: 'status', mode: 'live', copyMode: connection.lastCopyMode || false }));
                }
                return;
            }
            case 'input': {
                const inputType = message.inputType === 'key' ? 'key' : 'text';
                await this.sessionManager.sendInput(sessionId, message.value, inputType);
                this.sessionManager.touchTerminalOwnership(sessionId, viewerId, viewerLabel);
                await this._pollConnection(connection);
                return;
            }
            case 'resize': {
                const cols = Number(message.cols);
                const rows = Number(message.rows);
                await this.sessionManager.resizeSessionWindow(sessionId, cols, rows);
                if (Number.isFinite(cols) && cols > 0) {
                    connection.cols = cols;
                }
                if (Number.isFinite(rows) && rows > 0) {
                    connection.rows = rows;
                }
                await this._pollConnection(connection);
                return;
            }
            case 'scroll': {
                const safeDirection = message.direction === 'down' ? 'down' : message.direction === 'up' ? 'up' : null;
                if (!safeDirection) return;
                const safeSteps = Math.min(MAX_SCROLL_STEPS, Math.max(1, Number(message.steps) || 1));
                await this.sessionManager.scrollSession(sessionId, safeDirection, safeSteps);
                this.sessionManager.touchTerminalOwnership(sessionId, viewerId, viewerLabel);
                await this._pollConnection(connection);
                return;
            }
            case 'exit_copy_mode': {
                await this.sessionManager.exitCopyMode(sessionId);
                this.sessionManager.touchTerminalOwnership(sessionId, viewerId, viewerLabel);
                await this._pollConnection(connection);
                return;
            }
            default:
                return;
        }
    }

    async _getSnapshotPayload(sessionId) {
        const text = await this.sessionManager.getContent(sessionId, DEFAULT_SNAPSHOT_LINES);
        const copyMode = await this.sessionManager.getPaneMode(sessionId).catch(() => false);
        return {
            text,
            copyMode,
            capturedAt: new Date().toISOString()
        };
    }
}

export function getTerminalTransportRequestInfo(request) {
    return buildTerminalWsMatch(request?.url || request?.originalUrl || '');
}

export { READY_TIMEOUT_MS };
