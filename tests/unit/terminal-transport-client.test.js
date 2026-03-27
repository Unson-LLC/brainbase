import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalTransportClient, shouldUseXtermTransport } from '../../public/modules/core/terminal-transport-client.js';
import { httpClient } from '../../public/modules/core/http-client.js';

describe('terminal-transport-client', () => {
  const flushMicrotasks = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    vi.spyOn(httpClient, 'get').mockResolvedValue({ ok: true, access: { role: 'member' } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('localhost desktop環境ではxterm transportを使う', () => {
    vi.stubGlobal('window', {
      innerWidth: 1280,
      location: { hostname: 'localhost' }
    });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });

    expect(shouldUseXtermTransport()).toBe(true);
  });

  it('mobile環境ではxterm transportを使わない', () => {
    vi.stubGlobal('window', {
      innerWidth: 390,
      location: { hostname: 'localhost' }
    });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });

    expect(shouldUseXtermTransport()).toBe(false);
  });

  it('Cloudflare hostnameでもxterm transportを使う', () => {
    vi.stubGlobal('window', {
      innerWidth: 1440,
      location: { hostname: 'brain-base.work' }
    });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });

    expect(shouldUseXtermTransport()).toBe(true);
  });

  it('jsdom環境ではxterm transportを使わない', () => {
    vi.stubGlobal('window', {
      innerWidth: 1280,
      location: { hostname: 'localhost' }
    });
    vi.stubGlobal('navigator', { userAgent: 'jsdom/24.0.0' });

    expect(shouldUseXtermTransport()).toBe(false);
  });

  it('同一sessionかつWebSocket openなら入力可能と判定する', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.sessionId = 'session-1';
    client.status.mode = 'live';
    client.ws = { readyState: 1 };

    expect(client.canSendInput('session-1')).toBe(true);
    expect(client.canSendInput('session-2')).toBe(false);
  });

  it('blocked sessionを判定できる', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.sessionId = 'session-1';
    client.status.mode = 'blocked';
    client.status.blockedAccess = { state: 'blocked' };

    expect(client.isBlockedForSession('session-1')).toBe(true);
    expect(client.isBlockedForSession('session-2')).toBe(false);
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
          this._emit('message', {
            data: JSON.stringify({ type: 'status', mode: 'live', transport: 'streaming', copyMode: false })
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

  it('認証切れ状態でconnect時_AUTH_REQUIREDを投げる', async () => {
    vi.spyOn(httpClient, 'get').mockRejectedValue(new Error('HTTP Error: 401 Unauthorized'));

    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Cloudflare / Mac'
    });

    await expect(client.connect('session-1')).rejects.toMatchObject({
      code: 'AUTH_REQUIRED'
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

  it('snapshot適用時_ユーザーが上にスクロール中ならviewport位置を維持する', async () => {
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
      write: vi.fn((text, callback) => {
        terminal.buffer.active.baseY = 160;
        callback?.();
      }),
      scrollToLine
    };

    client.terminal = terminal;
    client.fitAddon = { fit: vi.fn() };

    client._applySnapshot('updated output');
    await Promise.resolve();

    expect(terminal.write).toHaveBeenCalledWith(
      '\x1b[2J\x1b[3J\x1b[Hupdated output',
      expect.any(Function)
    );
    expect(scrollToLine).toHaveBeenCalledWith(120);
    expect(client.fitAddon.fit).not.toHaveBeenCalled();
  });

  it('snapshot適用時_最下部を見ているなら最下部を維持する', async () => {
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
      write: vi.fn((text, callback) => {
        callback?.();
      }),
      scrollToBottom,
      scrollToLine: vi.fn()
    };

    client.terminal = terminal;
    client.fitAddon = { fit: vi.fn() };

    client._applySnapshot('latest output');
    await Promise.resolve();

    expect(scrollToBottom).toHaveBeenCalled();
    expect(terminal.scrollToLine).not.toHaveBeenCalled();
  });

  it('scroll中に新しいsnapshotが来たら適用を保留する', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      buffer: {
        active: {
          baseY: 120,
          viewportY: 80
        }
      },
      write: vi.fn()
    };

    client.terminal = terminal;
    client._queueOrApplySnapshot('new output');

    expect(terminal.write).not.toHaveBeenCalled();
    expect(client._pendingSnapshotText).toBe('new output');
  });

  it('scroll中に保留したsnapshotは最下部に戻った時だけ反映する', async () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const scrollToBottom = vi.fn();
    const terminal = {
      buffer: {
        active: {
          baseY: 120,
          viewportY: 80
        }
      },
      write: vi.fn((text, callback) => {
        terminal.buffer.active.viewportY = terminal.buffer.active.baseY;
        callback?.();
      }),
      scrollToBottom
    };

    client.terminal = terminal;
    client.fitAddon = { fit: vi.fn() };
    client._pendingSnapshotText = 'queued output';

    terminal.buffer.active.viewportY = terminal.buffer.active.baseY;
    client._handleTerminalScroll();
    await Promise.resolve();

    expect(terminal.write).toHaveBeenCalledWith(
      '\x1b[2J\x1b[3J\x1b[Hqueued output',
      expect.any(Function)
    );
    expect(scrollToBottom).toHaveBeenCalled();
    expect(client._pendingSnapshotText).toBeNull();
  });

  it('別sessionへ切り替えた直後の最初のsnapshotはscroll位置に関係なく即反映する', async () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      cols: 98,
      rows: 32,
      buffer: {
        active: {
          baseY: 120,
          viewportY: 80
        }
      },
      write: vi.fn((text, callback) => {
        terminal.buffer.active.baseY = 0;
        terminal.buffer.active.viewportY = 0;
        callback?.();
      }),
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn()
    };

    const sockets = [];

    class MockWebSocket {
      static OPEN = 1;
      static CONNECTING = 0;

      constructor(url) {
        this.url = url;
        this.readyState = MockWebSocket.OPEN;
        this.listeners = new Map();
        sockets.push(this);
      }

      addEventListener(type, listener) {
        const current = this.listeners.get(type) || [];
        current.push(listener);
        this.listeners.set(type, current);
      }

      send() {}

      close() {
        this.readyState = 3;
      }

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

    client.fitAddon = { fit: vi.fn() };
    client.terminal = terminal;
    client.sessionId = 'session-1';

    const connectPromise = client.connect('session-2');
    await flushMicrotasks();
    const socket = sockets[0];
    socket._emit('message', {
      data: JSON.stringify({ type: 'ready', sessionId: 'session-2', cols: 98, rows: 32 })
    });
    socket._emit('message', {
      data: JSON.stringify({ type: 'snapshot', text: 'session-2 output', capturedAt: new Date().toISOString() })
    });
    socket._emit('message', {
      data: JSON.stringify({ type: 'status', mode: 'live', transport: 'streaming', copyMode: false })
    });
    await connectPromise;

    expect(terminal.write).toHaveBeenCalledWith(
      '\x1b[2J\x1b[3J\x1b[Hsession-2 output',
      expect.any(Function)
    );
    expect(client._pendingSnapshotText).toBeNull();
    expect(client._forceApplyNextSnapshot).toBe(false);
  });

  it('outputメッセージはxtermへそのまま追記する', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      write: vi.fn()
    };

    client.terminal = terminal;
    client._applyOutput('\u001b[32mhello\u001b[0m');

    expect(terminal.write).toHaveBeenCalledWith('\u001b[32mhello\u001b[0m', expect.any(Function));
  });

  it('live入力時は印字可能な文字をローカルエコーする', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    client.status.mode = 'live';
    client.terminal = {
      write: vi.fn()
    };

    client._applyLocalEcho('abc');

    expect(client.terminal.write).toHaveBeenCalledWith('abc', expect.any(Function));
    expect(client._pendingEchoText).toBe('abc');
  });

  it('サーバー出力がローカルエコーと一致する場合は二重描画しない', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      write: vi.fn()
    };

    client.terminal = terminal;
    client._pendingEchoText = 'abc';
    client._applyOutput('abc');

    expect(terminal.write).not.toHaveBeenCalled();
    expect(client._pendingEchoText).toBe('');
  });

  it('サーバー出力がローカルエコーに続く追加出力を含む場合は差分だけ描画する', () => {
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac'
    });
    const terminal = {
      write: vi.fn()
    };

    client.terminal = terminal;
    client._pendingEchoText = 'abc\r\n';
    client._applyOutput('abc\r\n$ ');

    expect(terminal.write).toHaveBeenCalledWith('$ ', expect.any(Function));
    expect(client._pendingEchoText).toBe('');
  });

  it('output適用時_上にスクロール中ならviewport位置を維持する', async () => {
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
      write: vi.fn((text, callback) => {
        terminal.buffer.active.baseY = 160;
        callback?.();
      }),
      scrollToLine
    };

    client.terminal = terminal;
    client._applyOutput('hello');
    await Promise.resolve();

    expect(terminal.write).toHaveBeenCalledWith('hello', expect.any(Function));
    expect(scrollToLine).toHaveBeenCalledWith(120);
  });

  it('output適用時_最下部にいるなら最下部を維持する', async () => {
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
      write: vi.fn((text, callback) => {
        callback?.();
      }),
      scrollToBottom,
      scrollToLine: vi.fn()
    };

    client.terminal = terminal;
    client._applyOutput('hello');
    await Promise.resolve();

    expect(terminal.write).toHaveBeenCalledWith('hello', expect.any(Function));
    expect(scrollToBottom).toHaveBeenCalled();
    expect(terminal.scrollToLine).not.toHaveBeenCalled();
  });

  it('古いWebSocketのcloseイベントでは現在のlive状態を上書きしない', async () => {
    const sockets = [];

    class MockWebSocket {
      static OPEN = 1;
      static CONNECTING = 0;

      constructor(url) {
        this.url = url;
        this.readyState = MockWebSocket.OPEN;
        this.listeners = new Map();
        sockets.push(this);
      }

      addEventListener(type, listener) {
        const current = this.listeners.get(type) || [];
        current.push(listener);
        this.listeners.set(type, current);
      }

      send() {}

      close() {
        this.readyState = 3;
        this._emit('close', { code: 1006 });
      }

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

    const firstConnect = client.connect('session-1');
    await flushMicrotasks();
    const firstSocket = sockets[0];
    firstSocket._emit('message', {
      data: JSON.stringify({ type: 'ready', sessionId: 'session-1', cols: 98, rows: 32 })
    });
    firstSocket._emit('message', {
      data: JSON.stringify({ type: 'status', mode: 'live', transport: 'streaming', copyMode: false })
    });
    await firstConnect;

    const secondConnect = client.connect('session-1');
    await flushMicrotasks();
    const secondSocket = sockets[1];

    secondSocket._emit('message', {
      data: JSON.stringify({ type: 'ready', sessionId: 'session-1', cols: 98, rows: 32 })
    });
    secondSocket._emit('message', {
      data: JSON.stringify({ type: 'status', mode: 'live', transport: 'streaming', copyMode: false })
    });
    await secondConnect;

    expect(client.status.mode).toBe('live');

    firstSocket._emit('close', { code: 1006 });

    expect(client.status.mode).toBe('live');

    secondSocket._emit('close', { code: 1000 });
  });
});
