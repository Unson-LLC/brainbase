import { describe, expect, it, vi } from 'vitest';

import { NocoDBTaskService } from '../../../public/modules/domain/nocodb-task/nocodb-task-service.js';

function repository({ bearer = true, canonicalPages = null } = {}) {
    const defaultPage = { items: [{
        id: 'ct1.id', version: 3, title: '正本タスク', status: 'pending', priority: 'urgent',
        assignee_person_id: 'sato_keigo', assignee_display_name: '佐藤圭吾', source_refs: []
    }] };
    return {
        hasBearerAuth: () => bearer,
        fetchAllTasks: vi.fn(async () => ({
            records: [{ project: 'legacy', id: 2, baseId: 'legacy-base', fields: { 'タイトル': '旧タスク', 'ステータス': '未着手', '優先度': '中' } }],
            projects: [{ id: 'legacy', baseId: 'legacy-base' }],
            canonicalTaskStore: { baseId: 'canonical-base', project: 'brainbase' }
        })),
        fetchCanonicalTasks: vi.fn(async cursor => canonicalPages?.get(cursor || null) || defaultPage),
        transitionCanonicalTask: vi.fn(async (_id, input) => ({
            id: 'ct1.id', version: input.expected_version + 1, title: '正本タスク',
            status: input.to_status, priority: 'urgent', assignee_person_id: 'sato_keigo', source_refs: []
        })),
        createCanonicalTask: vi.fn(async input => ({
            id: 'ct1.created', version: 1, title: input.title, status: 'pending',
            priority: input.priority, assignee_person_id: input.assignee_person_id, source_refs: input.source_refs
        }))
    };
}

describe('NocoDBTaskService canonical routing', () => {
    it('merges the required canonical list and keeps opaque id/version', async () => {
        const repo = repository();
        const service = new NocoDBTaskService({ httpClient: {}, repository: repo });
        const tasks = await service.loadTasks();

        expect(tasks.map(task => task.id)).toEqual(['canonical:ct1.id', 'nocodb:legacy:2']);
        expect(tasks[0]).toMatchObject({ canonicalTaskId: 'ct1.id', canonicalVersion: 3, priority: 'urgent' });
    });

    it('loads every canonical task page before merging legacy tasks', async () => {
        const repo = repository({
            canonicalPages: new Map([
                [null, { items: [{
                    id: 'ct1.id', version: 3, title: '1ページ目', status: 'pending', priority: 'high', source_refs: []
                }], next_cursor: 'page-2' }],
                ['page-2', { items: [{
                    id: 'ct2.id', version: 1, title: '2ページ目', status: 'pending', priority: 'medium', source_refs: []
                }], next_cursor: null }]
            ])
        });
        const service = new NocoDBTaskService({ httpClient: {}, repository: repo });

        const tasks = await service.loadTasks();

        expect(tasks.map(task => task.id)).toEqual([
            'canonical:ct1.id',
            'canonical:ct2.id',
            'nocodb:legacy:2'
        ]);
        expect(repo.fetchCanonicalTasks).toHaveBeenNthCalledWith(1, null);
        expect(repo.fetchCanonicalTasks).toHaveBeenNthCalledWith(2, 'page-2');
    });

    it('fails closed when the canonical task cursor repeats', async () => {
        const repo = repository({
            canonicalPages: new Map([
                [null, { items: [], next_cursor: 'repeat' }],
                ['repeat', { items: [], next_cursor: 'repeat' }]
            ])
        });
        const service = new NocoDBTaskService({ httpClient: {}, repository: repo });

        await expect(service.loadTasks()).rejects.toThrow(/cursor repeated/);
        expect(repo.fetchCanonicalTasks).toHaveBeenCalledTimes(2);
    });

    it('routes canonical status changes with expected version and updates the version', async () => {
        const repo = repository();
        const service = new NocoDBTaskService({ httpClient: {}, repository: repo });
        await service.loadTasks();

        const updated = await service.updateStatus('canonical:ct1.id', 'completed');

        expect(repo.transitionCanonicalTask).toHaveBeenCalledWith('ct1.id', {
            expected_version: 3, to_status: 'completed'
        }, expect.stringMatching(/^browser-status-/));
        expect(updated).toMatchObject({ status: 'completed', canonicalVersion: 4 });
    });

    it('fails closed for the canonical project without bearer auth', async () => {
        const repo = repository({ bearer: false });
        const service = new NocoDBTaskService({ httpClient: {}, repository: repo });
        await expect(service.loadTasks())
            .rejects.toMatchObject({ code: 'task_bearer_required' });
        expect(repo.fetchCanonicalTasks).not.toHaveBeenCalled();
    });

    it('creates a canonical task with a People SSOT person id instead of a free-text assignee', async () => {
        const repo = repository();
        const service = new NocoDBTaskService({ httpClient: {}, repository: repo });
        await service.loadTasks();

        await service.createTask({
            projectId: 'brainbase',
            title: '人物IDで担当する',
            assignee: '佐藤 圭吾',
            assigneePersonId: 'sato_keigo',
            priority: 'high',
            due: '2026-07-21',
            description: '自由入力名は正本へ渡さない'
        });

        expect(repo.createCanonicalTask).toHaveBeenCalledWith(expect.objectContaining({
            title: '人物IDで担当する',
            assignee_person_id: 'sato_keigo'
        }), expect.stringMatching(/^browser-create-/));
        expect(repo.createCanonicalTask.mock.calls[0][0]).not.toHaveProperty('assignee');
    });

    it('rejects canonical creation when no People SSOT person id is available', async () => {
        const repo = repository();
        const service = new NocoDBTaskService({ httpClient: {}, repository: repo });
        await service.loadTasks();

        await expect(service.createTask({
            projectId: 'brainbase', title: '担当者不明', assignee: '自由入力', priority: 'medium'
        })).rejects.toMatchObject({ code: 'task_assignee_person_id_required' });
        expect(repo.createCanonicalTask).not.toHaveBeenCalled();
    });
});
