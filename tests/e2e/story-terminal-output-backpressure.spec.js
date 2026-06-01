import { test, expect } from '@playwright/test';
import { TerminalTransportService } from '../../server/services/terminal-transport-service.js';

// End-to-end of the server WS output pipeline (no browser page needed — the backpressure is a
// server-internal contract). Drives the real TerminalTransportService._startStreaming with a
// real control-client output handler and a ws whose bufferedAmount we control, exercising the
// real flood -> drop -> snapshot-resync path. Uses real timers (the internal timers are 8/60/80ms).

function buildService() {
    let snapshotCalls = 0; let invalidateCalls = [];
    const captureCache = {
        getSnapshot: async () => { snapshotCalls++; return { text: 'CURRENT-SCREEN', colorText: null, copyMode: false, cursor: null, capturedAt: '2026-03-23T00:00:00.000Z' }; },
        invalidate: (id) => { invalidateCalls.push(id); }
    };
    const onCalls = [];
    const controlClient = { on: (ev, h) => onCalls.push([ev, h]), off: () => {}, resize: () => {} };
    const controlRegistry = { acquire: () => controlClient, release: () => {} };
    const sessionManager = {
        touchTerminalOwnership: () => {},
        getSession: () => ({ runtimeState: 'interactive_ready', observed: { inputProbe: { status: 'passed' } } }),
        setCliState: () => {}
    };
    const service = new TerminalTransportService({ sessionManager, captureCache, controlRegistry });
    return { service, controlClient, onCalls, getSnapshotCalls: () => snapshotCalls, getInvalidates: () => invalidateCalls };
}
const conn = (ws) => ({ sessionId: 'session-1', ws, viewerId: 'v1', viewerLabel: 'L', closed: false, transport: null });
const outHandler = (onCalls) => onCalls.find((c) => c[0] === 'output')[1];
const sent = (ws, type) => ws.send.calls.map((m) => JSON.parse(m)).filter((m) => m.type === type);
const mkWs = () => { const c = []; return { readyState: 1, bufferedAmount: 0, send: Object.assign((m) => c.push(m), { calls: c }) }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test.describe('story-terminal-output-backpressure', () => {
    test('AC: normal load forwards output unchanged without per-flush scanning', async () => {
        // story-terminal-output-backpressure ac:1
        const { service, onCalls } = buildService();
        const ws = mkWs();
        await service._startStreaming(conn(ws));
        outHandler(onCalls)('hello� world');
        await wait(20);
        const out = sent(ws, 'output');
        // Under normal load the streaming transport forwards terminal output to the client unchanged, without scanning every flush for replacement characters.
        expect(out.length, 'Under normal load the streaming transport forwards terminal output to the client unchanged, without scanning every flush for replacement characters.').toBe(1);
        expect(out[0].data).toBe('hello� world');
    });

    test('AC: client too far behind drops the flood and resyncs via snapshot', async () => {
        // story-terminal-output-backpressure ac:2
        const { service, onCalls, getInvalidates } = buildService();
        const ws = mkWs();
        await service._startStreaming(conn(ws));
        const onOutput = outHandler(onCalls);
        ws.bufferedAmount = 8 * 1024 * 1024;      // send leaves a large backlog
        onOutput('first redraw chunk');
        await wait(20);
        const afterEnter = ws.send.calls.length;
        onOutput('FLOOD-A'.repeat(1000));
        onOutput('FLOOD-B'.repeat(1000));
        await wait(40);
        const floodOut = ws.send.calls.slice(afterEnter).map((m) => JSON.parse(m)).filter((m) => m.type === 'output');
        expect(floodOut.length).toBe(0);          // flood not forwarded
        ws.bufferedAmount = 0;                     // drain
        await wait(400);
        const snaps = sent(ws, 'snapshot');
        // When the WebSocket in-flight buffer exceeds the high water mark the client is too far behind, so the backed-up output flood is dropped and the client is resynced to the current screen with a fresh snapshot once the socket drains.
        expect(snaps.length, 'When the WebSocket in-flight buffer exceeds the high water mark the client is too far behind, so the backed-up output flood is dropped and the client is resynced to the current screen with a fresh snapshot once the socket drains.').toBeGreaterThanOrEqual(1);
        expect(snaps[snaps.length - 1].text).toBe('CURRENT-SCREEN');
        expect(getInvalidates()).toContain('session-1');
    });

    test('AC: an oversized single chunk is flushed immediately', async () => {
        // story-terminal-output-backpressure ac:3
        const { service, onCalls } = buildService();
        const ws = mkWs();
        await service._startStreaming(conn(ws));
        outHandler(onCalls)('z'.repeat(2 * 1024 * 1024)); // >= 1M-char cap -> immediate flush
        const out = sent(ws, 'output');
        // A single oversized output chunk is flushed immediately rather than buffered into one unbounded batch string.
        expect(out.length, 'A single oversized output chunk is flushed immediately rather than buffered into one unbounded batch string.').toBeGreaterThanOrEqual(1);
    });
});
