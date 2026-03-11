import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';
import { appStore } from '../../../public/modules/core/store.js';
import { httpClient } from '../../../public/modules/core/http-client.js';

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

    const { createApp } = await import('../../../public/app.js');
    app = createApp();
    app.focusTerminal = vi.fn();

    vi.spyOn(httpClient, 'get').mockResolvedValue({ sessions: [] });
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
          proxyPath: '/console/session-1'
        }
      }]
    });

    const terminalFrame = document.getElementById('terminal-frame');

    await app.switchSession('session-1');

    expect(httpClient.post).not.toHaveBeenCalled();
    expect(terminalFrame.src.endsWith('/console/session-1')).toBe(true);
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
      sessions: [{
        id: 'session-1',
        runtimeStatus: {
          ttydRunning: false,
          proxyPath: null
        }
      }]
    });

    await app.switchSession('session-1');

    expect(httpClient.get).toHaveBeenCalledWith('/api/state');
    expect(httpClient.post).toHaveBeenCalledWith('/api/sessions/start', expect.objectContaining({
      sessionId: 'session-1',
      engine: 'codex'
    }));
  });

  it('reconnect reuses existing proxyPath without triggering takeover', async () => {
    await app.start();
    app.focusTerminal = vi.fn();

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
      }]
    });

    const terminalFrame = document.getElementById('terminal-frame');
    terminalFrame.src = 'http://localhost:31013/console/session-1';
    app.reconnectManager.terminalFrame = terminalFrame;
    app.reconnectManager.setCurrentSession('session-1');

    httpClient.get.mockResolvedValue({
      sessions: [{
        id: 'session-1',
        runtimeStatus: {
          ttydRunning: true,
          proxyPath: '/console/session-1'
        }
      }]
    });

    await app.reconnectManager.reconnect();
    await new Promise(resolve => setTimeout(resolve, 70));

    expect(httpClient.get).toHaveBeenCalledWith('/api/state');
    expect(httpClient.post).not.toHaveBeenCalled();
    expect(terminalFrame.src.endsWith('/console/session-1')).toBe(true);
  });

  it('reconnect starts ttyd only when runtimeStatus says it is down', async () => {
    await app.start();
    app.focusTerminal = vi.fn();

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
      sessions: [{
        id: 'session-1',
        path: '/tmp/session-1',
        engine: 'codex',
        runtimeStatus: {
          ttydRunning: false,
          proxyPath: null
        }
      }]
    });

    await app.reconnectManager.reconnect();

    expect(httpClient.get).toHaveBeenCalledWith('/api/state');
    expect(httpClient.post).toHaveBeenCalledWith('/api/sessions/start', expect.objectContaining({
      sessionId: 'session-1',
      engine: 'codex'
    }));
  });
});
