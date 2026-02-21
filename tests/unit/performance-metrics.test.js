import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventBus, EVENTS } from '../../public/modules/core/event-bus.js';
import { initPerformanceMetrics } from '../../public/modules/performance-metrics.js';

describe('performance-metrics', () => {
    let perf;

    beforeEach(() => {
        perf = initPerformanceMetrics({ attachToWindow: true, logSlowSamples: false });
        perf.reset();
    });

    afterEach(() => {
        perf?.destroy?.();
        perf = null;
    });

    it('collects PERF ready events and computes summary', async () => {
        await eventBus.emit(EVENTS.PERF_SESSION_SWITCH_READY, { durationMs: 400, traceId: 't1' });
        await eventBus.emit(EVENTS.PERF_SESSION_SWITCH_READY, { durationMs: 1000, traceId: 't2' });
        await eventBus.emit(EVENTS.PERF_SESSION_SWITCH_READY, { durationMs: 700, traceId: 't3' });

        const summary = perf.getSummary();
        expect(summary.sessionSwitch.count).toBe(3);
        expect(summary.sessionSwitch.p50).toBe(700);
        expect(summary.sessionSwitch.p95).toBe(1000);
        expect(summary.sessionSwitch.max).toBe(1000);
    });

    it('exposes API on window when attachToWindow=true', () => {
        expect(window.brainbasePerf).toBeTruthy();
        expect(typeof window.brainbasePerf.getSummary).toBe('function');
    });

    it('resets stored samples', async () => {
        await eventBus.emit(EVENTS.PERF_SESSION_RESTORE_READY, { durationMs: 1200, traceId: 'x1' });

        let summary = perf.getSummary();
        expect(summary.sessionRestore.count).toBe(1);

        perf.reset();
        summary = perf.getSummary();
        expect(summary.sessionRestore.count).toBe(0);
    });
});
