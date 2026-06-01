import { describe, expect, it, vi, afterEach } from 'vitest';
import { TerminalTransportService } from '../../../server/services/terminal-transport-service.js';

// A long paste makes the interactive TUI emit a huge redraw flood. Forwarding all of it grew the
// WS in-flight buffer unbounded and blocked the event loop (~80s CPU peg, WS keepalive missed ->
// disconnect, ~250MB RSS churn, server restart). The streaming transport now applies backpressure:
// once ws.bufferedAmount crosses a high-water mark the client is too far behind, so we DISCARD the
// backed-up intermediate stream and resync to the current screen via a fresh snapshot once drained.

function buildService() {
    const captureCache = {
        getSnapshot: vi.fn(async () => ({
            text: 'CURRENT-SCREEN', colorText: null, copyMode: false, cursor: null,
            capturedAt: '2026-03-23T00:00:00.000Z'
        })),
        invalidate: vi.fn()
    };
    const controlClient = { on: vi.fn(), off: vi.fn(), resize: vi.fn() };
    const controlRegistry = { acquire: vi.fn(() => controlClient), release: vi.fn() };
    const sessionManager = {
        touchTerminalOwnership: vi.fn(),
        getSession: vi.fn(() => ({ runtimeState: 'interactive_ready', observed: { inputProbe: { status: 'passed' } } })),
        setCliState: vi.fn()
    };
    const service = new TerminalTransportService({ sessionManager, captureCache, controlRegistry });
    return { service, captureCache, controlClient, controlRegistry };
}

const makeConnection = (ws) => ({ sessionId: 'session-1', ws, viewerId: 'v1', viewerLabel: 'L', closed: false, transport: null });
const outputHandlerOf = (controlClient) => controlClient.on.mock.calls.find((c) => c[0] === 'output')[1];
const sentOf = (ws, type) => ws.send.mock.calls.map((c) => JSON.parse(c[0])).filter((m) => m.type === type);

describe('TerminalTransportService streaming backpressure', () => {
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    it('通常時は output をそのまま forward する（FFFD含む文字列も全スキャンせず素通し）', async () => {
        vi.useFakeTimers();
        const { service, controlClient } = buildService();
        const ws = { readyState: 1, bufferedAmount: 0, send: vi.fn() };
        await service._startStreaming(makeConnection(ws));
        outputHandlerOf(controlClient)('hello� world');
        await vi.advanceTimersByTimeAsync(15);
        const out = sentOf(ws, 'output');
        expect(out).toHaveLength(1);
        expect(out[0].data).toBe('hello� world');
    });

    it('client が遅れて ws.bufferedAmount が高水位を超えたら flood を捨てて snapshot で resync する', async () => {
        vi.useFakeTimers();
        const { service, controlClient, captureCache } = buildService();
        const ws = { readyState: 1, bufferedAmount: 0, send: vi.fn() };
        await service._startStreaming(makeConnection(ws));
        const onOutput = outputHandlerOf(controlClient);

        // backlog: the send leaves a large in-flight buffer -> enter "behind" mode
        ws.bufferedAmount = 8 * 1024 * 1024;
        onOutput('first redraw chunk');
        await vi.advanceTimersByTimeAsync(15);
        const sentCountAfterEnter = ws.send.mock.calls.length;

        // flood while behind -> dropped (not forwarded), in-flight buffer not grown further
        onOutput('FLOOD-A'.repeat(1000));
        onOutput('FLOOD-B'.repeat(1000));
        await vi.advanceTimersByTimeAsync(30);
        const floodOut = ws.send.mock.calls.slice(sentCountAfterEnter).map((c) => JSON.parse(c[0])).filter((m) => m.type === 'output');
        expect(floodOut).toHaveLength(0);

        // socket drains + flood pauses -> a fresh snapshot resyncs the client to the current screen
        ws.bufferedAmount = 0;
        await vi.advanceTimersByTimeAsync(400);
        const snaps = sentOf(ws, 'snapshot');
        expect(snaps.length).toBeGreaterThanOrEqual(1);
        expect(snaps[snaps.length - 1].text).toBe('CURRENT-SCREEN');
        expect(captureCache.invalidate).toHaveBeenCalledWith('session-1');
    });

    it('一度の output で巨大バッチを作らない（OUTPUT_BATCH_MAX_CHARS で即フラッシュ）', async () => {
        vi.useFakeTimers();
        const { service, controlClient } = buildService();
        const ws = { readyState: 1, bufferedAmount: 0, send: vi.fn() };
        await service._startStreaming(makeConnection(ws));
        // a single 2M-char chunk must be flushed immediately, not buffered unbounded
        outputHandlerOf(controlClient)('z'.repeat(2 * 1024 * 1024));
        // no timer advance needed: the cap triggers a synchronous flush
        expect(sentOf(ws, 'output').length).toBeGreaterThanOrEqual(1);
    });
});
