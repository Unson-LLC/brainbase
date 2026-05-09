import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';
import { appStore } from '../../../public/modules/core/store.js';
import { httpClient } from '../../../public/modules/core/http-client.js';
import { eventBus } from '../../../public/modules/core/event-bus.js';
import { sessionDataCache } from '../../../public/modules/core/session-data-cache.js';
import { TerminalTransportClient } from '../../../public/modules/core/terminal-transport-client.js';

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

vi.mock('../../../public/modules/settings-extensions.js', () => ({
  SettingsExtensions: class SettingsExtensions {
    constructor() {}
    setupSettingsExtensions() {}
  }
}));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const htmlPath = path.join(repoRoot, 'public/index.html');

const defaultHttpGetResponse = async (url) => {
  if (url === '/api/state') {
    return { sessions: [], currentSessionId: null, preferences: {} };
  }
  if (url === '/api/tasks') {
    return [];
  }
  if (url === '/api/schedule/today') {
    return { events: [], items: [] };
  }
  return { runtimeStatus: null, terminalAccess: null };
};

describe('app switchSession runtime handling', () => {
  let app;

  beforeEach(async () => {
    sessionDataCache.clear();
    window.__BRAINBASE_TEST__ = true;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });

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

    vi.spyOn(httpClient, 'get').mockImplementation(defaultHttpGetResponse);
    vi.spyOn(httpClient, 'post').mockResolvedValue({ proxyPath: '/console/session-1' });
  });

  afterEach(() => {
    app?.destroy?.();
    vi.restoreAllMocks();
  });

  it('uses runtimeStatus proxyPath without starting ttyd again', async () => {
    app.reconnectManager = { setCurrentSession: vi.fn() };
    app._shouldUseXtermTransport = vi.fn(() => false);

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

    await app.switchSession('session-1');

    expect(httpClient.post).not.toHaveBeenCalled();
    expect(terminalFrame.src.endsWith('/console/session-1?viewerId=viewer-test')).toBe(true);
    expect(app.reconnectManager.setCurrentSession).toHaveBeenCalledWith('session-1');
  });

  it('forces ttyd startup when ttyd frame needs a runtime', async () => {
    app.reconnectManager = { setCurrentSession: vi.fn() };

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
    expect(httpClient.post).toHaveBeenCalledWith('/api/sessions/session-1/terminal/ensure', expect.objectContaining({
      engine: 'codex',
      viewerId: 'viewer-test',
      forceTtyd: true
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
  }, 15000);

  it('reconnect ensures ttyd only when runtimeStatus says it is down', async () => {
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
      cwd: '/tmp/session-1',
      engine: 'codex',
      viewerId: 'viewer-test'
    }));
  });

  it('xterm transport成功時はterminal loading overlayを即時に閉じる', async () => {
    app.reconnectManager = { setCurrentSession: vi.fn() };
    app._shouldUseXtermTransport = vi.fn(() => true);
    app.terminalTransportClient = { show: vi.fn(), disconnect: vi.fn(), hide: vi.fn(), destroy: vi.fn(), isActiveForSession: vi.fn(() => false) };
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

    expect(app._connectXtermTransport).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }), { deferDisplay: true });
    expect(overlay.classList.contains('hidden')).toBe(true);
  });

  it('desktop xtermではruntime完了後にensureしてからconnectする', async () => {
    app.reconnectManager = { setCurrentSession: vi.fn() };
    app._shouldUseXtermTransport = vi.fn(() => true);
    app.terminalXtermHost = document.getElementById('terminal-xterm-host');
    app.terminalTransportClient = { show: vi.fn(), disconnect: vi.fn(), hide: vi.fn(), destroy: vi.fn(), isActiveForSession: vi.fn(() => false) };

    let resolveRuntime;
    let resolveEnsure;
    app._resolveSessionRuntime = vi.fn(() => new Promise((resolve) => {
      resolveRuntime = resolve;
    }));
    app._ensureDesktopTerminalRuntime = vi.fn(() => new Promise((resolve) => {
      resolveEnsure = resolve;
    }));
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

    const switchPromise = app.switchSession('session-1');
    await Promise.resolve();

    expect(app._resolveSessionRuntime).toHaveBeenCalledTimes(1);
    expect(app._ensureDesktopTerminalRuntime).not.toHaveBeenCalled();
    expect(app._connectXtermTransport).not.toHaveBeenCalled();

    resolveRuntime({
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
    await Promise.resolve();

    expect(app._ensureDesktopTerminalRuntime).toHaveBeenCalledTimes(1);
    expect(app._connectXtermTransport).not.toHaveBeenCalled();

    resolveEnsure({ ok: true });
    await switchPromise;

    expect(app._connectXtermTransport).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }), { deferDisplay: true });
  });

  it('desktopではruntime待ち中にスナップショットを即表示する', async () => {
    app.reconnectManager = { setCurrentSession: vi.fn() };
    app._shouldUseXtermTransport = vi.fn(() => true);
    app.terminalXtermHost = document.getElementById('terminal-xterm-host');
    app.terminalTransportClient = { show: vi.fn(), disconnect: vi.fn(), hide: vi.fn(), destroy: vi.fn(), isActiveForSession: vi.fn(() => false) };
    app._connectXtermTransport = vi.fn().mockResolvedValue({ ok: true });

    let resolveRuntime;
    httpClient.get.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRuntime = resolve;
    }));

    app._terminalSnapshotCache.set('session-1', {
      text: 'cached snapshot',
      colorText: null,
      capturedAt: '2026-04-01T05:00:00.000Z'
    });

    appStore.setState({
      currentSessionId: 'session-previous',
      sessions: [
        {
          id: 'session-previous',
          name: 'Previous Session',
          path: '/tmp/session-previous',
          engine: 'codex',
          intendedState: 'active'
        },
        {
          id: 'session-1',
          name: 'Session 1',
          path: '/tmp/session-1',
          engine: 'codex',
          intendedState: 'active'
        }
      ]
    });
    document.getElementById('console-area').classList.add('using-xterm');
    document.getElementById('terminal-xterm-host').classList.remove('hidden');
    document.getElementById('terminal-snapshot-panel').classList.add('hidden');

    const switchPromise = app.switchSession('session-1');
    await Promise.resolve();

    // スナップショット即表示: xterm hostはfit計算のため維持し、snapshotを重ねて見せる
    expect(document.getElementById('terminal-xterm-host').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('terminal-snapshot-panel').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('terminal-loading-overlay').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('console-area').classList.contains('using-xterm')).toBe(true);

    resolveRuntime({
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

    await switchPromise;
  });

  it('desktop xterm切替ではcold cacheでもスナップショットプレースホルダーを表示しfastロードを発火する', async () => {
    app.reconnectManager = { setCurrentSession: vi.fn() };
    app._shouldUseXtermTransport = vi.fn(() => true);
    app.terminalXtermHost = document.getElementById('terminal-xterm-host');
    app.terminalTransportClient = { show: vi.fn(), disconnect: vi.fn(), hide: vi.fn(), destroy: vi.fn(), isActiveForSession: vi.fn(() => false) };
    app._connectXtermTransport = vi.fn().mockResolvedValue({ ok: true });

    const loadSnapshotSpy = vi.spyOn(app, '_loadTerminalSnapshot')
      .mockResolvedValue({
        text: 'fast snapshot',
        colorText: null,
        capturedAt: '2026-04-01T05:00:00.000Z',
        mode: 'fast'
      });

    httpClient.get.mockResolvedValueOnce({
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

    await app.switchSession('session-1');

    // cold cacheでもスナップショットパネルが表示され、バックグラウンドでfast loadが発火
    expect(loadSnapshotSpy).toHaveBeenCalledWith('session-1', { force: false, mode: 'fast' });
    // xterm接続成功後はxtermに切り替わる（snapshot hidden）
    expect(document.getElementById('terminal-snapshot-panel').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('console-area').classList.contains('using-xterm')).toBe(true);
  });

  it('desktop broken sessionでは接続失敗時にスナップショットfallbackを維持する', async () => {
    app.reconnectManager = { setCurrentSession: vi.fn() };
    app._shouldUseXtermTransport = vi.fn(() => true);
    app.terminalXtermHost = document.getElementById('terminal-xterm-host');
    app.terminalTransportClient = { show: vi.fn(), disconnect: vi.fn(), hide: vi.fn(), destroy: vi.fn(), isActiveForSession: vi.fn(() => false) };
    app._connectXtermTransport = vi.fn().mockResolvedValue({ ok: false });

    httpClient.get.mockResolvedValueOnce({
      runtimeStatus: {
        recoveryState: 'broken',
        recoveryReason: 'binding_missing',
        canRecover: false
      },
      terminalAccess: null
    });

    appStore.setState({
      currentSessionId: 'session-previous',
      sessions: [
        {
          id: 'session-previous',
          name: 'Previous Session',
          path: '/tmp/session-previous',
          engine: 'codex',
          intendedState: 'active'
        },
        {
          id: 'session-1',
          name: 'Session 1',
          path: '/tmp/session-1',
          engine: 'codex',
          intendedState: 'active'
        }
      ]
    });
    document.getElementById('console-area').classList.add('using-xterm');
    document.getElementById('terminal-xterm-host').classList.remove('hidden');
    document.getElementById('terminal-snapshot-panel').classList.add('hidden');

    const result = await app.switchSession('session-1');

    // 接続失敗時はsnapshot_fallbackモードで維持（真っ黒にしない）
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('snapshot_fallback');
    expect(document.getElementById('terminal-recovery-panel')).toBeNull();
  });

  it('desktop xterm切替完了後はsnapshotが非表示になりxtermに切り替わる', async () => {
    app.reconnectManager = { setCurrentSession: vi.fn() };
    app._shouldUseXtermTransport = vi.fn(() => true);
    app.terminalXtermHost = document.getElementById('terminal-xterm-host');
    app.terminalTransportClient = {
      show: vi.fn(),
      disconnect: vi.fn(),
      hide: vi.fn(),
      destroy: vi.fn(),
      isActiveForSession: vi.fn(() => false)
    };
    app._connectXtermTransport = vi.fn().mockResolvedValue({ ok: true });

    app._terminalSnapshotCache.set('session-1', {
      text: 'cached snapshot',
      colorText: null,
      capturedAt: '2026-04-01T05:00:00.000Z'
    });

    httpClient.get.mockResolvedValueOnce({
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

    await app.switchSession('session-1');

    // xterm接続成功後: snapshot hidden, xterm visible
    const snapshotPanel = document.getElementById('terminal-snapshot-panel');
    expect(snapshotPanel.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('terminal-xterm-host').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('console-area').classList.contains('using-xterm')).toBe(true);
  });

  it('mobile localhostではswitchSessionはsnapshot displayを使う', async () => {
    app.reconnectManager = { setCurrentSession: vi.fn(), terminalAccess: null };
    app._shouldUseXtermTransport = vi.fn(() => false);
    app.terminalTransportClient = { show: vi.fn(), disconnect: vi.fn(), hide: vi.fn(), destroy: vi.fn() };
    app._connectXtermTransport = vi.fn();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });

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

    const terminalFrame = document.getElementById('terminal-frame');
    await app.switchSession('session-1');

    expect(app._connectXtermTransport).not.toHaveBeenCalled();
    expect(httpClient.post).not.toHaveBeenCalled();
    expect(httpClient.get).toHaveBeenCalledWith(expect.stringContaining('/api/sessions/session-1/runtime?viewerId=viewer-test'));
    expect(terminalFrame.src).toBe('about:blank');
    expect(terminalFrame.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('console-area').classList.contains('using-snapshot')).toBe(true);
    expect(app.focusTerminal).not.toHaveBeenCalled();
  });

  it('mobileではsnapshot取得完了まで前のpresentationを維持する', async () => {
    app.reconnectManager = { setCurrentSession: vi.fn(), terminalAccess: null };
    app._shouldUseXtermTransport = vi.fn(() => false);
    app.terminalTransportClient = { show: vi.fn(), disconnect: vi.fn(), hide: vi.fn(), destroy: vi.fn() };
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });

    let resolveRuntime;
    let resolveSnapshot;
    httpClient.get.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRuntime = resolve;
    }));
    app._loadTerminalSnapshot = vi.fn(() => new Promise((resolve) => {
      resolveSnapshot = resolve;
    }));

    appStore.setState({
      currentSessionId: 'session-previous',
      sessions: [
        {
          id: 'session-previous',
          name: 'Previous Session',
          path: '/tmp/session-previous',
          engine: 'codex',
          intendedState: 'active'
        },
        {
          id: 'session-1',
          name: 'Session 1',
          path: '/tmp/session-1',
          engine: 'codex',
          intendedState: 'active'
        }
      ]
    });
    document.getElementById('console-area').classList.add('using-xterm');
    document.getElementById('terminal-xterm-host').classList.remove('hidden');
    document.getElementById('terminal-snapshot-panel').classList.add('hidden');

    const switchPromise = app.switchSession('session-1');
    await Promise.resolve();

    expect(document.getElementById('console-area').classList.contains('using-xterm')).toBe(true);
    expect(document.getElementById('terminal-snapshot-panel').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('terminal-loading-overlay').classList.contains('hidden')).toBe(false);

    resolveRuntime({
      runtimeStatus: null,
      terminalAccess: null
    });
    await vi.waitFor(() => {
      expect(app._loadTerminalSnapshot).toHaveBeenCalledWith('session-1', { force: true, mode: 'fast' });
      expect(typeof resolveSnapshot).toBe('function');
    });

    resolveSnapshot({
      text: 'fresh snapshot',
      colorText: null,
      capturedAt: '2026-04-01T05:00:00.000Z',
      mode: 'full'
    });
    await switchPromise;

    expect(document.getElementById('console-area').classList.contains('using-snapshot')).toBe(true);
    expect(document.getElementById('terminal-snapshot-panel').classList.contains('hidden')).toBe(false);
  });

  it('mobileでtapするとdedicated ttyd modalを開く', async () => {
    app.reconnectManager = { setCurrentSession: vi.fn(), terminalAccess: null };
    app._shouldUseXtermTransport = vi.fn(() => false);
    app.terminalTransportClient = { show: vi.fn(), disconnect: vi.fn(), hide: vi.fn(), destroy: vi.fn() };
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });

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

    await app.switchSession('session-1');
    vi.clearAllMocks();
    const modal = document.getElementById('mobile-live-terminal-modal');
    const modalFrame = document.getElementById('mobile-live-terminal-frame');
    httpClient.get.mockResolvedValueOnce({
      runtimeStatus: {
        ttydRunning: false,
        proxyPath: null
      },
      terminalAccess: null
    });
    httpClient.post.mockResolvedValueOnce({
      sessionId: 'session-1',
      port: 40123,
      proxyPath: '/console/session-1/',
      runtimeStatus: {
        ttydRunning: true,
        proxyPath: '/console/session-1/',
        port: 40123
      },
      terminalAccess: {
        state: 'owner',
        ownerViewerLabel: 'Local / Mac',
        ownerLastSeenAt: null,
        canTakeover: false
      }
    });

    await app.openMobileLiveTerminal('session-1');

    expect(httpClient.post).toHaveBeenCalledWith('/api/sessions/session-1/terminal/ensure', expect.objectContaining({
      engine: 'codex',
      viewerId: 'viewer-test',
      forceTtyd: true
    }));
    expect(modal.classList.contains('active')).toBe(true);
    expect(modalFrame.src).toContain('/console/session-1/');
    expect(modalFrame.src).toContain('viewerId=viewer-test');
  });

  it('mobile snapshot refresh always bypasses cache', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    app._mobileTerminalMode = 'snapshot';

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

    const loadSnapshotSpy = vi.spyOn(app, '_loadTerminalSnapshot').mockResolvedValue({
      text: 'fresh snapshot',
      colorText: null,
      capturedAt: '2026-04-01T05:00:00.000Z',
      mode: 'full'
    });

    await app._refreshMobileSnapshotDisplay();

    expect(loadSnapshotSpy).toHaveBeenCalledWith('session-1', { force: true });
  });

  it('mobile snapshot poll interval uses latest sessionUi hook status', async () => {
    const { replaceSessionHookStatuses } = await import('../../../public/modules/session-ui-state.js');

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    appStore.setState({
      currentSessionId: 'session-1',
      sessions: [{
        id: 'session-1',
        name: 'Session 1',
        path: '/tmp/session-1',
        engine: 'codex',
        intendedState: 'active',
        hookStatus: null
      }]
    });

    replaceSessionHookStatuses({
      'session-1': {
        isWorking: true,
        isDone: false,
        activeTurnCount: 0
      }
    });

    expect(app._getMobileSnapshotPollInterval('session-1')).toBe(1000);
  });

  it('mobile snapshot poll interval ignores stale session hook status from state payload', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    appStore.setState({
      currentSessionId: 'session-1',
      sessionUi: { byId: {} },
      sessions: [{
        id: 'session-1',
        name: 'Session 1',
        path: '/tmp/session-1',
        engine: 'codex',
        intendedState: 'active',
        hookStatus: { isWorking: true }
      }]
    });

    expect(app._getMobileSnapshotPollInterval('session-1')).toBe(3000);
  });

  it('mobile ensureがproxyPathを返さないとmodalを閉じる', async () => {
    app.reconnectManager = { setCurrentSession: vi.fn(), terminalAccess: null };
    app._shouldUseXtermTransport = vi.fn(() => false);
    app.terminalTransportClient = { show: vi.fn(), disconnect: vi.fn(), hide: vi.fn(), destroy: vi.fn() };
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });

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

    httpClient.get.mockResolvedValueOnce({
      runtimeStatus: {
        ttydRunning: false,
        proxyPath: null
      },
      terminalAccess: null
    });
    httpClient.post.mockResolvedValueOnce({
      sessionId: 'session-1',
      runtimeStatus: {
        ttydRunning: false,
        proxyPath: null
      },
      terminalAccess: null
    });

    await app.switchSession('session-1');
    const modal = document.getElementById('mobile-live-terminal-modal');
    const modalFrame = document.getElementById('mobile-live-terminal-frame');

    await app.openMobileLiveTerminal('session-1');

    expect(modal.classList.contains('active')).toBe(false);
    expect(modalFrame.src).toBe('about:blank');
  });

  it('mobile snapshot panel clickはlive terminal modalを開く', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    app.terminalFrame = document.getElementById('terminal-frame');
    app.setupTerminalInputUx();
    app._mobileTerminalMode = 'snapshot';
    const openSpy = vi.spyOn(app, 'openMobileLiveTerminal').mockResolvedValue({ ok: true });

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

    const snapshotPanel = document.getElementById('terminal-snapshot-panel');
    snapshotPanel.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(openSpy).toHaveBeenCalledWith('session-1');
  });

  it('OPEN_FILEは絶対パスから所有セッションと相対HTMLパスを解決する', async () => {
    app.terminalFrame = document.getElementById('terminal-frame');
    app.setupTerminalInputUx();
    app.fileViewerService = {
      openFile: vi.fn(async () => {})
    };
    app.showFileViewer = vi.fn();

    appStore.setState({
      currentSessionId: 'session-current',
      sessions: [
        {
          id: 'session-current',
          name: 'Current Session',
          path: '/tmp/current-session',
          engine: 'codex',
          intendedState: 'active'
        },
        {
          id: 'session-1778299307006',
          name: 'Aitle',
          path: '/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1778299307006-Aitle',
          worktree: {
            path: '/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1778299307006-Aitle'
          },
          engine: 'codex',
          intendedState: 'active'
        }
      ]
    });

    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: {
        type: 'OPEN_FILE',
        filePath: '/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1778299307006-Aitle/.vibepro/pr/story-shadow-gpt-realtime-2-architecture/pr-prepare.html',
        previewPath: null,
        previewable: true,
        sessionId: 'session-current',
        source: 'xterm'
      }
    }));

    await vi.waitFor(() => {
      expect(app.fileViewerService.openFile).toHaveBeenCalledWith(
        'session-1778299307006',
        '.vibepro/pr/story-shadow-gpt-realtime-2-architecture/pr-prepare.html'
      );
    });
    expect(app.showFileViewer).toHaveBeenCalled();
  });

  it('mobile status pill clickはlive terminal modalを開く', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    app.terminalFrame = document.getElementById('terminal-frame');
    app.setupTerminalInputUx();
    app._mobileTerminalMode = 'snapshot';
    const openSpy = vi.spyOn(app, 'openMobileLiveTerminal').mockResolvedValue({ ok: true });

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

    const status = document.getElementById('terminal-input-status');
    status.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(openSpy).toHaveBeenCalledWith('session-1');
  });

  it('mobile reconnect button clickはlive terminal modalを開く', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    app.terminalFrame = document.getElementById('terminal-frame');
    app.setupTerminalInputUx();
    app._mobileTerminalMode = 'snapshot';
    const openSpy = vi.spyOn(app, 'openMobileLiveTerminal').mockResolvedValue({ ok: true });

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

    const reconnectOpt = document.getElementById('transport-opt-reconnect');
    reconnectOpt.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(openSpy).toHaveBeenCalledWith('session-1');
  });

  it('mobile viewport更新時はinteractive modalへlayout messageを送る', async () => {
    app.reconnectManager = { setCurrentSession: vi.fn(), terminalAccess: null };
    app._shouldUseXtermTransport = vi.fn(() => false);
    app.terminalTransportClient = { show: vi.fn(), disconnect: vi.fn(), hide: vi.fn(), destroy: vi.fn() };
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });

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

    await app.switchSession('session-1');
    const modalFrame = document.getElementById('mobile-live-terminal-frame');
    Object.defineProperty(modalFrame, 'contentWindow', {
      configurable: true,
      value: { postMessage: vi.fn() }
    });
    await app.openMobileLiveTerminal('session-1');

    app.scheduleTerminalFrameLayoutSync({
      width: 390,
      height: 540,
      offsetTop: 0,
      offsetLeft: 0,
      keyboardOffset: 120,
      keyboardOpen: true
    });
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(modalFrame.contentWindow.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'bb-terminal-layout',
      width: 390,
      keyboardOffset: 120,
      keyboardOpen: true
    }), window.location.origin);
  });

  it('start後にcurrent sessionをxtermへ昇格する', async () => {
    app._shouldUseXtermTransport = vi.fn(() => true);
    vi.spyOn(app, 'loadInitialData').mockImplementation(async () => {
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
      document.getElementById('terminal-frame').src = 'http://localhost:31013/console/session-1?viewerId=viewer-test';
    });
    vi.spyOn(TerminalTransportClient.prototype, 'init').mockResolvedValue();
    vi.spyOn(TerminalTransportClient.prototype, 'destroy').mockImplementation(() => {});
    vi.spyOn(TerminalTransportClient.prototype, 'isActiveForSession').mockReturnValue(false);
    const switchSpy = vi.spyOn(app, 'switchSession').mockResolvedValue();

    await app.start();

    expect(switchSpy).toHaveBeenCalledWith('session-1');
  });

  it('mobile start後はcurrent sessionをsnapshot displayへ初期化する', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    app._shouldUseXtermTransport = vi.fn(() => false);
    vi.spyOn(app, 'loadInitialData').mockImplementation(async () => {
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
      document.getElementById('terminal-frame').src = 'http://localhost:31013/console/session-1?viewerId=viewer-test';
    });
    vi.spyOn(TerminalTransportClient.prototype, 'init').mockResolvedValue();
    vi.spyOn(TerminalTransportClient.prototype, 'destroy').mockImplementation(() => {});
    vi.spyOn(TerminalTransportClient.prototype, 'isActiveForSession').mockReturnValue(false);
    const switchSpy = vi.spyOn(app, 'switchSession').mockResolvedValue();

    await app.start();

    expect(switchSpy).toHaveBeenCalledWith('session-1');
  });

  it('current sessionが既にxterm activeなら再接続しない', async () => {
    app._shouldUseXtermTransport = vi.fn(() => true);
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
    app.terminalXtermHost = document.getElementById('terminal-xterm-host');
    app.terminalTransportClient = {
      isActiveForSession: vi.fn(() => true),
      destroy: vi.fn()
    };
    const switchSpy = vi.spyOn(app, 'switchSession').mockResolvedValue();

    const upgraded = await app._preferXtermForCurrentSession();

    expect(upgraded).toBe(false);
    expect(switchSpy).not.toHaveBeenCalled();
  });

  it('terminal transport snapshot callback warms app snapshot cache', async () => {
    const onSnapshotChange = vi.fn();
    const client = new TerminalTransportClient({
      viewerId: 'viewer-test',
      viewerLabel: 'Local / Mac',
      onSnapshotChange
    });
    client.sessionId = 'session-1';
    httpClient.get.mockResolvedValueOnce({
      text: 'fresh snapshot',
      colorText: null,
      capturedAt: '2026-04-01T05:00:00.000Z',
      copyMode: false
    });

    await client.refreshSnapshot();

    expect(onSnapshotChange).toHaveBeenCalledWith({
      sessionId: 'session-1',
      text: 'fresh snapshot',
      colorText: null,
      capturedAt: '2026-04-01T05:00:00.000Z'
    });
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

  it('reconnect recoverable runtimeでも通常startでruntimeを立て直す', async () => {
    await app.start();
    app.focusTerminal = vi.fn();
    vi.clearAllMocks();

    appStore.setState({
      currentSessionId: 'session-1',
      sessions: [{
        id: 'session-1',
        name: 'Session 1',
        path: '/tmp/session-1',
        engine: 'claude',
        intendedState: 'active'
      }]
    });

    const terminalFrame = document.getElementById('terminal-frame');
    app.reconnectManager.terminalFrame = terminalFrame;
    app.reconnectManager.setCurrentSession('session-1');

    httpClient.get.mockResolvedValue({
      runtimeStatus: {
        ttydRunning: false,
        proxyPath: null,
        recoveryState: 'recoverable',
        recoveryReason: 'tmux_missing',
        canRecover: true
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
      cwd: '/tmp/session-1',
      engine: 'claude',
      viewerId: 'viewer-test'
    }));
    expect(app.reconnectManager.isReconnecting).toBe(false);
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

  it('desktop switchSessionはttyd commit後に自動フォーカスを再試行する', async () => {
    vi.useFakeTimers();
    app.reconnectManager = { setCurrentSession: vi.fn(), terminalAccess: null };
    app._shouldUseXtermTransport = vi.fn(() => false);
    app.terminalTransportClient = { show: vi.fn(), disconnect: vi.fn(), hide: vi.fn(), destroy: vi.fn() };

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
    app.terminalFrame = terminalFrame;
    app.setupTerminalInputUx();

    await app.switchSession('session-1');

    expect(app.focusTerminal).toHaveBeenCalledWith('switchSession');

    await vi.advanceTimersByTimeAsync(220);
    const switchSessionCalls = app.focusTerminal.mock.calls.filter(([reason]) => reason === 'switchSession').length;
    expect(switchSessionCalls).toBeGreaterThan(1);
    vi.useRealTimers();
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

  it('loadInitialDataはarchived先頭を飛ばして最初の非archived sessionを選ぶ', async () => {
    app.sessionService = {
      loadSessions: vi.fn(async () => {
        appStore.setState({
          currentSessionId: null,
          sessions: [
            { id: 'session-archived', intendedState: 'archived' },
            { id: 'session-active', intendedState: 'active' },
            { id: 'session-paused', intendedState: 'paused' }
          ]
        });
      })
    };
    app.taskService = { loadTasks: vi.fn() };
    app.scheduleService = { loadSchedule: vi.fn() };
    app.refreshSessionUiSummaries = vi.fn();
    app.loadSessionData = vi.fn();
    app._updateSessionGoalBanner = vi.fn();

    const emitSpy = vi.spyOn(eventBus, 'emit').mockImplementation(async (event, detail) => {
      if (event === 'session:changed') {
        appStore.setState({ currentSessionId: detail.sessionId });
      }
    });

    await app.loadInitialData();

    expect(emitSpy).toHaveBeenCalledWith('session:changed', { sessionId: 'session-active' });
    expect(appStore.getState().currentSessionId).toBe('session-active');
    expect(app.loadSessionData).toHaveBeenCalledWith('session-active');
    expect(app.refreshSessionUiSummaries).toHaveBeenCalledWith(['session-active', 'session-paused']);
  });

  it('loadInitialDataは全sessionがarchivedなら自動選択しない', async () => {
    app.sessionService = {
      loadSessions: vi.fn(async () => {
        appStore.setState({
          currentSessionId: null,
          sessions: [
            { id: 'session-archived-1', intendedState: 'archived' },
            { id: 'session-archived-2', intendedState: 'archived' }
          ]
        });
      })
    };
    app.taskService = { loadTasks: vi.fn() };
    app.scheduleService = { loadSchedule: vi.fn() };
    app.refreshSessionUiSummaries = vi.fn();
    app.loadSessionData = vi.fn();
    app._updateSessionGoalBanner = vi.fn();

    const emitSpy = vi.spyOn(eventBus, 'emit').mockImplementation(async () => {});

    await app.loadInitialData();

    expect(emitSpy).not.toHaveBeenCalledWith('session:changed', expect.anything());
    expect(appStore.getState().currentSessionId).toBeNull();
    expect(app.loadSessionData).not.toHaveBeenCalled();
    expect(app.taskService.loadTasks).toHaveBeenCalled();
    expect(app.scheduleService.loadSchedule).toHaveBeenCalled();
    expect(app.refreshSessionUiSummaries).toHaveBeenCalledWith([]);
  });

  it('loadInitialDataは一時的なapi/state未準備をretryして非archived sessionを選ぶ', async () => {
    const loadSessions = vi.fn()
      .mockRejectedValueOnce(new Error('Service not ready'))
      .mockImplementationOnce(async () => {
        appStore.setState({
          currentSessionId: null,
          sessions: [
            { id: 'session-archived', intendedState: 'archived' },
            { id: 'session-active', intendedState: 'active' }
          ]
        });
      });

    app.sessionService = { loadSessions };
    app.taskService = { loadTasks: vi.fn() };
    app.scheduleService = { loadSchedule: vi.fn() };
    app.refreshSessionUiSummaries = vi.fn();
    app.loadSessionData = vi.fn();
    app._updateSessionGoalBanner = vi.fn();

    const emitSpy = vi.spyOn(eventBus, 'emit').mockImplementation(async (event, detail) => {
      if (event === 'session:changed') {
        appStore.setState({ currentSessionId: detail.sessionId });
      }
    });

    await app.loadInitialData();

    expect(loadSessions).toHaveBeenCalledTimes(2);
    expect(emitSpy).toHaveBeenCalledWith('session:changed', { sessionId: 'session-active' });
    expect(appStore.getState().currentSessionId).toBe('session-active');
    expect(app.loadSessionData).toHaveBeenCalledWith('session-active');
    expect(app.refreshSessionUiSummaries).toHaveBeenCalledWith(['session-active']);
  });

  it('snapshot prefetchはvisible sessionを優先しfull cache済みをskipする', async () => {
    document.getElementById('session-list').innerHTML = `
      <div class="session-child-row" data-id="session-paused"></div>
      <div class="session-child-row" data-id="session-active"></div>
      <div class="session-child-row" data-id="session-done"></div>
    `;
    for (const row of document.querySelectorAll('.session-child-row')) {
      Object.defineProperty(row, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ top: 0, bottom: 24, height: 24, width: 240 })
      });
    }
    Object.defineProperty(document.getElementById('session-list'), 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 0, bottom: 300, height: 300, width: 240 })
    });

    appStore.setState({
      currentSessionId: 'session-active',
      sessions: [
        { id: 'session-done', intendedState: 'done' },
        { id: 'session-paused', intendedState: 'paused' },
        { id: 'session-active', intendedState: 'active' }
      ]
    });

    app._cacheTerminalSnapshot('session-paused', {
      text: 'full cache',
      colorText: null,
      capturedAt: '2026-04-01T00:00:00.000Z',
      mode: 'full'
    });
    const loadSpy = vi.spyOn(app, '_loadTerminalSnapshot').mockImplementation(async (sessionId) => ({
      text: `${sessionId}-snapshot`,
      colorText: null,
      capturedAt: '2026-04-01T00:00:00.000Z',
      mode: 'fast'
    }));

    const candidates = app._getSnapshotPrefetchCandidates(8);
    expect(candidates).toEqual(['session-active', 'session-done']);

    await app._prefetchTerminalSnapshots(candidates);

    expect(loadSpy).toHaveBeenCalledTimes(2);
    expect(loadSpy).toHaveBeenNthCalledWith(1, 'session-active', { mode: 'fast' });
    expect(loadSpy).toHaveBeenNthCalledWith(2, 'session-done', { mode: 'fast' });
  });
});
