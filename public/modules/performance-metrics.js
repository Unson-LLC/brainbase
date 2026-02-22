import { eventBus, EVENTS } from './core/event-bus.js';

const STORAGE_KEY = 'bb_perf_samples_v1';
const MAX_SAMPLES = 200;

const METRIC_EVENT_MAP = {
    [EVENTS.PERF_SESSION_SWITCH_READY]: 'sessionSwitch',
    [EVENTS.PERF_SESSION_RESTORE_READY]: 'sessionRestore',
    [EVENTS.PERF_MOBILE_LOAD_READY]: 'mobileLoad'
};

const METRIC_KEYS = Object.values(METRIC_EVENT_MAP);

let singletonApi = null;

function createEmptySamples() {
    return {
        sessionSwitch: [],
        sessionRestore: [],
        mobileLoad: []
    };
}

function getStorage() {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
}

function loadStoredSamples() {
    const storage = getStorage();
    if (!storage) return createEmptySamples();

    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return createEmptySamples();
        const parsed = JSON.parse(raw);
        return {
            sessionSwitch: Array.isArray(parsed.sessionSwitch) ? parsed.sessionSwitch : [],
            sessionRestore: Array.isArray(parsed.sessionRestore) ? parsed.sessionRestore : [],
            mobileLoad: Array.isArray(parsed.mobileLoad) ? parsed.mobileLoad : []
        };
    } catch {
        return createEmptySamples();
    }
}

function persistSamples(samples) {
    const storage = getStorage();
    if (!storage) return;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(samples));
    } catch {
        // ignore quota/storage errors
    }
}

function percentile(values, p) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

function summarizeMetric(metricSamples = []) {
    if (!Array.isArray(metricSamples) || metricSamples.length === 0) {
        return {
            count: 0,
            p50: null,
            p95: null,
            min: null,
            max: null,
            lastDurationMs: null,
            lastAt: null
        };
    }

    const durations = metricSamples.map((sample) => sample.durationMs).filter((n) => Number.isFinite(n));
    const last = metricSamples[metricSamples.length - 1];

    return {
        count: metricSamples.length,
        p50: percentile(durations, 50),
        p95: percentile(durations, 95),
        min: durations.length > 0 ? Math.min(...durations) : null,
        max: durations.length > 0 ? Math.max(...durations) : null,
        lastDurationMs: Number.isFinite(last?.durationMs) ? last.durationMs : null,
        lastAt: last?.timestamp || null
    };
}

function addSample(samples, key, sample) {
    const list = samples[key];
    if (!Array.isArray(list)) return;

    list.push(sample);
    if (list.length > MAX_SAMPLES) {
        list.splice(0, list.length - MAX_SAMPLES);
    }
}

/**
 * PERFイベントを収集してP50/P95を計算可能にする
 * @param {Object} options
 * @param {boolean} [options.attachToWindow=true]
 * @param {boolean} [options.logSlowSamples=true]
 * @returns {{
 *  getSamples: () => Object,
 *  getSummary: () => Object,
 *  reset: () => void,
 *  export: () => string,
 *  destroy: () => void
 * }}
 */
export function initPerformanceMetrics(options = {}) {
    if (singletonApi) return singletonApi;

    const { attachToWindow = true, logSlowSamples = true } = options;
    const samples = loadStoredSamples();
    const unsubscribers = [];

    const onPerfReady = (metricKey) => async (event) => {
        const detail = event?.detail || {};
        const durationMs = Number(detail.durationMs);
        if (!Number.isFinite(durationMs) || durationMs < 0) return;

        const sample = {
            traceId: detail.traceId || null,
            durationMs,
            phase: detail.phase || null,
            sessionId: detail.sessionId || null,
            timestamp: new Date().toISOString()
        };

        addSample(samples, metricKey, sample);
        persistSamples(samples);

        if (logSlowSamples && durationMs >= 2000) {
            console.warn(`[PerfMetrics] Slow sample ${metricKey}: ${durationMs}ms`, sample);
        }
    };

    for (const [eventName, metricKey] of Object.entries(METRIC_EVENT_MAP)) {
        unsubscribers.push(eventBus.onAsync(eventName, onPerfReady(metricKey)));
    }

    const api = {
        getSamples() {
            return {
                sessionSwitch: [...samples.sessionSwitch],
                sessionRestore: [...samples.sessionRestore],
                mobileLoad: [...samples.mobileLoad]
            };
        },
        getSummary() {
            return {
                generatedAt: new Date().toISOString(),
                sessionSwitch: summarizeMetric(samples.sessionSwitch),
                sessionRestore: summarizeMetric(samples.sessionRestore),
                mobileLoad: summarizeMetric(samples.mobileLoad)
            };
        },
        reset() {
            for (const key of METRIC_KEYS) {
                samples[key] = [];
            }
            persistSamples(samples);
        },
        export() {
            return JSON.stringify({
                generatedAt: new Date().toISOString(),
                summary: api.getSummary(),
                samples: api.getSamples()
            }, null, 2);
        },
        destroy() {
            while (unsubscribers.length > 0) {
                const unsub = unsubscribers.pop();
                if (typeof unsub === 'function') {
                    unsub();
                }
            }
            if (typeof window !== 'undefined' && window.brainbasePerf === api) {
                delete window.brainbasePerf;
            }
            singletonApi = null;
        }
    };

    if (attachToWindow && typeof window !== 'undefined') {
        window.brainbasePerf = api;
    }

    singletonApi = api;
    return api;
}

