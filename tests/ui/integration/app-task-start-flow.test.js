import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';
import { TaskView } from '../../../public/modules/ui/views/task-view.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';

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

describe('app task start flow (app.js integration)', () => {
  let app;
  let taskView;

  beforeEach(async () => {
    // Prevent auto-start side effects
    window.__BRAINBASE_TEST__ = true;

    // Load full HTML to match real DOM structure
    const html = readFileSync(htmlPath, 'utf-8');
    const dom = new JSDOM(html);
    document.body.innerHTML = dom.window.document.body.innerHTML;

    const { createApp } = await import('../../../public/app.js');
    app = createApp();

    // Mock services for the flow
    const focusTask = {
      id: 'task-1',
      name: 'Focus Task',
      status: 'todo',
      priority: 'high',
      project: 'brainbase'
    };

    const mockTaskService = {
      getFocusTask: vi.fn(() => focusTask),
      getFilteredTasks: vi.fn(() => [focusTask]),
      updateTask: vi.fn(async () => {}),
      completeTask: vi.fn(async () => {}),
      deferTask: vi.fn(async () => {})
    };

    const mockSessionService = {
      createSession: vi.fn(async () => ({ id: 'session-1' })),
      updateSession: vi.fn(async () => {}),
      deleteSession: vi.fn(async () => {}),
      pauseSession: vi.fn(async () => {}),
      resumeSession: vi.fn(async () => {})
    };

    app.taskService = mockTaskService;
    app.sessionService = mockSessionService;
    app.nocodbTaskService = { updateStatus: vi.fn(async () => {}) };
    app.switchSession = vi.fn(async () => {});
    app.loadSessionData = vi.fn(async () => {});
    app.showConsole = vi.fn();

    app.initModals();
    await app.setupEventListeners();

    const focusContainer = document.getElementById('focus-task');
    taskView = new TaskView({ taskService: mockTaskService });
    taskView.mount(focusContainer);
  });

  afterEach(() => {
    taskView?.unmount?.();
    app?.destroy?.();
    vi.restoreAllMocks();
  });

  it('routes TaskView start through app.js handler and creates session with selected engine', async () => {
    const modal = document.getElementById('focus-engine-modal');

    // Start from TaskView
    const startBtn = document.querySelector('.focus-btn-start');
    startBtn.click();

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
      expect(app.switchSession).toHaveBeenCalledWith('session-1');
    });

    await vi.waitFor(() => {
      expect(app.taskService.updateTask).toHaveBeenCalledWith('task-1', expect.any(Object));
    });
  });
});
