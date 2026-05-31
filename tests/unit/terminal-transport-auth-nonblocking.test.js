import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalTransportClient } from '../../public/modules/core/terminal-transport-client.js';
import { httpClient } from '../../public/modules/core/http-client.js';
import { inputTelemetry } from '../../public/modules/core/input-telemetry.js';

// Perf: connect() awaited `_ensureAuthenticated()` (a GET /api/auth/verify whose result is
// discarded) BEFORE creating the WebSocket. Measured ~847ms median on every session switch.
// The verify is a pure read with no cookie side-effect and the WS upgrade does its own auth,
// so the pre-verify must NOT block the connect critical path. This test pins that a slow/
// hanging auth verify does not delay the WS connect/ready.

class ReadyWebSocket {
  static OPEN = 1; static CONNECTING = 0;
  constructor(url) { this.url = url; this.readyState = ReadyWebSocket.OPEN; this.listeners = new Map();
    queueMicrotask(() => this._emit('message', { data: JSON.stringify({ type: 'ready', sessionId: 'session-1', cols: 80, rows: 24, inputReady: true, terminalAccess: { state: 'owner' } }) }));
  }
  addEventListener(t, l) { const a = this.listeners.get(t) || []; a.push(l); this.listeners.set(t, a); }
  send() {} close() {}
  _emit(t, e) { for (const l of this.listeners.get(t) || []) l(e); }
}

describe('terminal-transport-client connect() does not block on auth verify', () => {
  beforeEach(() => {
    inputTelemetry.reset();
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:31013', hostname: 'localhost' } });
    vi.stubGlobal('WebSocket', ReadyWebSocket);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('auth verify が解決しなくても connect は WS ready で resolve する（critical pathをブロックしない）', async () => {
    // /api/auth/verify never resolves -> if connect awaits it, connect hangs forever.
    vi.spyOn(httpClient, 'get').mockImplementation((url) => {
      if (String(url).includes('/api/auth/verify')) return new Promise(() => {}); // hang
      return Promise.resolve({ ok: true, access: { role: 'member' } });
    });
    vi.spyOn(httpClient, 'post').mockResolvedValue({ inputReady: true });

    const client = new TerminalTransportClient({ viewerId: 'auth-nb', viewerLabel: 'AuthNB' });
    client.fitAddon = { fit: vi.fn() };
    client.terminal = { cols: 80, rows: 24 };

    const result = await Promise.race([
      client.connect('session-1', { skipInitialResize: true }).then(r => r, e => ({ error: String(e?.message ?? e) })),
      new Promise(r => setTimeout(() => r('BLOCKED'), 500))
    ]);

    // Pre-fix: connect awaits the hanging verify before creating the WS -> 'BLOCKED'.
    // Post-fix: verify is fire-and-forget, WS opens, ready arrives -> resolves mode:live.
    expect(result).not.toBe('BLOCKED');
    expect(result.mode).toBe('live');
  });
});
