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

  it('Shift+Enter押下時_M-Enterとして送信する', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.sendKey = vi.fn();

    const preventDefault = vi.fn();
    const handled = client._handleCustomKeyEvent({
      type: 'keydown',
      key: 'Enter',
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault
    });

    expect(handled).toBe(false);
    expect(preventDefault).toHaveBeenCalled();
    expect(client.sendKey).toHaveBeenCalledWith('M-Enter');
  });

  it('通常Enter押下時_カスタム処理せずxterm標準に任せる', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.sendKey = vi.fn();

    const handled = client._handleCustomKeyEvent({
      type: 'keydown',
      key: 'Enter',
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false
    });

    expect(handled).toBe(true);
    expect(client.sendKey).not.toHaveBeenCalled();
  });

  it('snapshot適用時_ユーザーが上にスクロール中ならviewport位置を維持する', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const scrollToLine = vi.fn();
    const terminal = {
      buffer: {
        active: {
          baseY: 120,
          viewportY: 80
        }
      },
      reset: vi.fn(),
      write: vi.fn(() => {
        terminal.buffer.active.baseY = 160;
      }),
      scrollToLine
    };

    client.terminal = terminal;
    client.fitAddon = { fit: vi.fn() };

    client._applySnapshot('updated output');

    expect(terminal.reset).toHaveBeenCalled();
    expect(terminal.write).toHaveBeenCalledWith('updated output');
    expect(scrollToLine).toHaveBeenCalledWith(120);
  });

  it('snapshot適用時_最下部を見ているなら最下部を維持する', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const scrollToBottom = vi.fn();
    const terminal = {
      buffer: {
        active: {
          baseY: 64,
          viewportY: 64
        }
      },
      reset: vi.fn(),
      write: vi.fn(),
      scrollToBottom,
      scrollToLine: vi.fn()
    };

    client.terminal = terminal;
    client.fitAddon = { fit: vi.fn() };

    client._applySnapshot('latest output');

    expect(scrollToBottom).toHaveBeenCalled();
    expect(terminal.scrollToLine).not.toHaveBeenCalled();
  });
});
