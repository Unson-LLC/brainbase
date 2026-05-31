import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalTransportClient } from '../../public/modules/core/terminal-transport-client.js';
import { httpClient } from '../../public/modules/core/http-client.js';
import { inputTelemetry } from '../../public/modules/core/input-telemetry.js';

// P0: a session switch must never hang forever.
//
// connect() carries a CONNECT_TIMEOUT_MS guard, but both the timeout callback and
// settle() are gated on `this._connectToken !== connectToken`. When a concurrent /
// reconnect connect() bumps _connectToken while a connect Promise is still pending,
// the old promise's timeout becomes a no-op and the promise NEVER settles. The awaiting
// switchSession -> _connectXtermTransport then hangs indefinitely (observed >5min),
// leaving a frozen snapshot that looks live. The fix: a superseded connect() must
// deterministically settle (reject 'superseded') so the existing snapshot_fallback path
// in _connectXtermTransport/switchSession can run. Every connect() also publishes a
// timing+outcome metric (_lastConnectMetric) so the previously-invisible connect phase
// is observable.

// A WebSocket that opens but never emits `ready` -> connect() stays pending until it is
// either timed out or superseded.
class NeverReadyWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  constructor(url) { this.url = url; this.readyState = NeverReadyWebSocket.OPEN; this.listeners = new Map(); }
  addEventListener(type, listener) {
    const cur = this.listeners.get(type) || []; cur.push(listener); this.listeners.set(type, cur);
  }
  send() {}
  close() { this.readyState = 3; }
  _emit(type, event) { for (const l of this.listeners.get(type) || []) l(event); }
}

describe('terminal-transport-client connect() always settles', () => {
  beforeEach(() => {
    inputTelemetry.reset();
    vi.spyOn(httpClient, 'get').mockResolvedValue({ ok: true, access: { role: 'member' } });
    vi.spyOn(httpClient, 'post').mockResolvedValue({ inputReady: true });
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:31013', hostname: 'localhost' } });
    vi.stubGlobal('WebSocket', NeverReadyWebSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const newClient = () => {
    const c = new TerminalTransportClient({ viewerId: 'viewer-test', viewerLabel: 'Local / Mac' });
    c.fitAddon = { fit: vi.fn() };
    c.terminal = { cols: 80, rows: 24 };
    return c;
  };

  it('連続connectで先行のpending connectがsupersedeされhangせずrejectする', async () => {
    const client = newClient();

    const p1 = client.connect('session-1', { skipInitialResize: true });
    p1.catch(() => {}); // avoid unhandled rejection noise
    // a reconnect / visibility-driven connect() bumps _connectToken while p1 is pending
    const p2 = client.connect('session-1', { skipInitialResize: true });
    p2.catch(() => {});

    // p1 must SETTLE (reject superseded), not hang. 400ms wall-clock guard catches the hang.
    const outcome = await Promise.race([
      p1.then(() => ({ resolved: true }), (e) => ({ rejected: String(e?.message ?? e) })),
      new Promise((r) => setTimeout(() => r('HUNG'), 400))
    ]);

    expect(outcome).not.toBe('HUNG');           // the orphaned promise must not hang
    expect(outcome.rejected).toMatch(/supersed/i);
    expect(client._lastConnectMetric?.outcome).toBe('superseded'); // observable phase metric
  });

  it('REGRESSION GUARD: supersedeされない単一connectはCONNECT_TIMEOUT_MSでtimeout rejectする', async () => {
    vi.useFakeTimers();
    const client = newClient();
    const p = client.connect('session-1', { skipInitialResize: true });
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);       // flush auth microtask + WS creation
    await vi.advanceTimersByTimeAsync(15000);   // CONNECT_TIMEOUT_MS
    await expect(p).rejects.toThrow(/timeout/i);
    expect(client._lastConnectMetric?.outcome).toBe('timeout');
  });

  it('readyを受けたconnectはliveでsettleしmetricにdurationが残る', async () => {
    // a WS that emits ready immediately -> resolve mode:live
    class ReadyWebSocket extends NeverReadyWebSocket {
      constructor(url) {
        super(url);
        queueMicrotask(() => {
          this._emit('message', { data: JSON.stringify({ type: 'ready', sessionId: 'session-1', cols: 80, rows: 24, inputReady: true, terminalAccess: { state: 'owner' } }) });
        });
      }
    }
    vi.stubGlobal('WebSocket', ReadyWebSocket);
    const client = newClient();
    const res = await client.connect('session-1', { skipInitialResize: true });
    expect(res.mode).toBe('live');
    expect(client._lastConnectMetric?.outcome).toBe('live');
    expect(typeof client._lastConnectMetric?.durationMs).toBe('number');
  });
});
