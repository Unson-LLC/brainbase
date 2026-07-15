import { describe, expect, it, vi } from 'vitest';

import { CanonicalTaskService } from '../../../server/services/companion/canonical-task-service.js';

const OWNER = 'sato_keigo';

function ownerContext() {
    return {
        principal: { type: 'person', id: OWNER },
        authSource: 'bearer',
        access: { personId: OWNER, role: 'ceo', projectCodes: ['brainbase'], clearance: ['internal'] }
    };
}

function baseTask(overrides = {}) {
    return {
        id: 'task_1', version: 1, title: '確認する', description: null,
        status: 'pending', priority: 'medium', assignee_person_id: OWNER,
        assignee_display_name: '佐藤圭吾', due_at: null, waiting_on: null,
        review_at: null, completed_at: null, source_refs: [],
        created_at: '2026-07-15T00:00:00.000Z', updated_at: '2026-07-15T00:00:00.000Z',
        web_url: null, normalization_warnings: [],
        ...overrides
    };
}

function createService({ repository, infoSSOTService, clock } = {}) {
    return new CanonicalTaskService({
        repository,
        infoSSOTService,
        clock,
        ownerPersonId: OWNER,
        readiness: { assertMutationReady: vi.fn(async () => {}) },
        operationRepository: { execute: vi.fn(async ({ run }) => run()) },
        auditRepository: { upsertAuditLog: vi.fn(async entry => entry) }
    });
}

describe('Canonical Task fail-closed and lifecycle persistence', () => {
    it('returns a structured 503 and does not write when Graph People is unavailable', async () => {
        const repository = {
            findByIdempotencyKey: vi.fn(async () => null),
            create: vi.fn()
        };
        const service = createService({
            repository,
            infoSSOTService: { listGraphEntities: vi.fn(async () => { throw new Error('graph offline'); }) }
        });

        await expect(service.createTask(
            { title: 'Graph障害時は作らない', assignee_person_id: OWNER },
            { ...ownerContext(), idempotencyKey: 'graph-outage' }
        )).rejects.toMatchObject({ code: 'assignee_directory_unavailable', status: 503 });

        expect(repository.create).not.toHaveBeenCalled();
    });

    it('persists review_at for waiting and completed_at for completion', async () => {
        let current = baseTask();
        const repository = {
            get: vi.fn(async () => current),
            update: vi.fn(async (_id, patch) => {
                current = { ...current, ...patch, version: current.version + 1 };
                return current;
            })
        };
        const service = createService({
            repository,
            clock: () => new Date('2026-07-15T03:00:00.000Z'),
            infoSSOTService: { listGraphEntities: vi.fn(async () => []) }
        });

        await service.transitionTask('task_1', {
            expected_version: 1,
            to_status: 'waiting',
            waiting_on: '先方回答',
            review_at: '2026-07-21T09:00:00+09:00'
        }, ownerContext());
        expect(repository.update).toHaveBeenLastCalledWith('task_1', expect.objectContaining({
            status: 'waiting',
            waiting_on: '先方回答',
            review_at: '2026-07-21T00:00:00.000Z',
            completed_at: null
        }));

        await service.transitionTask('task_1', {
            expected_version: 2,
            to_status: 'completed'
        }, ownerContext());
        expect(repository.update).toHaveBeenLastCalledWith('task_1', expect.objectContaining({
            status: 'completed',
            waiting_on: null,
            review_at: null,
            completed_at: '2026-07-15T03:00:00.000Z'
        }));
    });
});
