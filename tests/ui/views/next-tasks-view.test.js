import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextTasksView } from '../../../public/modules/ui/views/next-tasks-view.js';
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
                this.deleteTask = vi.fn();
                this.getNextTasks = vi.fn(() => ({ tasks: [], totalCount: 0, remainingCount: 0 }));
                this.getFocusTask = vi.fn(() => null);
            }
        }
    };
});

describe('NextTasksView', () => {
    let nextTasksView;
    let mockTaskService;
    let container;

    beforeEach(() => {
        // DOM準備
        document.body.innerHTML = '<div id="test-container"></div>';
        container = document.getElementById('test-container');

        // モックサービス
        mockTaskService = new TaskService();
        nextTasksView = new NextTasksView({ taskService: mockTaskService });

        // ストア初期化
        appStore.setState({
            tasks: [],
            filters: { showAllTasks: false }
        });

        vi.clearAllMocks();
    });

    describe('mount', () => {
        it('should mount to container element', () => {
            nextTasksView.mount(container);

            expect(nextTasksView.container).toBe(container);
        });

        it('should render on mount', () => {
            const mockTasks = [
                { id: 'task-1', name: 'Task 1', project: 'proj-a', priority: 'medium' }
            ];
            mockTaskService.getNextTasks.mockReturnValue({ tasks: mockTasks, totalCount: 1, remainingCount: 0 });

            nextTasksView.mount(container);

            expect(container.innerHTML).not.toBe('');
        });
    });

    describe('render', () => {
        beforeEach(() => {
            nextTasksView.mount(container);
        });

        it('should display empty state when no tasks', () => {
            mockTaskService.getNextTasks.mockReturnValue({ tasks: [], totalCount: 0, remainingCount: 0 });

            nextTasksView.render();

            expect(container.innerHTML).toContain('他のタスクなし');
        });

        it('should render next task items', () => {
            const mockTasks = [
                { id: 'task-1', name: 'Task 1', project: 'proj-a', priority: 'medium' },
                { id: 'task-2', name: 'Task 2', project: 'proj-b', priority: 'low' }
            ];
            mockTaskService.getNextTasks.mockReturnValue({ tasks: mockTasks, totalCount: mockTasks.length, remainingCount: 0 });

            nextTasksView.render();

            expect(container.innerHTML).toContain('Task 1');
            expect(container.innerHTML).toContain('Task 2');
        });

        it('should display priority badge', () => {
            const mockTasks = [
                { id: 'task-1', name: 'High Priority Task', project: 'proj-a', priority: 'high' }
            ];
            mockTaskService.getNextTasks.mockReturnValue({ tasks: mockTasks, totalCount: mockTasks.length, remainingCount: 0 });

            nextTasksView.render();

            const priorityBadge = container.querySelector('.next-task-priority.high');
            expect(priorityBadge).toBeTruthy();
            expect(priorityBadge.textContent).toBe('high');
        });

        it('should display project name', () => {
            const mockTasks = [
                { id: 'task-1', name: 'Task 1', project: 'my-project', priority: 'medium' }
            ];
            mockTaskService.getNextTasks.mockReturnValue({ tasks: mockTasks, totalCount: mockTasks.length, remainingCount: 0 });

            nextTasksView.render();

            expect(container.innerHTML).toContain('my-project');
        });

        it('should render action buttons for each task', () => {
            const mockTasks = [
                { id: 'task-1', name: 'Task 1', project: 'proj-a', priority: 'medium' }
            ];
            mockTaskService.getNextTasks.mockReturnValue({ tasks: mockTasks, totalCount: mockTasks.length, remainingCount: 0 });

            nextTasksView.render();

            const startBtn = container.querySelector('.start-task-btn');
            const editBtn = container.querySelector('.edit-task-btn');
            const deleteBtn = container.querySelector('.delete-task-btn');

            expect(startBtn).toBeTruthy();
            expect(editBtn).toBeTruthy();
            expect(deleteBtn).toBeTruthy();
        });

        it('should render checkbox for completion', () => {
            const mockTasks = [
                { id: 'task-1', name: 'Task 1', project: 'proj-a', priority: 'medium' }
            ];
            mockTaskService.getNextTasks.mockReturnValue({ tasks: mockTasks, totalCount: mockTasks.length, remainingCount: 0 });

            nextTasksView.render();

            const checkbox = container.querySelector('.next-task-checkbox');
            expect(checkbox).toBeTruthy();
        });
    });

    describe('event handling', () => {
        beforeEach(() => {
            const mockTasks = [
                { id: 'task-1', name: 'Task 1', project: 'proj-a', priority: 'medium' }
            ];
            mockTaskService.getNextTasks.mockReturnValue({ tasks: mockTasks, totalCount: mockTasks.length, remainingCount: 0 });
            nextTasksView.mount(container);
        });

        it('should complete task on checkbox click', async () => {
            mockTaskService.completeTask.mockResolvedValue();

            const checkbox = container.querySelector('.next-task-checkbox');
            checkbox.click();

            await vi.waitFor(() => {
                expect(mockTaskService.completeTask).toHaveBeenCalledWith('task-1');
            });
        });

        it('should emit START_TASK event on start button click', () => {
            const emitSpy = vi.spyOn(eventBus, 'emit');

            const startBtn = container.querySelector('.start-task-btn');
            startBtn.click();

            expect(emitSpy).toHaveBeenCalledWith(
                EVENTS.START_TASK,
                expect.objectContaining({ taskId: 'task-1' })
            );
        });

        it('should delete task on delete button click', async () => {
            mockTaskService.deleteTask.mockResolvedValue();
            global.confirm = vi.fn(() => true);

            const deleteBtn = container.querySelector('.delete-task-btn');
            deleteBtn.click();

            await vi.waitFor(() => {
                expect(mockTaskService.deleteTask).toHaveBeenCalledWith('task-1');
            });
        });
    });

    describe('event subscriptions', () => {
        beforeEach(() => {
            nextTasksView.mount(container);
        });

        it('should re-render on TASK_LOADED event', () => {
            const renderSpy = vi.spyOn(nextTasksView, 'render');

            eventBus.emit(EVENTS.TASK_LOADED, { tasks: [] });

            expect(renderSpy).toHaveBeenCalled();
        });

        it('should re-render on TASK_COMPLETED event', () => {
            const renderSpy = vi.spyOn(nextTasksView, 'render');

            eventBus.emit(EVENTS.TASK_COMPLETED, { taskId: 'test-1' });

            expect(renderSpy).toHaveBeenCalled();
        });

        it('should re-render on TASK_DELETED event', () => {
            const renderSpy = vi.spyOn(nextTasksView, 'render');

            eventBus.emit(EVENTS.TASK_DELETED, { taskId: 'test-1' });

            expect(renderSpy).toHaveBeenCalled();
        });
    });
});
