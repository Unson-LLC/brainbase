import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalTransportClient } from '../../public/modules/core/terminal-transport-client.js';

// Repro for the "scroll lock" bug: after switching sessions you can scroll up for a moment,
// but once live output keeps arriving the viewport is dragged back toward the latest line and
// gets stuck there (scroll feels frozen at the bottom).
//
// Root cause: _writeToTerminal captures the viewport at queue time and _restoreViewportState
// restored the not-pinned position as (nextBaseY - distanceFromBottom). distanceFromBottom is
// measured against the OLD baseY, but nextBaseY is the post-write, grown baseY — so every write
// that appends N lines moves the viewport DOWN by N (it tracks "distance from the tail" instead
// of the content). Under continuous output the user's content scrolls out from under them and
// they are pulled to the bottom and pinned. The fix preserves the absolute top line (viewportY),
// which is stable because appended lines never change the index of already-visible content.

describe('terminal viewport scroll lock', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:31013', hostname: 'localhost' } });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });
    // not-pinned writes schedule a rAF re-restore (mobile momentum-scroll guard); run it inline.
    vi.stubGlobal('requestAnimationFrame', (fn) => { fn(); return 0; });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  // Minimal model of xterm's scrollback buffer + native scroll behaviour:
  //   - write() appends lines (baseY grows by the number of newlines)
  //   - it tail-follows ONLY when the viewport was already at the bottom; if the user is
  //     scrolled up, the viewport stays put (content-stable) — appended lines do not move it.
  const makeTerminal = () => {
    const buffer = { active: { baseY: 0, viewportY: 0 } };
    return {
      buffer,
      write(text, cb) {
        const added = (String(text).match(/\n/g) || []).length;
        const wasAtBottom = buffer.active.viewportY >= buffer.active.baseY;
        buffer.active.baseY += added;
        if (wasAtBottom) buffer.active.viewportY = buffer.active.baseY;
        if (typeof cb === 'function') queueMicrotask(cb);
      },
      reset() { buffer.active.baseY = 0; buffer.active.viewportY = 0; },
      scrollToLine(line) {
        buffer.active.viewportY = Math.min(Math.max(0, Math.trunc(line)), buffer.active.baseY);
      },
      scrollToBottom() { buffer.active.viewportY = buffer.active.baseY; }
    };
  };

  const makeClient = () => {
    const c = new TerminalTransportClient({ viewerId: 'scroll', viewerLabel: 'Scroll' });
    c.terminal = makeTerminal();
    c._scheduleTerminalRenderRefresh = () => {}; // isolate from render scheduling
    return c;
  };

  const drain = async (c) => {
    for (let i = 0; i < 10000; i++) {
      if (!c._terminalWriteActive && c._terminalWriteQueue.length === 0) return;
      await new Promise((r) => setTimeout(r, 0));
    }
    throw new Error('queue did not drain');
  };

  it('_restoreViewportState keeps the absolute top line when the buffer grew (no downward drag)', () => {
    const c = makeClient();
    const buf = c.terminal.buffer.active;
    buf.baseY = 100; buf.viewportY = 50; // user reading line 50 of a 100-line buffer

    const captured = c._captureViewportState();
    expect(captured.wasPinnedToBottom).toBe(false);
    expect(captured.viewportY).toBe(50);

    buf.baseY = 140; // 40 lines of live output appended; line 50 has not moved
    c._restoreViewportState(captured);

    // FIXED: stays on line 50. Pre-fix (nextBaseY - distanceFromBottom): 140 - 50 = 90 (dragged down).
    expect(buf.viewportY).toBe(50);
  });

  it('a scrolled-up user stays on their content during continuous live output (not pulled to the tail)', async () => {
    const c = makeClient();
    const buf = c.terminal.buffer.active;

    // initial backlog; user ends pinned at the bottom
    c._writeToTerminal('x\n'.repeat(100));
    await drain(c);
    expect(buf.baseY).toBe(100);
    expect(buf.viewportY).toBe(100);

    // user scrolls up to read line 50
    c.terminal.scrollToLine(50);
    c._handleTerminalScroll();
    expect(c._isViewportPinnedToBottom).toBe(false);
    const userLine = buf.viewportY; // 50

    // continuous live output arrives over time (8 bursts), draining between bursts
    for (let i = 0; i < 8; i++) {
      c._writeToTerminal('y\n'.repeat(12));
      await drain(c);
    }

    expect(buf.baseY).toBe(100 + 8 * 12);      // 196 — tail grew
    expect(buf.viewportY).toBe(userLine);      // FIXED: 50. Pre-fix: drifts to 146 (toward tail).
    expect(c._isViewportPinnedToBottom).toBe(false); // not locked to the bottom
  });

  it('an at-bottom user keeps following the tail (pinned behaviour preserved)', async () => {
    const c = makeClient();
    const buf = c.terminal.buffer.active;

    c._writeToTerminal('x\n'.repeat(100));
    await drain(c);
    expect(buf.viewportY).toBe(buf.baseY);

    for (let i = 0; i < 5; i++) {
      c._writeToTerminal('y\n'.repeat(10));
      await drain(c);
    }

    expect(buf.baseY).toBe(150);
    expect(buf.viewportY).toBe(150);                 // followed the tail
    expect(c._isViewportPinnedToBottom).toBe(true);  // still pinned
  });
});
