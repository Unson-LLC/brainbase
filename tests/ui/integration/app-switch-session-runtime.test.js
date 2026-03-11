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
    app.reconnectManager = { setCurrentSession: vi.fn() };
    app.focusTerminal = vi.fn();

    vi.spyOn(httpClient, 'get').mockResolvedValue({ sessions: [] });
    vi.spyOn(httpClient, 'post').mockResolvedValue({ proxyPath: '/console/session-1' });
  });

  afterEach(() => {
    app?.destroy?.();
    vi.restoreAllMocks();
  });

  it('uses runtimeStatus proxyPath without starting ttyd again', async () => {
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
});
