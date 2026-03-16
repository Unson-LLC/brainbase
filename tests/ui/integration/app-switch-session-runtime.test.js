import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';
import { appStore } from '../../../public/modules/core/store.js';
import { httpClient } from '../../../public/modules/core/http-client.js';
import { eventBus } from '../../../public/modules/core/event-bus.js';

vi.mock('../../../public/modules/session-indicators.js', async () => {
  const actual = await vi.importActual('../../../public/modules/session-indicators.js');
  return {
    ...actual,
    updateSessionIndicators: vi.fn(),
    pollSessionStatus: vi.fn(),
    startPolling: vi.fn(),
    markDoneAsRead: vi.fn(async () => {})
  };
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const htmlPath = path.join(repoRoot, 'public/index.html');

describe('app switchSession runtime handling', () => {
  let app;

  beforeEach(async () => {
    window.__BRAINBASE_TEST__ = true;

    const html = readFileSync(htmlPath, 'utf-8');
    const dom = new JSDOM(html, { url: 'http://localhost:31013/' });
    document.body.innerHTML = dom.window.document.body.innerHTML;
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn()
      },
      configurable: true
    });
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: vi.fn(() => 'viewer-test'),
        setItem: vi.fn(),
        removeItem: vi.fn()
      },
      configurable: true
    });

    const { createApp } = await import('../../../public/app.js');
    app = createApp();
    app.focusTerminal = vi.fn();

    vi.spyOn(httpClient, 'get').mockResolvedValue({ runtimeStatus: null, terminalAccess: null });
    vi.spyOn(httpClient, 'post').mockResolvedValue({ proxyPath: '/console/session-1' });
  });

  afterEach(() => {
    app?.destroy?.();
    vi.restoreAllMocks();
  });

  it('uses runtimeStatus proxyPath without starting ttyd again', async () => {
    app.reconnectManager = { setCurrentSession: vi.fn() };

    appStore.setState({
      currentSessionId: null,
      sessions: [{
        id: 'session-1',
        name: 'Session 1',
        path: '/tmp/session-1',
        engine: 'codex',
        intendedState: 'active',
        runtimeStatus: {
          ttydRunning: true,
          proxyPath: '/console/session-1?viewerId=viewer-test'
        }
      }]
    });

    const terminalFrame = document.getElementById('terminal-frame');

    await app.switchSession('session-1');

    expect(httpClient.post).not.toHaveBeenCalled();
    expect(terminalFrame.src.endsWith('/console/session-1?viewerId=viewer-test')).toBe(true);
    expect(app.reconnectManager.setCurrentSession).toHaveBeenCalledWith('session-1');
  });

  it('starts ttyd when runtimeStatus is missing', async () => {
    app.reconnectManager = { setCurrentSession: vi.fn() };

    appStore.setState({
      currentSessionId: null,
      sessions: [{
        id: 'session-1',
        name: 'Session 1',
        path: '/tmp/session-1',
        engine: 'codex',
        intendedState: 'active'
      }]
    });

    httpClient.get.mockResolvedValue({
      runtimeStatus: {
        ttydRunning: false,
        proxyPath: null
      },
      terminalAccess: {
        state: 'owner',
        ownerViewerLabel: 'Local / Mac',
        ownerLastSeenAt: null,
        canTakeover: false
      }
    });

    await app.switchSession('session-1');

    expect(httpClient.get.mock.calls[0][0]).toContain('/api/sessions/session-1/runtime?viewerId=viewer-test');
    expect(httpClient.post).toHaveBeenCalledWith('/api/sessions/start', expect.objectContaining({
      sessionId: 'session-1',
      engine: 'codex',
      viewerId: 'viewer-test'
    }));
  });

  it('reconnect reuses existing proxyPath without triggering takeover', async () => {
    await app.start();
    app.focusTerminal = vi.fn();
    vi.clearAllMocks();
    httpClient.get.mockResolvedValue({ runtimeStatus: null, terminalAccess: null });
    httpClient.post.mockResolvedValue({ proxyPath: '/console/session-1' });

    appStore.setState({
      currentSessionId: 'session-1',
      sessions: [{
        id: 'session-1',
        name: 'Session 1',
        path: '/tmp/session-1',
        engine: 'codex',
        intendedState: 'active',
        runtimeStatus: {
          ttydRunning: true,
          proxyPath: '/console/session-1?viewerId=viewer-test'
        }
      }]
    });

    const terminalFrame = document.getElementById('terminal-frame');
    terminalFrame.src = 'http://localhost:31013/console/session-1?viewerId=viewer-test';
    app.reconnectManager.terminalFrame = terminalFrame;
    app.reconnectManager.setCurrentSession('session-1');

    await app.reconnectManager.reconnect();
    await new Promise(resolve => setTimeout(resolve, 70));

    expect(httpClient.get).not.toHaveBeenCalledWith('/api/sessions/session-1/runtime');
    expect(httpClient.post).not.toHaveBeenCalled();
    expect(terminalFrame.src.endsWith('/console/session-1?viewerId=viewer-test')).toBe(true);
  });

  it('reconnect starts ttyd only when runtimeStatus says it is down', async () => {
    await app.start();
    app.focusTerminal = vi.fn();
    vi.clearAllMocks();
    httpClient.get.mockResolvedValue({ runtimeStatus: null, terminalAccess: null });
    httpClient.post.mockResolvedValue({ proxyPath: '/console/session-1' });

    appStore.setState({
      currentSessionId: 'session-1',
      sessions: [{
        id: 'session-1',
        name: 'Session 1',
        path: '/tmp/session-1',
        engine: 'codex',
        intendedState: 'active'
      }]
    });

    const terminalFrame = document.getElementById('terminal-frame');
    app.reconnectManager.terminalFrame = terminalFrame;
    app.reconnectManager.setCurrentSession('session-1');

    httpClient.get.mockResolvedValue({
      runtimeStatus: {
        ttydRunning: false,
        proxyPath: null
      },
      terminalAccess: {
        state: 'owner',
        ownerViewerLabel: 'Local / Mac',
        ownerLastSeenAt: null,
        canTakeover: false
      }
    });

    await app.reconnectManager.reconnect();

    expect(httpClient.get.mock.calls[0][0]).toContain('/api/sessions/session-1/runtime?viewerId=viewer-test');
    expect(httpClient.post).toHaveBeenCalledWith('/api/sessions/start', expect.objectContaining({
      sessionId: 'session-1',
      engine: 'codex',
      viewerId: 'viewer-test'
    }));
  });

  it('xterm transport成功時はterminal loading overlayを即時に閉じる', async () => {
    app.reconnectManager = { setCurrentSession: vi.fn() };
    app._shouldUseXtermTransport = vi.fn(() => true);
    app.terminalTransportClient = { show: vi.fn(), disconnect: vi.fn(), hide: vi.fn(), destroy: vi.fn() };
    app._connectXtermTransport = vi.fn().mockResolvedValue({ ok: true });

    appStore.setState({
      currentSessionId: null,
      sessions: [{
        id: 'session-1',
        name: 'Session 1',
        path: '/tmp/session-1',
        engine: 'codex',
        intendedState: 'active'
      }]
    });

    const overlay = document.getElementById('terminal-loading-overlay');
    overlay.classList.remove('hidden');

    await app.switchSession('session-1');

    expect(app._connectXtermTransport).toHaveBeenCalled();
    expect(overlay.classList.contains('hidden')).toBe(true);
  });

  it('xterm activeなら初期化待機でiframe待ちせずoverlayを閉じる', async () => {
    vi.useFakeTimers();
    appStore.setState({ currentSessionId: 'session-1' });
    app.terminalTransportClient = { getStatus: vi.fn(() => ({ mode: 'live' })), destroy: vi.fn() };
    app._terminalTransportStatus = { mode: 'live', connected: true };
    app._isXtermTransportActive = vi.fn(() => true);

    const overlay = document.getElementById('terminal-loading-overlay');
    overlay.classList.remove('hidden');

    await app._waitForClaudeInitialization('session-1');
    await vi.runAllTimersAsync();

    expect(overlay.classList.contains('hidden')).toBe(true);
    vi.useRealTimers();
  });

  it('reconnect runtime lookup失敗時_startせず再接続嵐を増やさない', async () => {
    await app.start();
    app.focusTerminal = vi.fn();
    vi.clearAllMocks();
    httpClient.get.mockResolvedValue({ runtimeStatus: null, terminalAccess: null });
    httpClient.post.mockResolvedValue({ proxyPath: '/console/session-1' });

    appStore.setState({
      currentSessionId: 'session-1',
      sessions: [{
        id: 'session-1',
        name: 'Session 1',
        path: '/tmp/session-1',
        engine: 'codex',
        intendedState: 'active'
      }]
    });

    const terminalFrame = document.getElementById('terminal-frame');
    app.reconnectManager.terminalFrame = terminalFrame;
    app.reconnectManager.setCurrentSession('session-1');
    httpClient.get.mockRejectedValue(new Error('runtime lookup failed'));

    await app.reconnectManager.reconnect();

    expect(httpClient.get.mock.calls[0][0]).toContain('/api/sessions/session-1/runtime?viewerId=viewer-test');
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  it('blocked runtime時_takeover前はstartせずabout:blankに留める', async () => {
    app.reconnectManager = { setCurrentSession: vi.fn(), terminalAccess: null, _setBlocked: vi.fn() };

    appStore.setState({
      currentSessionId: null,
      sessions: [{
        id: 'session-1',
        name: 'Session 1',
        path: '/tmp/session-1',
        engine: 'codex',
        intendedState: 'active'
      }]
    });

    httpClient.get.mockResolvedValue({
      runtimeStatus: {
        ttydRunning: true,
        proxyPath: null
      },
      terminalAccess: {
        state: 'blocked',
        ownerViewerLabel: 'Cloudflare / Mac',
        ownerLastSeenAt: '2026-03-11T00:00:00.000Z',
        canTakeover: true
      }
    });

    const terminalFrame = document.getElementById('terminal-frame');
    await app.switchSession('session-1');

    expect(httpClient.post).not.toHaveBeenCalled();
    expect(terminalFrame.src).toBe('about:blank');
    expect(app.reconnectManager._setBlocked).toHaveBeenCalled();
  });

  it('updates session UI state when attention changes while transport stays connected', async () => {
    const emitSpy = vi.spyOn(eventBus, 'emit');

    appStore.setState({
      currentSessionId: 'session-1',
      sessions: [{
        id: 'session-1',
        name: 'Session 1',
        path: '/tmp/session-1',
        engine: 'codex',
        intendedState: 'active',
        runtimeStatus: {
          ttydRunning: true,
          proxyPath: '/console/session-1'
        }
      }],
      sessionUi: {
        byId: {
          'session-1': {
            transport: 'connected',
            attention: 'none'
          }
        }
      }
    });

    app.terminalFrame = document.getElementById('terminal-frame');
    app.terminalInputStatusEl = document.createElement('div');
    document.body.appendChild(app.terminalInputStatusEl);
    app.reconnectManager = {
      wsConnected: true,
      isReconnecting: false,
      retryCount: 0,
      maxRetries: 3,
      lastDisconnectCode: null
    };

    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => document.body
    });

    app._updateTerminalInputStatus();

    expect(emitSpy).toHaveBeenCalledWith('session:ui-state-changed', { sessionIds: ['session-1'] });
  });
});
