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
            status: 'pending'
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
    });
});
