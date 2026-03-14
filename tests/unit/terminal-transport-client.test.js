import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalTransportClient, shouldUseDesktopXtermTransport } from '../../public/modules/core/terminal-transport-client.js';

describe('terminal-transport-client', () => {
  afterEach(() => {
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
});
