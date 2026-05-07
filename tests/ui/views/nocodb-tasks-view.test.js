import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NocoDBTasksView } from '../../../public/modules/ui/views/nocodb-tasks-view.js';
import { appStore } from '../../../public/modules/core/store.js';

const buildService = (overrides = {}) => ({
    isLoading: () => false,
    getFilteredTasks: vi.fn(() => []),
    tasks: [],
    ...overrides
});

describe('NocoDBTasksView', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        appStore.setState({ preferences: { user: { assignee: '' } } });
    });

    it('自分だけフィルタで担当者未設定の場合は設定案内を表示する', () => {
        const service = buildService();
        const view = new NocoDBTasksView({ nocodbTaskService: service });
        const container = document.createElement('div');
        document.body.appendChild(container);
        view.container = container;

        view.render();

        expect(service.getFilteredTasks).not.toHaveBeenCalled();
        expect(container.textContent).toContain('自分だけ');
        expect(container.textContent).toContain('Settings');
    });

    it('自分だけフィルタ時は担当者名を解決して渡す', () => {
        appStore.setState({ preferences: { user: { assignee: 'ksato' } } });
        const tasks = [{
            id: 'nocodb:proj:1',
            title: 'Test task',
            project: 'proj',
            status: 'pending',
            assignee: 'ksato'
        }];
        const service = buildService({ getFilteredTasks: vi.fn(() => tasks) });
        const view = new NocoDBTasksView({ nocodbTaskService: service });
        const container = document.createElement('div');
        document.body.appendChild(container);
        view.container = container;

        view.render();

        expect(service.getFilteredTasks).toHaveBeenCalled();
        const filterArg = service.getFilteredTasks.mock.calls[0][0];
        expect(filterArg.assignee).toBe('ksato');
        expect(container.textContent).toContain('Test task');
        expect(container.querySelector('.task-status-select.status-pending')).toBeTruthy();
        expect(container.querySelector('.assignee-avatar')?.textContent).toBe('KS');
    });

    it('ステータスselectのクリックは親要素に伝播しない', () => {
        const tasks = [{
            id: 'nocodb:proj:1',
            title: 'Status task',
            project: 'proj',
            status: 'pending',
            assignee: 'ksato'
        }];
        const service = buildService({ getFilteredTasks: vi.fn(() => tasks) });
        const view = new NocoDBTasksView({ nocodbTaskService: service });
        view.currentFilter.assignee = '';

        const wrapper = document.createElement('div');
        const container = document.createElement('div');
        wrapper.appendChild(container);
        document.body.appendChild(wrapper);
        const parentClick = vi.fn();
        wrapper.addEventListener('click', parentClick);

        view.container = container;
        view.render();

        container.querySelector('.task-status-select').click();

        expect(parentClick).not.toHaveBeenCalled();
    });

    it('ステータスselectで未着手から完了へ変更できる', async () => {
        const tasks = [{
            id: 'nocodb:proj:1',
            title: 'Status task',
            project: 'proj',
            status: 'pending',
            assignee: 'ksato'
        }];
        const updateStatus = vi.fn(async (taskId, status) => {
            tasks[0].status = status;
            return tasks[0];
        });
        const service = buildService({
            getFilteredTasks: vi.fn(() => tasks),
            updateStatus
        });
        const view = new NocoDBTasksView({ nocodbTaskService: service });
        view.currentFilter.assignee = '';

        const wrapper = document.createElement('div');
        const container = document.createElement('div');
        wrapper.appendChild(container);
        document.body.appendChild(wrapper);
        const parentChange = vi.fn();
        wrapper.addEventListener('change', parentChange);

        view.container = container;
        view.render();

        const select = container.querySelector('.task-status-select');
        select.value = 'completed';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await Promise.resolve();

        expect(updateStatus).toHaveBeenCalledWith('nocodb:proj:1', 'completed');
        expect(tasks[0].status).toBe('completed');
        expect(parentChange).not.toHaveBeenCalled();
    });
});
