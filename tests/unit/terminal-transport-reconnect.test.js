import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalTransportClient } from '../../public/modules/core/terminal-transport-client.js';
import { httpClient } from '../../public/modules/core/http-client.js';

/**
 * WebSocket再接続の改善テスト
 * CommandMateパターン移植: 指数バックオフ、高リトライ数、keepalive、expected close codes
 */

function createMockWs(options = {}) {
    const { autoReady = false, readyState = 1 } = options;
    const ws = {
        OPEN: 1,
        CONNECTING: 0,
        readyState,
        listeners: new Map(),
        sentMessages: [],
        addEventListener(type, listener, opts) {
            const current = ws.listeners.get(type) || [];
            current.push({ listener, once: opts?.once || false });
            ws.listeners.set(type, current);
        },
        send(message) {
            ws.sentMessages.push(JSON.parse(message));
        },
        close() {
            ws.readyState = 3;
        },
        _emit(type, event) {
            const handlers = ws.listeners.get(type) || [];
            for (const { listener, once } of [...handlers]) {
                listener(event);
                if (once) {
                    const idx = handlers.findIndex(h => h.listener === listener);
                    if (idx >= 0) handlers.splice(idx, 1);
                }
            }
        }
    };
    if (autoReady) {
        queueMicrotask(() => {
            ws._emit('message', {
                data: JSON.stringify({ type: 'ready', sessionId: 'test-session' })
            });
        });
    }
    return ws;
}

function emitReady(ws, sessionId = 'test-session') {
    ws._emit('message', {
        data: JSON.stringify({ type: 'ready', sessionId })
    });
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

function createClient(overrides = {}) {
    const client = new TerminalTransportClient({
        viewerId: 'viewer-test',
        viewerLabel: 'Local / Mac',
        ...overrides
    });
    client.fitAddon = { fit: vi.fn() };
    client.terminal = { cols: 80, rows: 24, reset: vi.fn(), write: vi.fn() };
    return client;
}

describe('WebSocket再接続改善（CommandMate移植）', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('window', {
            location: { protocol: 'http:', host: 'localhost:31013', hostname: 'localhost' }
        });
        vi.spyOn(httpClient, 'get').mockResolvedValue({ ok: true, access: { role: 'member' } });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    describe('指数バックオフ', () => {
        it('再接続遅延が指数的に増加する', () => {
            const client = createClient();

            // _getReconnectDelay should exist and return exponential delays
            expect(client._getReconnectDelay(0)).toBeGreaterThanOrEqual(1000);
            expect(client._getReconnectDelay(0)).toBeLessThanOrEqual(1500);

            const delay1 = client._getReconnectDelay(1);
            expect(delay1).toBeGreaterThanOrEqual(2000);
            expect(delay1).toBeLessThanOrEqual(3000);

            const delay2 = client._getReconnectDelay(2);
            expect(delay2).toBeGreaterThanOrEqual(4000);
            expect(delay2).toBeLessThanOrEqual(6000);
        });

        it('最大遅延を超えない', () => {
            const client = createClient();
            const delay = client._getReconnectDelay(20);
            expect(delay).toBeLessThanOrEqual(30000 * 1.5); // MAX_RECONNECT_DELAY + jitter
        });
    });

    describe('リトライ回数', () => {
        it('最大10回までリトライする', () => {
            const client = createClient();

            // _retryCount 9 (10th attempt) should still schedule reconnect
            client._retryCount = 9;
            expect(client._shouldRetry()).toBe(true);

            // _retryCount 10 should not retry
            client._retryCount = 10;
            expect(client._shouldRetry()).toBe(false);
        });

        it('接続成功時にリトライカウントがリセットされる', async () => {
            let mockWs = null;
            const MockWSConstructor = function () {
                mockWs = createMockWs();
                return mockWs;
            };
            MockWSConstructor.OPEN = 1;
            MockWSConstructor.CONNECTING = 0;
            vi.stubGlobal('WebSocket', MockWSConstructor);

            const client = createClient();
            client._retryCount = 5;

            const connectPromise = client.connect('test-session');
            await flushMicrotasks();
            emitReady(mockWs);
            await connectPromise;

            expect(client._retryCount).toBe(0);
        });
    });

    describe('keepalive ping', () => {
        it('接続後にkeepalive pingが定期的に送信される', async () => {
            let mockWs = null;
            const MockWSConstructor = function () {
                mockWs = createMockWs();
                return mockWs;
            };
            MockWSConstructor.OPEN = 1;
            MockWSConstructor.CONNECTING = 0;
            vi.stubGlobal('WebSocket', MockWSConstructor);

            const client = createClient();
            const connectPromise = client.connect('test-session');
            await flushMicrotasks();
            emitReady(mockWs);
            await connectPromise;

            // Advance time by keepalive interval (30s)
            vi.advanceTimersByTime(30000);

            const pingMessages = mockWs.sentMessages.filter(m => m.type === 'ping');
            expect(pingMessages.length).toBeGreaterThanOrEqual(1);
        });

        it('disconnect時にkeepalive timerがクリアされる', async () => {
            let mockWs = null;
            const MockWSConstructor = function () {
                mockWs = createMockWs();
                return mockWs;
            };
            MockWSConstructor.OPEN = 1;
            MockWSConstructor.CONNECTING = 0;
            vi.stubGlobal('WebSocket', MockWSConstructor);

            const client = createClient();
            const connectPromise = client.connect('test-session');
            await flushMicrotasks();
            emitReady(mockWs);
            await connectPromise;
            client.disconnect();

            expect(client._keepaliveTimer).toBeNull();
        });
    });

    describe('expected close codes', () => {
        it('正常クローズ（1000）ではリトライしない', () => {
            const client = createClient();
            expect(client._isExpectedClose(1000)).toBe(true);
        });

        it('ブラウザナビゲーション（1001）ではリトライしない', () => {
            const client = createClient();
            expect(client._isExpectedClose(1001)).toBe(true);
        });

        it('異常クローズ（1006）ではリトライする', () => {
            const client = createClient();
            expect(client._isExpectedClose(1006)).toBe(false);
        });
    });

    describe('接続品質トラッキング', () => {
        it('onStatusChangeにreconnectAttemptsが含まれる', () => {
            const statusUpdates = [];
            const client = createClient({
                onStatusChange: (status) => statusUpdates.push(status)
            });

            client._retryCount = 3;
            client._emitStatus();

            const lastUpdate = statusUpdates[statusUpdates.length - 1];
            expect(lastUpdate.reconnectAttempts).toBe(3);
        });
    });
});
