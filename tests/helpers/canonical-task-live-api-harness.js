import express from 'express';
import { createServer } from 'node:http';

import { createCompanionRouter } from '../../server/routes/companion.js';
import { createWorkflowRunRouter } from '../../server/routes/workflows.js';
import { CanonicalTaskService } from '../../server/services/companion/canonical-task-service.js';
import { InMemoryWorkflowRepository } from '../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../server/services/workflow/workflow-runner.js';
import {
    WorkflowService,
    createDefaultWorkflowHandlers
} from '../../server/services/workflow/workflow-service.js';

function normalizeSourceReference(reference) {
    const source = reference && typeof reference === 'object' ? reference : {};
    return {
        type: String(source.type || 'unknown'),
        id: String(source.id || source.output_id || source.step_id || source.candidate_id || 'unknown'),
        url: typeof source.url === 'string' && source.url ? source.url : null
    };
}

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
                source_refs: (input.source_refs || []).map(normalizeSourceReference),
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
    const completed = new Map();
    const inFlight = new Map();
    return {
        async execute({ scope, operationKey, fingerprint, run }) {
            const key = `${scope}:${operationKey}`;
            const replay = completed.get(key);
            if (replay) {
                if (replay.fingerprint !== fingerprint) {
                    throw Object.assign(new Error('Idempotency key was reused with different input'), {
                        code: 'idempotency_conflict', status: 409
                    });
                }
                return replay.result;
            }
            const concurrent = inFlight.get(key);
            if (concurrent) {
                if (concurrent.fingerprint !== fingerprint) {
                    throw Object.assign(new Error('Idempotency key was reused with different input'), {
                        code: 'idempotency_conflict', status: 409
                    });
                }
                return concurrent.promise;
            }
            const promise = Promise.resolve().then(run);
            inFlight.set(key, { fingerprint, promise });
            try {
                const result = await promise;
                completed.set(key, { fingerprint, result });
                return result;
            } finally {
                inFlight.delete(key);
            }
        },
        async executePreparedDelete({ prepare, findTask, removeTask }) {
            const prepared = await prepare();
            if (await findTask()) await removeTask();
            return prepared.result;
        }
    };
}

export async function startCanonicalTaskLiveApiHarness({ port = 0 } = {}) {
    const repository = createRepository();
    const workflowRepository = new InMemoryWorkflowRepository();
    const canonicalTaskService = new CanonicalTaskService({
        repository,
        operationRepository: createOperationRepository(),
        auditRepository: workflowRepository,
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
    const workflowService = new WorkflowService({
        repository: workflowRepository,
        runner: new WorkflowRunner({
            repository: workflowRepository,
            handlers: createDefaultWorkflowHandlers()
        }),
        configParser: {
            async getProjects() {
                return { root: '/workspace', projects: [{ id: 'brainbase', session_select: true }] };
            }
        },
        canonicalTaskService
    });
    workflowRepository.upsertWorkflow({
        id: 'wf-live-task-review',
        workspace_id: 'default',
        project_id: 'brainbase',
        name: 'Live Task Review',
        owner_id: 'sato_keigo',
        implementation_key: 'manual-placeholder'
    });
    workflowRepository.createRun({
        id: 'run-live-task-review',
        workspace_id: 'default',
        project_id: 'brainbase',
        workflow_id: 'wf-live-task-review',
        status: 'waiting_human',
        closure_state: 'open',
        human_waiting: true,
        action_required: 'approve'
    });
    workflowRepository.createOutput({
        id: 'out-live-task-review',
        workspace_id: 'default',
        project_id: 'brainbase',
        workflow_id: 'wf-live-task-review',
        workflow_run_id: 'run-live-task-review',
        type: 'task_candidates',
        metadata: { write_back_target: 'task_store' },
        payload: [{
            id: 'candidate-live-task-review',
            title: '承認から作る正本Task',
            selected_owner_id: 'sato_keigo'
        }]
    });
    workflowRepository.createHumanStep({
        id: 'human-live-task-review',
        workspace_id: 'default',
        project_id: 'brainbase',
        workflow_id: 'wf-live-task-review',
        workflow_run_id: 'run-live-task-review',
        requested_by: 'system',
        requested_to: 'sato_keigo',
        status: 'pending',
        metadata: {
            write_back_target: 'task_store',
            output_id: 'out-live-task-review'
        }
    });
    const app = express();
    app.use(express.json());
    app.get('/api/csrf-token', authGuard, (_req, res) => {
        res.json({ token: 'canonical-task-e2e-csrf' });
    });
    app.use('/api/companion', createCompanionRouter({
        replyDraftService: { createDraft: async () => ({}), createContext: async () => ({}) },
        canonicalTaskService,
        authGuard,
        accessGuardOptions: { ownerPersonId: 'sato_keigo' }
    }));
    app.use('/api/workflow-runs', authGuard, (req, res, next) => {
        if (
            req.get('x-csrf-token') !== 'canonical-task-e2e-csrf'
            || !req.get('x-session-id')
        ) {
            return res.status(403).json({ code: 'csrf_invalid', error: 'CSRF token required' });
        }
        next();
    }, createWorkflowRunRouter(workflowService));
    app.use((error, _req, res, _next) => {
        res.status(error.statusCode || error.status || 500).json({
            code: error.code || 'internal_error',
            error: error.message
        });
    });

    const server = createServer(app);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Canonical Task test server did not bind a TCP port');

    return {
        baseURL: `http://127.0.0.1:${address.port}`,
        approvalFixture: {
            runID: 'run-live-task-review',
            stepID: 'human-live-task-review',
            outputID: 'out-live-task-review'
        },
        close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    };
}
