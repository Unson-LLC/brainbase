import { WebSocketServer } from 'ws';
import { detectCliState, detectCliStateWithColors } from './cli-pattern-detector.js';
import { detectPastedTextOverlay } from './pasted-text-detector.js';

const DEFAULT_SNAPSHOT_LINES = 200;
const DEFAULT_POLL_INTERVAL_MS = 350;
const READY_TIMEOUT_MS = 5000;

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
        console.log(`[TerminalTransport] handleUpgrade: url=${request?.url}, clientInfo=${JSON.stringify(clientInfo)}`);
        if (!clientInfo) {
            socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }

        this.wss.handleUpgrade(request, socket, head, (ws) => {
            console.log(`[TerminalTransport] WebSocket upgraded for ${clientInfo.sessionId}, viewerId=${clientInfo.viewerId}`);
            this.wss.emit('connection', ws, request, clientInfo);
        });
    }

    async _handleConnection(ws, request, clientInfo) {
        const { sessionId, viewerId, viewerLabel, cols, rows } = clientInfo;
        console.log(`[TerminalTransport] _handleConnection: session=${sessionId}, viewer=${viewerId}, wsState=${ws.readyState}`);
        if (!sessionId || !viewerId) {
            ws.send(JSON.stringify({ type: 'error', code: 'INVALID_REQUEST', message: 'sessionId and viewerId are required' }));
            ws.close();
            return;
        }

        const ownership = this.sessionManager.ensureTerminalOwnership(sessionId, viewerId, viewerLabel);
        console.log(`[TerminalTransport] ownership check: allowed=${ownership.allowed}, session=${sessionId}, wsState=${ws.readyState}`);
        if (!ownership.allowed) {
            ws.send(JSON.stringify({ type: 'blocked', terminalAccess: ownership.terminalAccess }));
            ws.close();
            return;
        }

        if (ws.readyState !== 1) {
            console.warn(`[TerminalTransport] WebSocket already closed before tmux check, session=${sessionId}`);
            return;
        }

        const tmuxRunning = await this.sessionManager.isTmuxSessionRunning(sessionId);
        console.log(`[TerminalTransport] tmux check: running=${tmuxRunning}, session=${sessionId}, wsState=${ws.readyState}`);
        if (!tmuxRunning) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'SESSION_NOT_RUNNING', message: 'tmux session not found' }));
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
            lastCliState: null,
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

        try {
            if (cols && rows) {
                await this.sessionManager.resizeSessionWindow(sessionId, cols, rows).catch(() => {});
            }
            await this._sendReady(connection);
            connection.pollTimer = setInterval(() => {
                void this._pollConnection(connection);
            }, this.pollIntervalMs);
        } catch (err) {
            console.error(`[TerminalTransport] _handleConnection error for ${sessionId}:`, err.message);
            if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'error', code: 'INTERNAL_ERROR', message: err.message }));
            }
            ws.close();
        }
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
        const snapshotMsg = {
            type: 'snapshot',
            text: snapshot.text,
            capturedAt: snapshot.capturedAt
        };
        if (snapshot.colorText) snapshotMsg.colorText = snapshot.colorText;
        ws.send(JSON.stringify(snapshotMsg));
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
            const pollSnapshotMsg = {
                type: 'snapshot',
                text: snapshot.text,
                capturedAt: snapshot.capturedAt
            };
            if (snapshot.colorText) pollSnapshotMsg.colorText = snapshot.colorText;
            ws.send(JSON.stringify(pollSnapshotMsg));
        }

        // CLI状態検出（色ベース優先、テキストフォールバック）
        const cliResult = detectCliStateWithColors(snapshot.text, snapshot.colorText);
        const cliState = cliResult.state;

        if (snapshot.copyMode !== connection.lastCopyMode || cliState !== connection.lastCliState) {
            connection.lastCopyMode = snapshot.copyMode;
            connection.lastCliState = cliState;
            ws.send(JSON.stringify({
                type: 'status',
                mode: 'live',
                copyMode: snapshot.copyMode,
                cliState
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

                // Pasted text detection (CommandMate pattern):
                // After sending text, check if terminal shows paste overlay and auto-dismiss
                if (inputType === 'text' && message.value && message.value.includes('\n')) {
                    await this._handlePastedTextOverlay(connection);
                }

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
            default:
                return;
        }
    }

    /**
     * ペーストテキストオーバーレイの検出＆自動解消（CommandMateパターン）
     * マルチライン入力後にオーバーレイが表示されたらEnterで確定
     * リトライ最大3回、500ms間隔
     */
    async _handlePastedTextOverlay(connection) {
        const MAX_RETRIES = 3;
        const DELAY_MS = 500;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));

            const snapshot = await this._getSnapshotPayload(connection.sessionId);
            if (!detectPastedTextOverlay(snapshot.text)) {
                return; // No overlay detected, done
            }

            // Send Enter to dismiss the overlay
            console.log(`[PastedText] Detected overlay for ${connection.sessionId}, sending Enter (attempt ${attempt + 1})`);
            await this.sessionManager.sendInput(connection.sessionId, 'C-m', 'key').catch(() => {});
        }
    }

    async _getSnapshotPayload(sessionId) {
        const [text, colorText, copyMode] = await Promise.all([
            this.sessionManager.getContent(sessionId, DEFAULT_SNAPSHOT_LINES),
            this.sessionManager.getContentWithColors(sessionId, DEFAULT_SNAPSHOT_LINES).catch(() => null),
            this.sessionManager.getPaneMode(sessionId).catch(() => false),
        ]);
        return {
            text,
            colorText,
            copyMode,
            capturedAt: new Date().toISOString()
        };
    }
}

export function getTerminalTransportRequestInfo(request) {
    return buildTerminalWsMatch(request?.url || request?.originalUrl || '');
}

export { READY_TIMEOUT_MS };
