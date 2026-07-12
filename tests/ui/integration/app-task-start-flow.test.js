import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';
import { appStore } from '../../../public/modules/core/store.js';

vi.mock('../../../public/modules/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn()
}));

vi.mock('../../../public/modules/confirm-modal.js', () => ({
  showConfirm: vi.fn(async () => true)
}));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const htmlPath = path.join(repoRoot, 'public/index.html');

describe('app task start flow (app.js integration)', { timeout: 20000 }, () => {
  let app;

  beforeEach(async () => {
    // Prevent auto-start side effects
    window.__BRAINBASE_TEST__ = true;

    // Load full HTML to match real DOM structure
    const html = readFileSync(htmlPath, 'utf-8');
    const dom = new JSDOM(html);
    document.body.innerHTML = dom.window.document.body.innerHTML;
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);

    const { createApp } = await import('../../../public/app.js');
    app = createApp();

    const mockSessionService = {
      createSession: vi.fn(async () => ({ id: 'session-1' })),
      updateSession: vi.fn(async () => {}),
      deleteSession: vi.fn(async () => {}),
      pauseSession: vi.fn(async () => {}),
      resumeSession: vi.fn(async () => {}),
      refreshSessionUiSummaries: vi.fn(async () => ({}))
    };

    app.sessionService = mockSessionService;
    app.nocodbTaskService = { updateStatus: vi.fn(async () => {}) };
    app.switchSession = vi.fn(async (sessionId) => {
      appStore.setState({ currentSessionId: sessionId });
    });
    app.loadSessionData = vi.fn(async () => {});
    app.showConsole = vi.fn();

    app.initModals();
    await app.setupEventListeners();
  });

  afterEach(() => {
    app?.destroy?.();
    vi.restoreAllMocks();
  });

  it('routes START_TASK (NocoDB task) through app.js handler and creates session with selected engine', async () => {
    const modal = document.getElementById('focus-engine-modal');

    const nocodbTask = {
      id: 'task-1',
      name: 'Focus Task',
      status: 'todo',
      priority: 'high',
      project: 'brainbase',
      source: 'nocodb'
    };

    // Start from a NocoDB task action (no engine specified → opens engine picker)
    eventBus.emit(EVENTS.START_TASK, { task: nocodbTask });

    await vi.waitFor(() => {
      expect(modal.classList.contains('active')).toBe(true);
    });

    const codexRadio = modal.querySelector('input[name="focus-engine"][value="codex"]');
    codexRadio.checked = true;
    const startEngineBtn = modal.querySelector('#focus-engine-start-btn');
    startEngineBtn.click();

    await vi.waitFor(() => {
      expect(app.sessionService.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          project: 'brainbase',
          engine: 'codex'
        })
      );
    });

    await vi.waitFor(() => {
      expect(app.switchSession).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ proxyPath: null })
      );
    });

    await vi.waitFor(() => {
      expect(app.nocodbTaskService.updateStatus).toHaveBeenCalledWith('task-1', 'in_progress');
    });
  });

  it('SESSION_CHANGED時_terminal切替をloadSessionData完了より先に返す', async () => {
    let resolveLoadData;
    app.switchSession = vi.fn(async () => {});
    app.loadSessionData = vi.fn(() => new Promise((resolve) => {
      resolveLoadData = resolve;
    }));
    app.showConsole = vi.fn();
    app.focusTerminal = vi.fn();

    const result = await Promise.race([
      eventBus.emit(EVENTS.SESSION_CHANGED, { sessionId: 'session-1', proxyPath: null }),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 50))
    ]);

    expect(result).not.toBe('timeout');
    expect(app.switchSession).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ proxyPath: null })
    );
    expect(app.showConsole).toHaveBeenCalled();
    expect(app.focusTerminal).toHaveBeenCalledWith('session-changed');
    expect(app.loadSessionData).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(app.loadSessionData).toHaveBeenCalledWith('session-1');
    });

    resolveLoadData?.();
  });
});
