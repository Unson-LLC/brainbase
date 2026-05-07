import { WebSocketServer } from 'ws';
import { CliState, detectCliStateWithColors } from './cli-pattern-detector.js';
import { detectPastedTextOverlay } from './pasted-text-detector.js';
import { TmuxCaptureCache } from './tmux-capture-cache.js';
import { TmuxControlRegistry } from './tmux-control-registry.js';
import { logger } from '../utils/logger.js';

const DEFAULT_SNAPSHOT_LINES = 400;
const DEFAULT_POLL_INTERVAL_MS = 350;
const READY_TIMEOUT_MS = 5000;
const INITIAL_FRAME_FALLBACK_MS = 150;
const WS_CLOSE_BLOCKED = 4001; // Custom close code: ownership taken over
const CONTROL_KEYS_WITHOUT_INPUT_PROBE = new Set(['C-c', 'C-d', 'C-l', 'C-u', 'Escape', 'M-Enter']);
const INPUT_READY_STATES = new Set([CliState.READY, CliState.IDLE, CliState.WAITING]);
const OSC_SEQUENCE_PATTERN = /\x1B\](?:[^\x07\x1B]|\x1B(?!\\))*?(?:\x07|\x1B\\)/g;
const FOCUS_EVENT_PATTERN = /\x1B\[(?:I|O)/g;

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
    constructor({
        sessionManager = null,
        ownershipService = null,
        runtimeQuery = null,
        runtimeRegistry = null,
        terminalIo = null,
        snapshotService = null,
        pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
        captureCache = null,
        controlRegistry = null
    }) {
        this.ownershipService = ownershipService || sessionManager;
        this.runtimeQuery = runtimeQuery || sessionManager;
        this.runtimeRegistry = runtimeRegistry || sessionManager;
        this.terminalIo = terminalIo || sessionManager;
        this.snapshotService = snapshotService || sessionManager;
        this.pollIntervalMs = pollIntervalMs;
        this.captureCache = captureCache || new TmuxCaptureCache({ snapshotService: this.snapshotService });
        this.controlRegistry = controlRegistry || new TmuxControlRegistry();
        this.activeConnections = new Map(); // sessionId → { viewerId, ws, connection }
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
        logger.info(`[TerminalTransport] handleUpgrade: url=${request?.url}, clientInfo=${JSON.stringify(clientInfo)}`);
        if (!clientInfo) {
            socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }

        this.wss.handleUpgrade(request, socket, head, (ws) => {
            logger.info(`[TerminalTransport] WebSocket upgraded for ${clientInfo.sessionId}, viewerId=${clientInfo.viewerId}`);
            this.wss.emit('connection', ws, request, clientInfo);
        });
    }

    async _handleConnection(ws, request, clientInfo) {
        const { sessionId, viewerId, viewerLabel, cols, rows } = clientInfo;
        logger.info(`[TerminalTransport] _handleConnection: session=${sessionId}, viewer=${viewerId}, wsState=${ws.readyState}`);
        if (!sessionId || !viewerId) {
            ws.send(JSON.stringify({ type: 'error', code: 'INVALID_REQUEST', message: 'sessionId and viewerId are required' }));
            ws.close();
            return;
        }

        const ownership = this.ownershipService.ensureTerminalOwnership(sessionId, viewerId, viewerLabel);
        logger.info(`[TerminalTransport] ownership check: allowed=${ownership.allowed}, session=${sessionId}, wsState=${ws.readyState}`);
        if (!ownership.allowed) {
            ws.send(JSON.stringify({ type: 'blocked', terminalAccess: ownership.terminalAccess }));
            ws.close(WS_CLOSE_BLOCKED, 'session_owned_by_other_viewer');
            return;
        }

        const existing = this.activeConnections.get(sessionId);
        if (existing && existing.viewerId !== viewerId && existing.ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'blocked', terminalAccess: ownership.terminalAccess }));
            ws.close(WS_CLOSE_BLOCKED, 'session_owned_by_other_viewer');
            return;
        }

        if (ws.readyState !== 1) {
            logger.warn(`[TerminalTransport] WebSocket already closed before tmux check, session=${sessionId}`);
            return;
        }

        const tmuxRunning = await this.runtimeQuery.isTmuxSessionRunning(sessionId);
        logger.info(`[TerminalTransport] tmux check: running=${tmuxRunning}, session=${sessionId}, wsState=${ws.readyState}`);
        if (!tmuxRunning) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'SESSION_NOT_RUNNING', message: 'tmux session not found' }));
            ws.close();
            return;
        }

        const hasClientDimensions = Boolean(cols && rows);
        const connection = {
            ws,
            sessionId,
            viewerId,
            viewerLabel,
            cols: cols || 120,
            rows: rows || 40,
            hasClientDimensions,
            closed: false,
            lastSnapshot: null,
            lastCopyMode: null,
            lastCliState: null,
            pollTimer: null,
            transport: 'snapshot',
            controlClient: null,
            streamCleanup: null,
            initialFrameDelivered: false,
            initialSnapshotTimer: null,
            terminalAccess: ownership.terminalAccess,
            inputReady: false,
            runtimeState: 'transport_connected',
            messageQueue: Promise.resolve()
        };

        this.activeConnections.set(sessionId, { viewerId, ws, connection });

        const closeConnection = () => {
            if (connection.closed) return;
            connection.closed = true;
            if (connection.pollTimer) {
                clearInterval(connection.pollTimer);
                connection.pollTimer = null;
            }
            if (typeof connection.streamCleanup === 'function') {
                connection.streamCleanup();
                connection.streamCleanup = null;
            }
            if (connection.initialSnapshotTimer) {
                clearTimeout(connection.initialSnapshotTimer);
                connection.initialSnapshotTimer = null;
            }
            // activeConnectionsから削除（自分の接続の場合のみ）
            const current = this.activeConnections.get(sessionId);
            if (current && current.ws === ws) {
                this.activeConnections.delete(sessionId);
            }
            this.runtimeRegistry?.setGateway?.(sessionId, {
                connected: false,
                viewerId,
                viewerLabel,
                disconnectedAt: new Date().toISOString()
            });
        };

        ws.on('close', closeConnection);
        ws.on('error', closeConnection);
        ws.on('message', (raw) => {
            connection.messageQueue = connection.messageQueue
                .then(() => this._handleMessage(connection, raw.toString()))
                .catch((err) => {
                    const message = err instanceof Error ? err.message : String(err);
                    logger.error(`[TerminalTransport] message error for ${sessionId}:`, message);
                    if (ws.readyState === 1) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            code: 'INPUT_ERROR',
                            message: message || 'Failed to process terminal input'
                        }));
                    }
                });
        });

        try {
            if (cols && rows) {
                await this.terminalIo.resizeSessionWindow(sessionId, cols, rows).catch(() => {});
            }
            // ready は先に返すが、初回描画が来ないと session switch が完了したように見えない。
            // 以降も tmux の可視 pane を正として polling し、control-mode の差分適用で
            // cursor/status 行が drift する経路を使わない。
            await this._sendReady(connection);
            this._startSnapshotPolling(connection);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`[TerminalTransport] _handleConnection error for ${sessionId}:`, message);
            if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'error', code: 'INTERNAL_ERROR', message }));
            }
            ws.close();
        }
    }

    async _sendReady(connection) {
        const { sessionId, viewerId, viewerLabel, ws, cols, rows } = connection;
        this.ownershipService.touchTerminalOwnership(sessionId, viewerId, viewerLabel);
        this.runtimeRegistry?.setGateway?.(sessionId, {
            connected: true,
            viewerId,
            viewerLabel,
            connectedAt: new Date().toISOString()
        });
        if (ws.readyState !== 1) return;
        ws.send(JSON.stringify({
            type: 'ready',
            sessionId,
            cols,
            rows,
            ...this._buildRuntimeStatusPayload(connection)
        }));

        // Eager snapshot: セッション切り替え直後の黒画面を防ぐため、
        // readyと同時にスナップショットを送る。
        // ストリーミング出力は8msバッチで送られるため、snapshot+streamingの
        // 重なり描画（ghosting）は発生しない。
        try {
            const snapshot = await this._getSnapshotPayload(sessionId, { includeColors: true });
            const visibleSnapshot = await this._getSnapshotPayload(sessionId, { includeColors: true, visibleOnly: true });
            if (ws.readyState !== 1) return;
            connection.lastSnapshot = visibleSnapshot.text;
            connection.lastCopyMode = visibleSnapshot.copyMode;
            connection.initialFrameDelivered = true;
            const snapshotMsg = {
                type: 'snapshot',
                text: snapshot.text,
                visibleText: visibleSnapshot.text,
                capturedAt: visibleSnapshot.capturedAt
            };
            if (snapshot.colorText) snapshotMsg.colorText = snapshot.colorText;
            if (visibleSnapshot.colorText) snapshotMsg.visibleColorText = visibleSnapshot.colorText;
            if (visibleSnapshot.cursor) snapshotMsg.cursor = visibleSnapshot.cursor;
            ws.send(JSON.stringify(snapshotMsg));
        } catch {
            // スナップショット失敗時はストリーミングかフォールバックに任せる
        }
    }

    _startSnapshotPolling(connection) {
        if (connection.closed) return;
        connection.transport = 'snapshot-polling';
        if (connection.ws.readyState === 1) {
            connection.ws.send(JSON.stringify({
                type: 'status',
                mode: 'live',
                copyMode: connection.lastCopyMode || false,
                transport: connection.transport,
                ...this._buildRuntimeStatusPayload(connection)
            }));
        }
        void this._pollConnection(connection);
        if (!connection.pollTimer) {
            connection.pollTimer = setInterval(() => {
                void this._pollConnection(connection);
            }, this.pollIntervalMs);
        }
    }

    async _startStreaming(connection) {
        if (connection.closed) return;

        try {
            const client = this.controlRegistry.acquire(connection.sessionId);
            connection.controlClient = client;
            connection.transport = 'streaming';

            let outputBatch = '';
            let outputBatchTimer = null;
            // streaming 中は touchTerminalOwnership を呼ぶパスがないため、
            // 出力が来るたびに throttle して ownership を refresh する。
            const OWNERSHIP_TOUCH_INTERVAL_MS = 60_000;
            let lastOwnershipTouchAt = Date.now();
            const touchOwnershipThrottled = () => {
                const now = Date.now();
                if (now - lastOwnershipTouchAt >= OWNERSHIP_TOUCH_INTERVAL_MS) {
                    lastOwnershipTouchAt = now;
                    this.ownershipService.touchTerminalOwnership(connection.sessionId, connection.viewerId, connection.viewerLabel);
                }
            };
            const flushOutputBatch = () => {
                outputBatchTimer = null;
                if (!outputBatch || connection.closed || connection.ws.readyState !== 1) {
                    outputBatch = '';
                    return;
                }
                const flushed = outputBatch;
                outputBatch = '';
                // DEBUG: detect FFFD in streaming output
                if (flushed.includes('\uFFFD')) {
                    logger.warn(`[TerminalTransport] FFFD detected in streaming output for ${connection.sessionId}: len=${flushed.length}, fffd_count=${(flushed.match(/\uFFFD/g) || []).length}, snippet=${JSON.stringify(flushed.slice(0, 200))}`);
                }
                connection.ws.send(JSON.stringify({ type: 'output', data: flushed }));
            };
            const handleOutput = (data) => {
                if (connection.closed || connection.ws.readyState !== 1 || !data) return;
                touchOwnershipThrottled();
                connection.initialFrameDelivered = true;
                if (connection.initialSnapshotTimer) {
                    clearTimeout(connection.initialSnapshotTimer);
                    connection.initialSnapshotTimer = null;
                }
                outputBatch += data;
                if (outputBatchTimer === null) {
                    outputBatchTimer = setTimeout(flushOutputBatch, 8);
                }
            };
            const handleFailure = () => {
                void this._fallbackToPolling(connection);
            };

            client.on('output', handleOutput);
            client.on('error', handleFailure);
            client.on('exit', handleFailure);

            connection.streamCleanup = () => {
                if (outputBatchTimer !== null) {
                    clearTimeout(outputBatchTimer);
                    outputBatchTimer = null;
                }
                outputBatch = '';
                client.off('output', handleOutput);
                client.off('error', handleFailure);
                client.off('exit', handleFailure);
                this.controlRegistry.release(connection.sessionId, client);
            };

            // クライアントが明示的にcols/rowsを送信した場合のみ初期resize
            // skipInitialResize=trueの場合、デフォルト120x40でresizeすると
            // クライアントが正しいサイズを送るまでの間に誤った幅で出力される
            if (connection.hasClientDimensions && connection.cols && connection.rows) {
                client.resize(connection.cols, connection.rows);
            }
        } catch (error) {
            logger.warn(`[TerminalTransport] streaming start failed for ${connection.sessionId}: ${error instanceof Error ? error.message : String(error)}`);
            await this._fallbackToPolling(connection);
        }
    }

    _scheduleInitialSnapshotFallback(connection) {
        if (connection.closed || connection.transport !== 'streaming') return;
        if (connection.initialSnapshotTimer) {
            clearTimeout(connection.initialSnapshotTimer);
        }

        connection.initialSnapshotTimer = setTimeout(() => {
            connection.initialSnapshotTimer = null;
            if (connection.closed || connection.initialFrameDelivered || connection.transport !== 'streaming') {
                return;
            }
            void this._sendInitialSnapshot(connection);
        }, INITIAL_FRAME_FALLBACK_MS);
    }

    async _sendInitialSnapshot(connection) {
        if (connection.closed || connection.ws.readyState !== 1) return;

        this.captureCache.invalidate(connection.sessionId);
        const snapshot = await this._getSnapshotPayload(connection.sessionId, { includeColors: true });
        const visibleSnapshot = await this._getSnapshotPayload(connection.sessionId, { includeColors: true, visibleOnly: true });
        connection.initialFrameDelivered = true;
        connection.lastSnapshot = visibleSnapshot.text;
        connection.lastCopyMode = visibleSnapshot.copyMode;

        const cliResult = detectCliStateWithColors(visibleSnapshot.text, visibleSnapshot.colorText);
        connection.lastCliState = cliResult.state;
        this.runtimeRegistry?.setCliState?.(connection.sessionId, cliResult);

        const snapshotMsg = {
            type: 'snapshot',
            text: snapshot.text,
            visibleText: visibleSnapshot.text,
            capturedAt: visibleSnapshot.capturedAt
        };
        if (snapshot.colorText) snapshotMsg.colorText = snapshot.colorText;
        if (visibleSnapshot.colorText) snapshotMsg.visibleColorText = visibleSnapshot.colorText;
        if (visibleSnapshot.cursor) snapshotMsg.cursor = visibleSnapshot.cursor;
        connection.ws.send(JSON.stringify(snapshotMsg));
        connection.ws.send(JSON.stringify({
            type: 'status',
            mode: 'live',
            copyMode: visibleSnapshot.copyMode,
            transport: 'streaming',
            cliState: cliResult.state,
            ...this._buildRuntimeStatusPayload(connection)
        }));
    }

    async _fallbackToPolling(connection) {
        if (connection.closed || connection.transport === 'snapshot') return;

        if (typeof connection.streamCleanup === 'function') {
            connection.streamCleanup();
            connection.streamCleanup = null;
        }
        connection.controlClient = null;
        connection.transport = 'snapshot';

        if (connection.ws.readyState === 1) {
            connection.ws.send(JSON.stringify({
                type: 'status',
                mode: 'snapshot',
                copyMode: connection.lastCopyMode || false,
                transport: 'snapshot',
                ...this._buildRuntimeStatusPayload(connection)
            }));
        }

        await this._pollConnection(connection);
        if (!connection.pollTimer) {
            connection.pollTimer = setInterval(() => {
                void this._pollConnection(connection);
            }, this.pollIntervalMs);
        }
    }

    async _pollConnection(connection) {
        if (connection.closed) return;
        const { ws, sessionId, viewerId, viewerLabel } = connection;
        if (ws.readyState !== 1) return;

        this.ownershipService.touchTerminalOwnership(sessionId, viewerId, viewerLabel);
        const terminalAccess = this.ownershipService.getTerminalAccessState(sessionId, viewerId);
        connection.terminalAccess = terminalAccess;
        if (terminalAccess?.state !== 'owner') {
            ws.send(JSON.stringify({ type: 'blocked', terminalAccess }));
            ws.close(WS_CLOSE_BLOCKED, 'ownership_taken_over');
            return;
        }

        const tmuxRunning = await this.runtimeQuery.isTmuxSessionRunning(sessionId);
        if (!tmuxRunning) {
            ws.send(JSON.stringify({ type: 'error', code: 'SESSION_NOT_RUNNING', message: 'tmux session not found' }));
            ws.close();
            return;
        }

        const screenOnlySnapshot = connection.transport === 'streaming';
        const liveSnapshotPolling = connection.transport === 'snapshot-polling';
        const snapshot = await this._getSnapshotPayload(sessionId, { includeColors: true, visibleOnly: screenOnlySnapshot });
        const visibleSnapshot = liveSnapshotPolling
            ? await this._getSnapshotPayload(sessionId, { includeColors: true, visibleOnly: true })
            : null;
        const snapshotKey = JSON.stringify({
            text: snapshot.text,
            colorText: snapshot.colorText || null,
            cursor: snapshot.cursor || null,
            visibleText: visibleSnapshot?.text || null,
            visibleColorText: visibleSnapshot?.colorText || null,
            visibleCursor: visibleSnapshot?.cursor || null
        });
        if (snapshotKey !== connection.lastSnapshot) {
            connection.lastSnapshot = snapshotKey;
            const pollSnapshotMsg = {
                type: 'snapshot',
                text: snapshot.text,
                capturedAt: snapshot.capturedAt,
                screenOnly: screenOnlySnapshot
            };
            if (snapshot.colorText) pollSnapshotMsg.colorText = snapshot.colorText;
            if (visibleSnapshot) {
                pollSnapshotMsg.visibleText = visibleSnapshot.text;
                if (visibleSnapshot.colorText) pollSnapshotMsg.visibleColorText = visibleSnapshot.colorText;
                if (visibleSnapshot.cursor) pollSnapshotMsg.cursor = visibleSnapshot.cursor;
            } else if (snapshot.cursor) {
                pollSnapshotMsg.cursor = snapshot.cursor;
            }
            ws.send(JSON.stringify(pollSnapshotMsg));
        }

        // CLI状態検出（色ベース優先、テキストフォールバック）
        const statusSnapshot = visibleSnapshot || snapshot;
        const cliResult = detectCliStateWithColors(statusSnapshot.text, statusSnapshot.colorText);
        const cliState = cliResult.state;
        this.runtimeRegistry?.setCliState?.(sessionId, cliResult);

        if (statusSnapshot.copyMode !== connection.lastCopyMode || cliState !== connection.lastCliState) {
            connection.lastCopyMode = statusSnapshot.copyMode;
            connection.lastCliState = cliState;
            ws.send(JSON.stringify({
                type: 'status',
                mode: screenOnlySnapshot || liveSnapshotPolling ? 'live' : 'snapshot',
                copyMode: statusSnapshot.copyMode,
                transport: connection.transport,
                cliState,
                ...this._buildRuntimeStatusPayload(connection)
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
                    ws.send(JSON.stringify({
                        type: 'status',
                        mode: connection.transport === 'streaming' || connection.transport === 'snapshot-polling' ? 'live' : 'snapshot',
                        copyMode: connection.lastCopyMode || false,
                        transport: connection.transport,
                        ...this._buildRuntimeStatusPayload(connection)
                    }));
                }
                return;
            }
            case 'input': {
                const terminalAccess = this.ownershipService.getTerminalAccessState(sessionId, viewerId);
                connection.terminalAccess = terminalAccess;
                const inputTypeForLog = message.inputType === 'key' ? 'key' : 'text';
                const rawValue = typeof message.value === 'string' ? message.value : '';
                const normalizedValue = inputTypeForLog === 'text'
                    ? this._stripTerminalControlResponses(rawValue)
                    : rawValue;
                const valueLen = normalizedValue.length;
                // 入力内容を識別可能な形でログ出力 (Enter検出のため)
                const valueDebug = normalizedValue
                    ? normalizedValue.replace(/[\x00-\x1F\x7F]/g, c => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`).slice(0, 60)
                    : '';
                logger.info(`[TTC-PROBE][ws-input] session=${sessionId} type=${inputTypeForLog} len=${valueLen} owner=${terminalAccess?.state} debug="${valueDebug}"`);
                if (inputTypeForLog === 'text' && !normalizedValue && rawValue) {
                    logger.info(`[INPUT-TELEMETRY] ignored reason=TERMINAL_CONTROL_RESPONSE session=${sessionId} originalLen=${rawValue.length}`);
                    return;
                }
                if (terminalAccess?.state !== 'owner') {
                    logger.warn(`[TTC-PROBE][ws-input] dropped NOT_OWNER session=${sessionId} len=${valueLen}`);
                    logger.warn(`[INPUT-TELEMETRY] dropped reason=NOT_OWNER session=${sessionId} len=${valueLen} viewer=${viewerId}`);
                    ws.send(JSON.stringify({ type: 'blocked', terminalAccess }));
                    return;
                }
                const inputType = inputTypeForLog;
                // ナビゲーション系 escape sequence (矢印/Tab/Escape/Function key) は
                // CLI state 検出に失敗する Codex 選択画面でも送信する必要があるため、
                // probe チェックをバイパスする。
                const isNavEscape = inputType === 'text' && this._isNavigationEscape(normalizedValue);
                const isControlTextInput = inputType === 'text' && this._isControlTextInput(normalizedValue);
                const canBypassProbe = (inputType === 'key' && CONTROL_KEYS_WITHOUT_INPUT_PROBE.has(normalizedValue))
                    || isNavEscape
                    || isControlTextInput;
                if (!canBypassProbe
                    && !this._getInputReady(sessionId)
                    && !(await this._recoverInputReadyFromSnapshot(sessionId, viewerId, viewerLabel))
                ) {
                    logger.warn(`[TTC-PROBE][ws-input] dropped INPUT_NOT_READY session=${sessionId} len=${valueLen}`);
                    logger.warn(`[INPUT-TELEMETRY] dropped reason=INPUT_NOT_READY session=${sessionId} len=${valueLen} type=${inputType}`);
                    ws.send(JSON.stringify({
                        type: 'error',
                        code: 'INPUT_NOT_READY',
                        message: 'Terminal input has not been verified'
                    }));
                    return;
                }
                try {
                    await this.terminalIo.sendInput(sessionId, normalizedValue, inputType);
                    logger.info(`[INPUT-TELEMETRY] sentOk session=${sessionId} len=${valueLen} type=${inputType}`);
                } catch (err) {
                    logger.warn(`[INPUT-TELEMETRY] dropped reason=MUTATION_TIMEOUT_OR_FAILED session=${sessionId} len=${valueLen} err=${err?.message || err}`);
                    throw err;
                }
                this.captureCache.invalidate(sessionId);
                this.ownershipService.touchTerminalOwnership(sessionId, viewerId, viewerLabel);

                if (inputType === 'text' && normalizedValue && normalizedValue.includes('\n')) {
                    void this._handlePastedTextOverlay(connection);
                }

                if (connection.transport !== 'streaming') {
                    await this._pollConnection(connection);
                }
                return;
            }
            case 'resize': {
                const cols = Number(message.cols);
                const rows = Number(message.rows);
                this.captureCache.invalidate(sessionId);
                if (Number.isFinite(cols) && cols > 0) {
                    connection.cols = cols;
                }
                if (Number.isFinite(rows) && rows > 0) {
                    connection.rows = rows;
                }

                if (connection.transport === 'streaming' && connection.controlClient) {
                    await this.terminalIo.resizeSessionWindow(sessionId, cols, rows);
                    connection.controlClient.resize(cols, rows);
                } else {
                    await this.terminalIo.resizeSessionWindow(sessionId, cols, rows);
                    await this._pollConnection(connection);
                }
                return;
            }
            case 'exit_copy_mode': {
                await this.terminalIo.exitCopyMode(sessionId);
                this.captureCache.invalidate(sessionId);
                // Push fresh copyMode to client immediately (streaming mode doesn't poll)
                const freshSnapshot = await this._getSnapshotPayload(sessionId, { includeCopyMode: true });
                connection.lastCopyMode = freshSnapshot.copyMode;
                if (ws.readyState === 1) {
                    ws.send(JSON.stringify({
                        type: 'status',
                        mode: connection.transport === 'streaming' || connection.transport === 'snapshot-polling' ? 'live' : 'snapshot',
                        copyMode: freshSnapshot.copyMode,
                        transport: connection.transport
                    }));
                }
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
            logger.info(`[PastedText] Detected overlay for ${connection.sessionId}, sending Enter (attempt ${attempt + 1})`);
            await this.terminalIo.sendInput(connection.sessionId, 'Enter', 'key').catch(() => {});
            this.captureCache.invalidate(connection.sessionId);
        }
    }

    async _getSnapshotPayload(sessionId, options = {}) {
        return await this.captureCache.getSnapshot(sessionId, {
            lines: DEFAULT_SNAPSHOT_LINES,
            includeColors: options.includeColors === true,
            includeCopyMode: options.includeCopyMode !== false,
            visibleOnly: options.visibleOnly === true
        });
    }

    _getInputReady(sessionId) {
        const entry = this.runtimeRegistry?.getSession?.(sessionId);
        return entry?.observed?.inputProbe?.status === 'passed';
    }

    _stripTerminalControlResponses(value) {
        if (typeof value !== 'string' || !value) return value;
        return value
            .replace(OSC_SEQUENCE_PATTERN, '')
            .replace(FOCUS_EVENT_PATTERN, '');
    }

    async _recoverInputReadyFromSnapshot(sessionId, viewerId, viewerLabel) {
        try {
            const snapshot = await this._getSnapshotPayload(sessionId, {
                includeColors: true,
                includeCopyMode: true
            });
            if (snapshot.copyMode) {
                logger.info(`[TTC-PROBE][ws-input] snapshot readiness blocked copyMode session=${sessionId}`);
                return false;
            }

            const cliResult = detectCliStateWithColors(snapshot.text, snapshot.colorText);
            this.runtimeRegistry?.setCliState?.(sessionId, cliResult);
            if (!INPUT_READY_STATES.has(cliResult.state)) {
                logger.info(`[TTC-PROBE][ws-input] snapshot readiness failed session=${sessionId} cliState=${cliResult.state} reason=${cliResult.reason || 'none'}`);
                return false;
            }

            const probe = {
                status: 'passed',
                lastPassedAt: new Date().toISOString(),
                lastFailedAt: null,
                reason: null,
                mode: 'snapshot_recovery',
                cliReason: cliResult.reason || null
            };
            this.runtimeRegistry?.setInputProbe?.(sessionId, probe);
            this.ownershipService?.touchTerminalOwnership?.(sessionId, viewerId, viewerLabel);
            logger.info(`[TTC-PROBE][ws-input] snapshot readiness recovered session=${sessionId} cliState=${cliResult.state} reason=${cliResult.reason || 'none'}`);
            return true;
        } catch (err) {
            logger.warn(`[TTC-PROBE][ws-input] snapshot readiness error session=${sessionId} err=${err?.message || err}`);
            return false;
        }
    }

    /**
     * 矢印・Tab・Escape・Function key 等のナビゲーション系 escape sequence。
     * Codex 選択画面のように CLI state 検出が CLI_NOT_IDLE になる状態でも、
     * これらは送信して良い (Codex/Claude Code が選択肢を移動するため)。
     */
    _isNavigationEscape(value) {
        if (typeof value !== 'string' || !value) return false;
        if (value.charCodeAt(0) !== 0x1B) return false;
        if (value === '\x1B') return true;
        return /^\x1B(?:\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]|O[A-Z~])$/.test(value);
    }

    _isControlTextInput(value) {
        return value === '\r'
            || value === '\n'
            || value === '\r\n'
            || value === '\t'
            || value === '\x7f';
    }

    _buildRuntimeStatusPayload(connection) {
        const registryEntry = this.runtimeRegistry?.getSession?.(connection.sessionId);
        const inputProbe = registryEntry?.observed?.inputProbe || null;
        const inputReady = inputProbe?.status === 'passed';
        connection.inputReady = inputReady;
        connection.runtimeState = inputReady
            ? 'interactive_ready'
            : (registryEntry?.runtimeState || 'transport_connected');
        return {
            runtimeState: connection.runtimeState,
            inputReady,
            inputProbe,
            terminalAccess: connection.terminalAccess || null
        };
    }
}

export function getTerminalTransportRequestInfo(request) {
    return buildTerminalWsMatch(request?.url || request?.originalUrl || '');
}

export { READY_TIMEOUT_MS, WS_CLOSE_BLOCKED };
