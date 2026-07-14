import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createCompanionRouter } from '../../../server/routes/companion.js';

function appFor({ source = 'bearer', personId = 'sato_keigo', service } = {}) {
    const taskService = service || {
        listTasks: vi.fn(async () => ({ items: [], total_count: 0, count_status: 'exact', next_cursor: null, read_status: 'complete', warnings: [], as_of: '2026-07-14T00:00:00Z' })),
        getTask: vi.fn(async () => ({ id: 'ct1.task' })),
        createTask: vi.fn(async (_body, context) => ({ id: 'ct1.created', context })),
        updateTask: vi.fn(async () => ({ id: 'ct1.updated' })),
        transitionTask: vi.fn(async () => ({ id: 'ct1.transitioned' })),
        deleteTask: vi.fn(async () => ({ task_id: 'ct1.deleted', deleted: true, version: 2 }))
    };
    const authGuard = (req, _res, next) => {
        req.authSource = source;
        req.auth = { person_id: personId, sub: personId, service_id: 'service_test' };
        req.access = { personId, role: 'ceo', projectCodes: ['brainbase'], clearance: ['internal'] };
        next();
    };
    const app = express();
    app.use(express.json());
    app.use('/api/companion', createCompanionRouter({
        replyDraftService: { createDraft: vi.fn(), createContext: vi.fn() },
        canonicalTaskService: taskService,
        authGuard,
        accessGuardOptions: { ownerPersonId: 'sato_keigo' }
    }));
    return { app, taskService };
}

describe('Companion canonical Task routes', () => {
    it('passes repeated filters and returns Mac list metadata', async () => {
        const { app, taskService } = appFor();
        const response = await request(app).get('/api/companion/tasks?status=pending&status=waiting&priority=urgent');
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ total_count: 0, count_status: 'exact', read_status: 'complete' });
        expect(taskService.listTasks).toHaveBeenCalledWith(expect.objectContaining({ status: ['pending', 'waiting'], priority: 'urgent' }), expect.any(Object));
    });

    it('uses Idempotency-Key and typed owner principal on create', async () => {
        const { app, taskService } = appFor();
        const response = await request(app).post('/api/companion/tasks').set('Idempotency-Key', 'req-1').send({ title: '作成' });
        expect(response.status).toBe(201);
        expect(taskService.createTask).toHaveBeenCalledWith({ title: '作成' }, expect.objectContaining({
            idempotencyKey: 'req-1', principal: { type: 'person', id: 'sato_keigo' }
        }));
    });

    it.each([
        ['cookie', 'task_bearer_required'],
        ['insecure-header', 'task_owner_identity_required']
    ])('rejects %s before Task store access', async (source, code) => {
        const { app, taskService } = appFor({ source });
        const response = await request(app).get('/api/companion/tasks');
        expect(response.status).toBe(403);
        expect(response.body.code).toBe(code);
        expect(taskService.listTasks).not.toHaveBeenCalled();
    });

    it('serializes version and transition conflicts with current_task', async () => {
        const error = Object.assign(new Error('conflict'), { code: 'version_conflict', status: 409, currentTask: { id: 'ct1.task', version: 3 } });
        const service = { listTasks: vi.fn(), getTask: vi.fn(), createTask: vi.fn(), updateTask: vi.fn().mockRejectedValue(error), transitionTask: vi.fn(), deleteTask: vi.fn() };
        const { app } = appFor({ service });
        const response = await request(app).patch('/api/companion/tasks/ct1.task').send({ expected_version: 2, title: '変更' });
        expect(response.status).toBe(409);
        expect(response.body).toMatchObject({ code: 'version_conflict', current_task: { version: 3 } });
    });
});
