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

        it('should render task list', () => {
            const mockTasks = [
                { id: '1', title: 'Task 1', status: 'todo' },
                { id: '2', title: 'Task 2', status: 'todo' }
            ];
            mockTaskService.getFilteredTasks.mockReturnValue(mockTasks);

            taskView.render();

            const taskElements = container.querySelectorAll('[data-task-id]');
            expect(taskElements.length).toBe(2);
        });

        it('should display empty state when no tasks', () => {
            mockTaskService.getFilteredTasks.mockReturnValue([]);

            taskView.render();

            expect(container.innerHTML).toContain('タスクがありません');
        });

        it('should render focus task separately', () => {
            const focusTask = { id: 'focus-1', title: 'Focus Task', status: 'todo', priority: 'high' };
            const otherTasks = [
                { id: '2', title: 'Task 2', status: 'todo' }
            ];

            mockTaskService.getFocusTask.mockReturnValue(focusTask);
            mockTaskService.getFilteredTasks.mockReturnValue([focusTask, ...otherTasks]);

            taskView.render();

            const focusElement = container.querySelector('[data-focus-task]');
            expect(focusElement).toBeTruthy();
            expect(focusElement.textContent).toContain('Focus Task');
        });
    });

    describe('event handling', () => {
        beforeEach(() => {
            const mockTasks = [
                { id: 'task-1', title: 'Task 1', status: 'todo' }
            ];
            mockTaskService.getFilteredTasks.mockReturnValue(mockTasks);
            taskView.mount(container);
        });

        it('should complete task on button click', async () => {
            mockTaskService.completeTask.mockResolvedValue();

            const completeButton = container.querySelector('[data-action="complete"]');
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
