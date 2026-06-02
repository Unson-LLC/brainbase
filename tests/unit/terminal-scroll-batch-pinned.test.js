import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalTransportClient } from '../../public/modules/core/terminal-transport-client.js';

// Root cause of "scroll works right after switching, then under heavy output the terminal locks to
// the latest line and can't scroll": a terminal write captures its viewport when QUEUED. Under heavy
// continuous output the user scrolls up while a coalesced batch — whose head was captured AT THE
// bottom (wasPinnedToBottom=true) — is still in flight. _restoreViewportAfterTerminalWrite restored
// that stale pinned state with an unconditional scrollToBottom(), yanking the user back every batch.
// Confirmed against the real client + real xterm in-browser (scrolled to 159/199 -> snapped to
// 199/199). The fix: if the live viewport is no longer at the bottom, the user scrolled away since
// the write was queued — keep their position instead of snapping down.

describe('terminal write viewport restore — pinned-head batch under heavy output', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:31013', hostname: 'localhost' } });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)' });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  const makeClient = ({ baseY, viewportY }) => {
    const c = new TerminalTransportClient({ viewerId: 'b', viewerLabel: 'B' });
    const buf = { active: { baseY, viewportY } };
    c.terminal = {
      buffer: buf,
      scrollToBottom: () => { buf.active.viewportY = buf.active.baseY; },
      scrollToLine: (n) => { buf.active.viewportY = Math.min(Math.max(0, n), buf.active.baseY); }
    };
    return { c, buf };
  };

  it('does NOT snap to bottom when the user has scrolled up since the write was queued', () => {
    const { c, buf } = makeClient({ baseY: 199, viewportY: 159 }); // user scrolled up (40 from bottom)
    // batch head was captured while AT the bottom
    c._restoreViewportAfterTerminalWrite({ wasPinnedToBottom: true, distanceFromBottom: 0, viewportY: 199 });
    expect(buf.active.viewportY).toBe(159);          // held — NOT yanked to 199
    expect(c._isViewportPinnedToBottom).toBe(false);
  });

  it('still follows the tail when the user is at the bottom (pinned capture, still pinned)', () => {
    const { c, buf } = makeClient({ baseY: 199, viewportY: 199 }); // at bottom
    c._restoreViewportAfterTerminalWrite({ wasPinnedToBottom: true, distanceFromBottom: 0, viewportY: 199 });
    expect(buf.active.viewportY).toBe(199);          // stays at bottom (tail-follow)
    expect(c._isViewportPinnedToBottom).toBe(true);
  });

  it('a not-pinned capture restores the absolute position (existing #924 behaviour)', () => {
    const { c, buf } = makeClient({ baseY: 240, viewportY: 240 });
    // user was at line 80 when queued; buffer grew to 240
    c._restoreViewportAfterTerminalWrite({ wasPinnedToBottom: false, distanceFromBottom: 160, viewportY: 80 });
    expect(buf.active.viewportY).toBe(80);
    expect(c._isViewportPinnedToBottom).toBe(false);
  });
});
