import { describe, expect, it, vi } from 'vitest';

import { NocoDBTaskRepository } from '../../../public/modules/domain/nocodb-task/nocodb-task-repository.js';

describe('NocoDBTaskRepository canonical routing', () => {
    it('uses the versioned Companion API and idempotency headers', async () => {
        const http = {
            hasBearerAuth: () => true,
            get: vi.fn(async () => ({ items: [] })),
            post: vi.fn(async () => ({ id: 'ct1.id', version: 1 })),
            patch: vi.fn(async () => ({ id: 'ct1.id', version: 2 })),
            delete: vi.fn(async () => ({ deleted: true, version: 3 }))
        };
        const repository = new NocoDBTaskRepository({ httpClient: http });

        expect(repository.hasBearerAuth()).toBe(true);
        await repository.fetchCanonicalTasks();
        await repository.createCanonicalTask({ title: '確認' }, 'create-1');
        await repository.updateCanonicalTask('ct1.id', { expected_version: 1, title: '更新' }, 'update-1');
        await repository.transitionCanonicalTask('ct1.id', { expected_version: 2, to_status: 'completed' }, 'status-1');
        await repository.deleteCanonicalTask('ct1.id', 2, 'delete-1');

        expect(http.get).toHaveBeenCalledWith('/api/companion/tasks?limit=50');
        expect(http.post).toHaveBeenCalledWith('/api/companion/tasks', { title: '確認' }, { headers: { 'Idempotency-Key': 'create-1' } });
        expect(http.patch).toHaveBeenCalledWith('/api/companion/tasks/ct1.id', { expected_version: 1, title: '更新' }, { headers: { 'Idempotency-Key': 'update-1' } });
        expect(http.post).toHaveBeenCalledWith('/api/companion/tasks/ct1.id/transitions', { expected_version: 2, to_status: 'completed' }, { headers: { 'Idempotency-Key': 'status-1' } });
        expect(http.delete).toHaveBeenCalledWith('/api/companion/tasks/ct1.id', expect.objectContaining({ headers: { 'Idempotency-Key': 'delete-1' } }));
    });
});
