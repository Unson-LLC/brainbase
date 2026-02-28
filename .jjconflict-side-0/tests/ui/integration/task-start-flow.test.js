import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskView } from '../../../public/modules/ui/views/task-view.js';
import { FocusEngineModal } from '../../../public/modules/ui/modals/focus-engine-modal.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';

describe('task start flow', () => {
  let container;
  let modalElement;
  let unsubscribe;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="focus-task"></div>
      <div id="focus-engine-modal" class="modal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>セッションの起動先</h3>
            <button class="close-modal-btn">x</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>AI Engine</label>
              <div class="radio-group">
                <label class="radio-label">
                  <input type="radio" name="focus-engine" value="claude" checked>
                  <span>Claude Code</span>
                </label>
                <label class="radio-label">
                  <input type="radio" name="focus-engine" value="codex">
                  <span>OpenAI Codex</span>
                </label>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary close-modal-btn">キャンセル</button>
            <button class="btn-primary" id="focus-engine-start-btn">開始</button>
          </div>
        </div>
      </div>
    `;

    container = document.getElementById('focus-task');
    modalElement = document.getElementById('focus-engine-modal');
  });

  afterEach(() => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    vi.restoreAllMocks();
  });

  it('opens engine modal on start, then emits with selected engine', async () => {
    const focusTask = {
      id: 'task-1',
      name: 'Focus Task',
      status: 'todo',
      priority: 'high',
      project: 'brainbase'
    };

    const mockTaskService = {
      getFocusTask: vi.fn(() => focusTask),
      completeTask: vi.fn(),
      deferTask: vi.fn(),
      updateTask: vi.fn()
    };

    const taskView = new TaskView({ taskService: mockTaskService });
    taskView.mount(container);

    const modal = new FocusEngineModal();
    modal.mount();

    const captured = [];
    unsubscribe = eventBus.on(EVENTS.START_TASK, (event) => {
      captured.push(event.detail);
      if (!event.detail.engine) {
        modal.open(event.detail.task);
      }
    });

    const startBtn = container.querySelector('.focus-btn-start');
    startBtn.click();

    expect(modalElement.classList.contains('active')).toBe(true);

    const codexRadio = modalElement.querySelector('input[name="focus-engine"][value="codex"]');
    codexRadio.checked = true;
    const startEngineBtn = modalElement.querySelector('#focus-engine-start-btn');
    startEngineBtn.click();

    await vi.waitFor(() => {
      expect(captured.some((detail) => detail.engine === 'codex')).toBe(true);
    });
  });
});
