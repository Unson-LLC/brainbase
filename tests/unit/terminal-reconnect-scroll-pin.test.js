import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalTransportClient } from '../../public/modules/core/terminal-transport-client.js';

// Reconnect scroll-lock: connect() arms _resetTerminalOnNextSnapshot on EVERY (re)connect of the
// session the user is viewing — not just on a real session switch. The reset branch of
// _queueOrApplySnapshot force-pinned the viewport to the bottom on each such snapshot, so a user
// reading scrollback was yanked back to the latest line on every transient reconnect ("scroll works
// right after switching, then a while later it snaps to the bottom and locks"). The fix preserves
// the user's scroll across the reset repaint and only pins when they were already at the bottom.
// Confirmed against the real running app + real xterm: scrolled to 13/33 (not pinned) -> reconnect
// snapshot -> 0/0 pinned (yanked) before the fix.

describe('reconnect reset-snapshot viewport', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:31013', hostname: 'localhost' } });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)' });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  // Drive _queueOrApplySnapshot through its reset branch and capture the viewport state it hands to
  // _applySnapshot. baseY/viewportY model the live xterm buffer at snapshot time.
  const runResetSnapshot = ({ baseY, viewportY }) => {
    const c = new TerminalTransportClient({ viewerId: 'r', viewerLabel: 'R' });
    const applySpy = vi.fn();
    c._applySnapshot = applySpy;
    c.terminal = { buffer: { active: { baseY, viewportY } } };
    c._buildSnapshotForTerminal = (t) => t;
    c._shouldDeferSnapshotForPendingEcho = () => false;
    c._resetTerminalOnNextSnapshot = true;
    c._forceApplyNextSnapshot = false;
    c._queueOrApplySnapshot('reconnect snapshot', null, {});
    expect(applySpy).toHaveBeenCalledTimes(1);
    return applySpy.mock.calls[0][1];
  };

  it('preserves the user position when scrolled up (no force-pin to bottom)', () => {
    const opts = runResetSnapshot({ baseY: 120, viewportY: 80 }); // 40 lines up
    expect(opts.resetTerminal).toBe(true); // still repaints from a clean buffer
    expect(opts.forceViewportState.wasPinnedToBottom).toBe(false); // NOT pinned — was yanked before fix
    expect(opts.forceViewportState.viewportY).toBe(80); // restores to the user's line
  });

  it('still pins to the bottom when the user is already at the bottom (tail-follow resumes)', () => {
    const opts = runResetSnapshot({ baseY: 120, viewportY: 120 }); // at bottom
    expect(opts.resetTerminal).toBe(true);
    expect(opts.forceViewportState.wasPinnedToBottom).toBe(true);
  });

  it('a genuine session switch (_forceApplyNextSnapshot) still force-pins regardless of scroll', () => {
    const c = new TerminalTransportClient({ viewerId: 'r', viewerLabel: 'R' });
    const applySpy = vi.fn();
    c._applySnapshot = applySpy;
    c.terminal = { buffer: { active: { baseY: 120, viewportY: 80 } } }; // scrolled up
    c._buildSnapshotForTerminal = (t) => t;
    c._shouldDeferSnapshotForPendingEcho = () => false;
    c._forceApplyNextSnapshot = true; // session switch
    c._resetTerminalOnNextSnapshot = true;
    c._queueOrApplySnapshot('switch snapshot', null, {});
    const opts = applySpy.mock.calls[0][1];
    expect(opts.forceViewportState.wasPinnedToBottom).toBe(true); // switch shows the newest line
  });
});
