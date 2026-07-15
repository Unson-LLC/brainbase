import express from 'express';
import { createServer } from 'node:http';

import { createCompanionRouter } from '../../server/routes/companion.js';
import { CanonicalTaskService } from '../../server/services/companion/canonical-task-service.js';

function createRepository() {
    const tasks = new Map();
    let sequence = 0;

    return {
        async list({ limit, cursor }) {
            const start = cursor ? Number(cursor) : 0;
            const items = [...tasks.values()].slice(start, start + limit);
            const next = start + items.length;
            return {
                items,
                totalCount: tasks.size,
                nextCursor: next < tasks.size ? String(next) : null
            };
        },
        async get(taskId) {
            return tasks.get(taskId) || null;
        },
        async findByIdempotencyKey(key) {
            return [...tasks.values()].find(task => task._idempotency_key === key) || null;
        },
        async create(input) {
            sequence += 1;
            const now = new Date().toISOString();
            const task = {
                id: `ct1.live-${sequence}`,
                ...input,
                _idempotency_key: input.idempotency_key,
                _payload_fingerprint: input.payload_fingerprint,
                created_at: now,
                updated_at: now,
                source_refs: input.source_refs || [],
                normalization_warnings: []
            };
            tasks.set(task.id, task);
            return task;
        },
        async update(taskId, patch) {
            const current = tasks.get(taskId);
            if (!current) return null;
            const updated = { ...current, ...patch, updated_at: new Date().toISOString() };
            tasks.set(taskId, updated);
            return updated;
        },
        async delete(taskId) {
            tasks.delete(taskId);
        }
    };
}

function createOperationRepository() {
    return {
        async execute({ run }) {
            return run();
        },
        async executePreparedDelete({ prepare, findTask, removeTask }) {
            const prepared = await prepare();
            if (await findTask()) await removeTask();
            return prepared.result;
        }
    };
}

export async function startCanonicalTaskLiveApiHarness() {
    const repository = createRepository();
    const canonicalTaskService = new CanonicalTaskService({
        repository,
        operationRepository: createOperationRepository(),
        readiness: { assertMutationReady: async () => {} },
        ownerPersonId: 'sato_keigo',
        infoSSOTService: {
            listGraphEntities: async () => [{
                entity_id: 'sato_keigo',
                entity_type: 'person',
                payload: { person_id: 'sato_keigo', display_name: '佐藤圭吾' }
            }]
        }
    });
    const authGuard = (req, res, next) => {
        if (req.get('authorization') !== 'Bearer canonical-task-e2e') {
            return res.status(401).json({ code: 'unauthorized', error: 'Bearer authentication required' });
        }
        req.authSource = 'bearer';
        req.auth = { person_id: 'sato_keigo', sub: 'sato_keigo' };
        req.access = {
            personId: 'sato_keigo',
            role: 'ceo',
            projectCodes: ['brainbase'],
            clearance: ['internal']
        };
        next();
    };
    const app = express();
    app.use(express.json());
    app.use('/api/companion', createCompanionRouter({
        replyDraftService: { createDraft: async () => ({}), createContext: async () => ({}) },
        canonicalTaskService,
        authGuard,
        accessGuardOptions: { ownerPersonId: 'sato_keigo' }
    }));

    const server = createServer(app);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Canonical Task test server did not bind a TCP port');

    return {
        baseURL: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    };
}
