import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalTransportClient, shouldUseDesktopXtermTransport } from '../../public/modules/core/terminal-transport-client.js';

describe('terminal-transport-client', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('localhost desktop環境ではxterm transportを使う', () => {
    vi.stubGlobal('window', {
      innerWidth: 1280,
      location: { hostname: 'localhost' }
    });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });

    expect(shouldUseDesktopXtermTransport()).toBe(true);
  });

  it('mobile環境ではttyd fallbackを使う', () => {
    vi.stubGlobal('window', {
      innerWidth: 390,
      location: { hostname: 'localhost' }
    });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });

    expect(shouldUseDesktopXtermTransport()).toBe(false);
  });

  it('Cloudflare hostnameではttyd fallbackを使う', () => {
    vi.stubGlobal('window', {
      innerWidth: 1440,
      location: { hostname: 'brain-base.work' }
    });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });

    expect(shouldUseDesktopXtermTransport()).toBe(false);
  });

  it('connect時に初期viewportサイズをws queryへ含めてready後もresizeを送る', async () => {
    const sentMessages = [];
    let openedUrl = null;

    class MockWebSocket {
      static OPEN = 1;
      static CONNECTING = 0;

      constructor(url) {
        openedUrl = url;
        this.url = url;
        this.readyState = MockWebSocket.OPEN;
        this.listeners = new Map();
        queueMicrotask(() => {
          this._emit('message', {
            data: JSON.stringify({ type: 'ready', sessionId: 'session-1', cols: 98, rows: 32 })
          });
        });
      }

      addEventListener(type, listener) {
        const current = this.listeners.get(type) || [];
        current.push(listener);
        this.listeners.set(type, current);
      }

      send(message) {
        sentMessages.push(JSON.parse(message));
      }

      close() {}

      _emit(type, event) {
        for (const listener of this.listeners.get(type) || []) {
          listener(event);
        }
      }
    }

    vi.stubGlobal('window', {
      location: { protocol: 'http:', host: 'localhost:31013', hostname: 'localhost' }
    });
    vi.stubGlobal('WebSocket', MockWebSocket);

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.fitAddon = { fit: vi.fn() };
    client.terminal = { cols: 98, rows: 32 };

    await client.connect('session-1');

    const url = new URL(openedUrl);
    expect(url.searchParams.get('cols')).toBe('98');
    expect(url.searchParams.get('rows')).toBe('32');
    expect(client.fitAddon.fit).toHaveBeenCalled();
    expect(sentMessages).toContainEqual({
      type: 'resize',
      cols: 98,
      rows: 32
    });
  });

  it('live + alternate buffer の wheel で tmux scroll message を送る', async () => {
    vi.useFakeTimers();

    const sentMessages = [];
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.hostEl = {
      contains: () => true
    };
    client.status.mode = 'live';
    const alternateBuffer = {};
    client.terminal = {
      buffer: {
        active: alternateBuffer,
        alternate: alternateBuffer
      }
    };
    client.ws = {
      readyState: 1,
      send(message) {
        sentMessages.push(JSON.parse(message));
      }
    };

    expect(client._shouldInterceptTmuxScroll({})).toBe(true);
    client._queueWheelDelta(96);
    vi.advanceTimersByTime(16);
    await vi.runAllTimersAsync();

    expect(sentMessages).toContainEqual({
      type: 'scroll',
      direction: 'down',
      steps: 2
    });
  });

  it('normal buffer の wheel は tmux scroll を送らない', () => {
    vi.useFakeTimers();

    const sentMessages = [];
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.hostEl = {
      contains: () => true
    };
    client.status.mode = 'live';
    client.terminal = {
      buffer: {
        active: {},
        alternate: {}
      }
    };
    client.ws = {
      readyState: 1,
      send(message) {
        sentMessages.push(JSON.parse(message));
      }
    };

    expect(client._shouldInterceptTmuxScroll({})).toBe(false);
    vi.advanceTimersByTime(16);
    expect(sentMessages).toHaveLength(0);
  });

  it('copy-mode 中の sendText は先に exit_copy_mode を送る', async () => {
    const sentMessages = [];
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.status.copyMode = true;
    client.ws = {
      readyState: 1,
      send(message) {
        sentMessages.push(JSON.parse(message));
      }
    };

    await client.sendText('ls');

    expect(sentMessages).toEqual([
      { type: 'exit_copy_mode' },
      { type: 'input', inputType: 'text', value: 'ls' }
    ]);
    expect(client.status.copyMode).toBe(false);
  });
});
