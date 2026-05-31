import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalTransportClient } from '../../public/modules/core/terminal-transport-client.js';

// Perf: the serialized terminal write queue did ONE terminal.write (+ viewport capture/restore
// + render refresh) PER WS output message, waiting for each xterm write-callback before the
// next. A long paste echoes back as hundreds/thousands of small chunks, so the queue drained
// one-per-callback — measured 53x slower than the same bytes coalesced (2000 msgs: ~55s vs ~1s).
// The fix coalesces consecutive same-generation, non-reset queued writes into one batched
// terminal.write, preserving byte order and reset boundaries.

describe('terminal write queue coalescing', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:31013', hostname: 'localhost' } });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  const makeClient = (writes) => {
    const c = new TerminalTransportClient({ viewerId: 'coalesce', viewerLabel: 'Coalesce' });
    // mock xterm: record each write, fire the callback asynchronously (like real xterm)
    c.terminal = { write: (t, cb) => { writes.push(t); queueMicrotask(cb); }, reset: vi.fn() };
    // isolate the queue logic from viewport/render side-effects
    c._captureViewportState = () => null;
    c._restoreViewportAfterTerminalWrite = () => {};
    c._scheduleTerminalRenderRefresh = () => {};
    return c;
  };

  const drain = async (c) => {
    for (let i = 0; i < 10000; i++) {
      if (!c._terminalWriteActive && c._terminalWriteQueue.length === 0) return;
      await new Promise((r) => setTimeout(r, 0));
    }
    throw new Error('queue did not drain');
  };

  it('N個の出力メッセージは内容を保ったまま遥かに少ない write 回数へ coalesce される', async () => {
    const writes = [];
    const c = makeClient(writes);
    const N = 500;
    const expected = Array.from({ length: N }, (_, i) => `line ${i} content\r\n`);
    for (const ln of expected) c._writeToTerminal(ln); // arrive in a burst (like a paste echo)
    await drain(c);

    // content is byte-identical and in order
    expect(writes.join('')).toBe(expected.join(''));
    // and N=500 messages collapsed into a tiny number of actual terminal.write calls (pre-fix: 500)
    expect(writes.length).toBeLessThanOrEqual(3);
  });

  it('resetTerminal は境界として尊重され、reset 前後が混ざらない', async () => {
    const writes = [];
    const c = makeClient(writes);
    c._writeToTerminal('before-1\r\n');
    c._writeToTerminal('before-2\r\n');
    c._writeToTerminal('AFTER-RESET\r\n', null, { resetTerminal: true });
    c._writeToTerminal('after-2\r\n');
    await drain(c);

    // reset() was invoked exactly once and the full content is preserved in order
    expect(c.terminal.reset).toHaveBeenCalledTimes(1);
    expect(writes.join('')).toBe('before-1\r\nbefore-2\r\nAFTER-RESET\r\nafter-2\r\n');
  });

  it('afterWrite コールバックは coalesce されても全件呼ばれる', async () => {
    const writes = [];
    const c = makeClient(writes);
    const calls = [];
    c._writeToTerminal('a\r\n', null, { afterWrite: () => calls.push('a') });
    c._writeToTerminal('b\r\n', null, { afterWrite: () => calls.push('b') });
    c._writeToTerminal('c\r\n', null, { afterWrite: () => calls.push('c') });
    await drain(c);
    expect(calls.sort()).toEqual(['a', 'b', 'c']);
  });
});
