import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskView } from '../../../public/modules/ui/views/task-view.js';
import { TaskService } from '../../../public/modules/domain/task/task-service.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';
import { appStore } from '../../../public/modules/core/store.js';

// TaskServiceをモック化
vi.mock('../../../public/modules/domain/task/task-service.js', () => {
    return {
        TaskService: class MockTaskService {
            constructor() {
                this.loadTasks = vi.fn();
                this.completeTask = vi.fn();
                this.getFilteredTasks = vi.fn(() => []);
                this.getFocusTask = vi.fn(() => null);
            }
        }
    };
});

describe('TaskView', () => {
    let taskView;
    let mockTaskService;
    let container;

    beforeEach(() => {
        // DOM準備
        document.body.innerHTML = '<div id="test-container"></div>';
        container = document.getElementById('test-container');

        // モックサービス
        mockTaskService = new TaskService();
        taskView = new TaskView({ taskService: mockTaskService });

        // ストア初期化
        appStore.setState({
            tasks: [],
            filters: { taskFilter: '', showAllTasks: false }
        });

        vi.clearAllMocks();
    });

    describe('mount', () => {
        it('should mount to container element', () => {
            taskView.mount(container);

            expect(taskView.container).toBe(container);
        });

        it('should render on mount', () => {
            const mockTasks = [
                { id: '1', title: 'Task 1', status: 'todo' }
            ];
            mockTaskService.getFilteredTasks.mockReturnValue(mockTasks);

            taskView.mount(container);

            expect(container.innerHTML).not.toBe('');
        });
    });

    describe('render', () => {
        beforeEach(() => {
            taskView.mount(container);
        });

        it('should render focus task', () => {
            const focusTask = { id: 'focus-1', name: 'Focus Task', status: 'todo', priority: 'high' };
            mockTaskService.getFocusTask.mockReturnValue(focusTask);

            taskView.render();

            const focusCard = container.querySelector('.focus-card');
            expect(focusCard).toBeTruthy();
            expect(focusCard.textContent).toContain('Focus Task');
        });

        it('should display empty state when no tasks', () => {
            mockTaskService.getFocusTask.mockReturnValue(null);

            taskView.render();

            expect(container.innerHTML).toContain('タスクなし');
        });

        it('should render focus task with correct data', () => {
            const focusTask = {
                id: 'focus-1',
                name: 'Focus Task',
                status: 'todo',
                priority: 'high',
                project: 'test-project'
            };

            mockTaskService.getFocusTask.mockReturnValue(focusTask);

            taskView.render();

            const focusCard = container.querySelector('.focus-card');
            expect(focusCard).toBeTruthy();
            expect(focusCard.getAttribute('data-task-id')).toBe('focus-1');
            expect(focusCard.textContent).toContain('Focus Task');
        });
    });

    describe('event handling', () => {
        beforeEach(() => {
            const focusTask = { id: 'task-1', name: 'Task 1', status: 'todo', priority: 'high' };
            mockTaskService.getFocusTask.mockReturnValue(focusTask);
            taskView.mount(container);
        });

        it('should complete task on focus button click', async () => {
            mockTaskService.completeTask.mockResolvedValue();

            const completeButton = container.querySelector('.focus-btn-complete');
            completeButton.click();

            await vi.waitFor(() => {
                expect(mockTaskService.completeTask).toHaveBeenCalledWith('task-1');
            });
        });

        it('should update filter on input', () => {
            const filterInput = container.querySelector('[data-filter-input]');
            if (filterInput) {
                filterInput.value = 'test filter';
                filterInput.dispatchEvent(new Event('input'));

                expect(appStore.getState().filters.taskFilter).toBe('test filter');
            }
        });
    });

    describe('focus task actions', () => {
        beforeEach(() => {
            const focusTask = {
                id: 'focus-1',
                title: 'Focus Task',
                name: 'Focus Task',
                status: 'todo',
                priority: 'high',
                project: 'test-project',
                due: '2025-12-25'
            };
            mockTaskService.getFocusTask.mockReturnValue(focusTask);
            mockTaskService.getFilteredTasks.mockReturnValue([focusTask]);
            taskView.mount(container);
        });

        it('should render complete button in focus task', () => {
            const completeBtn = container.querySelector('.focus-btn-complete');
            expect(completeBtn).toBeTruthy();
            expect(completeBtn.textContent).toContain('完了');
        });

        it('should render defer button in focus task', () => {
            const deferBtn = container.querySelector('.focus-btn-defer');
            expect(deferBtn).toBeTruthy();
            expect(deferBtn.textContent).toContain('後で');
        });

        it('should render start button in focus task', () => {
            const startBtn = container.querySelector('.focus-btn-start');
            expect(startBtn).toBeTruthy();
            expect(startBtn.textContent).toContain('開始');
        });

        it('should call deferTask on defer button click', async () => {
            mockTaskService.deferTask = vi.fn().mockResolvedValue();

            const deferBtn = container.querySelector('.focus-btn-defer');
            deferBtn.click();

            await vi.waitFor(() => {
                expect(mockTaskService.deferTask).toHaveBeenCalledWith('focus-1');
            });
        });

        it('should emit START_TASK event on start button click', async () => {
            const emitSpy = vi.spyOn(eventBus, 'emit');

            const startBtn = container.querySelector('.focus-btn-start');
            startBtn.click();

            expect(emitSpy).toHaveBeenCalledWith(
                EVENTS.START_TASK,
                expect.objectContaining({ task: expect.any(Object) })
            );
        });

        it('should display due date when present', () => {
            const focusCard = container.querySelector('.focus-card');
            expect(focusCard.innerHTML).toContain('due-tag');
        });

        it('should display project tag', () => {
            const projectTag = container.querySelector('.project-tag');
            expect(projectTag).toBeTruthy();
            expect(projectTag.textContent).toBe('test-project');
        });
    });

    describe('event subscriptions', () => {
        beforeEach(() => {
            taskView.mount(container);
        });

        it('should re-render on TASK_LOADED event', () => {
            const renderSpy = vi.spyOn(taskView, 'render');

            eventBus.emit(EVENTS.TASK_LOADED, { tasks: [] });

            expect(renderSpy).toHaveBeenCalled();
        });

        it('should re-render on TASK_COMPLETED event', () => {
            const renderSpy = vi.spyOn(taskView, 'render');

            eventBus.emit(EVENTS.TASK_COMPLETED, { taskId: 'test-1' });

            expect(renderSpy).toHaveBeenCalled();
        });

        it('should re-render on TASK_FILTER_CHANGED event', () => {
            const renderSpy = vi.spyOn(taskView, 'render');

            eventBus.emit(EVENTS.TASK_FILTER_CHANGED, {});

            expect(renderSpy).toHaveBeenCalled();
        });
    });
});
