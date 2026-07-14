import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appStore } from '../../../public/modules/core/store.js';
import { TaskAddModal } from '../../../public/modules/ui/modals/task-add-modal.js';

function renderModal() {
    document.body.innerHTML = `
        <div id="add-task-modal">
            <h3 id="add-task-modal-title"></h3>
            <input id="add-task-title">
            <input id="add-task-assignee">
            <select id="add-task-project"></select>
            <select id="add-task-priority"><option value="medium">medium</option></select>
            <input id="add-task-due">
            <textarea id="add-task-description"></textarea>
            <div id="add-task-error"></div>
            <button id="save-add-task-btn"></button>
        </div>`;
}

describe('TaskAddModal canonical assignee boundary', () => {
    beforeEach(() => {
        renderModal();
        appStore.setState({
            auth: { access: { personId: 'sato_keigo' } },
            preferences: { user: { assignee: '佐藤圭吾' } }
        });
        global.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({
                projects: [{ id: 'brainbase', nocodb: { base_name: 'Brainbase' }, canonicalTaskStore: true }]
            })
        }));
    });

    it('locks the canonical assignee to the authenticated People SSOT identity', async () => {
        const service = {
            isCanonicalProject: vi.fn(projectId => projectId === 'brainbase'),
            createTask: vi.fn(async () => ({}))
        };
        const modal = new TaskAddModal({ nocodbTaskService: service });
        modal.mount();
        await modal.open();

        const assignee = document.getElementById('add-task-assignee');
        expect(assignee.readOnly).toBe(true);
        expect(assignee.value).toBe('佐藤圭吾');

        document.getElementById('add-task-title').value = '正本タスク';
        await modal.save();

        expect(service.createTask).toHaveBeenCalledWith(expect.objectContaining({
            projectId: 'brainbase',
            title: '正本タスク',
            assigneePersonId: 'sato_keigo'
        }));
        expect(service.createTask.mock.calls[0][0]).not.toHaveProperty('assignee');
    });
});
