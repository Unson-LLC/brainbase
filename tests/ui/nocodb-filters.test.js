import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupNocoDBFilters } from '../../public/modules/ui/nocodb-filters.js';

describe('setupNocoDBFilters', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <input id="nocodb-task-search" />
            <select id="nocodb-assignee-filter">
                <option value="">all</option>
                <option value="user">user</option>
            </select>
            <select id="nocodb-project-filter">
                <option value="">all</option>
                <option value="proj1">proj1</option>
            </select>
            <input id="nocodb-hide-completed" type="checkbox" />
            <button id="nocodb-sync-btn">sync</button>
        `;
    });

    it('各フィルタ変更でコールバックが呼ばれる', () => {
        const onSearchChange = vi.fn();
        const onAssigneeChange = vi.fn();
        const onProjectChange = vi.fn();
        const onHideCompletedChange = vi.fn();

        setupNocoDBFilters({
            onSearchChange,
            onAssigneeChange,
            onProjectChange,
            onHideCompletedChange
        });

        const search = document.getElementById('nocodb-task-search');
        search.value = 'test';
        search.dispatchEvent(new Event('input'));

        const assignee = document.getElementById('nocodb-assignee-filter');
        assignee.value = 'user';
        assignee.dispatchEvent(new Event('change'));

        const project = document.getElementById('nocodb-project-filter');
        project.value = 'proj1';
        project.dispatchEvent(new Event('change'));

        const hideCompleted = document.getElementById('nocodb-hide-completed');
        hideCompleted.checked = true;
        hideCompleted.dispatchEvent(new Event('change'));

        expect(onSearchChange).toHaveBeenCalledWith('test');
        expect(onAssigneeChange).toHaveBeenCalledWith('user');
        expect(onProjectChange).toHaveBeenCalledWith('proj1');
        expect(onHideCompletedChange).toHaveBeenCalledWith(true);
    });

    it('syncボタンでコールバックが呼ばれる', () => {
        const onSync = vi.fn();

        setupNocoDBFilters({ onSync });

        document.getElementById('nocodb-sync-btn').click();
        expect(onSync).toHaveBeenCalled();
    });

    it('cleanup後はイベントが呼ばれない', () => {
        const onSearchChange = vi.fn();
        const cleanup = setupNocoDBFilters({ onSearchChange });

        cleanup();

        const search = document.getElementById('nocodb-task-search');
        search.value = 'test';
        search.dispatchEvent(new Event('input'));

        expect(onSearchChange).not.toHaveBeenCalled();
    });
});
