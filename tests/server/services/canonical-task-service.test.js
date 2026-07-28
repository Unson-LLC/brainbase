import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CanonicalTaskService, CanonicalTaskError } from '../../../server/services/companion/canonical-task-service.js';

const OWNER = 'sato_keigo';

function task(overrides = {}) {
    return {
        id: 'task_1', version: 1, title: '確認する', description: null,
        status: 'pending', priority: 'medium', assignee_person_id: OWNER,
        assignee_display_name: '佐藤圭吾', due_at: null, waiting_on: null,
        review_at: null, completed_at: null, source_refs: [], created_at: '2026-07-14T00:00:00.000Z',
        updated_at: '2026-07-14T00:00:00.000Z', web_url: null, normalization_warnings: [],
        ...overrides
    };
}

function setup({ ownerAliasIds = [] } = {}) {
    const auditEntries = new Map();
    const repository = {
        list: vi.fn(async () => ({ items: [task()], nextCursor: null })),
        get: vi.fn(async () => task()),
        findByIdempotencyKey: vi.fn(async () => null),
        create: vi.fn(async (fields) => task(fields)),
        update: vi.fn(async (_id, fields) => task({ ...fields, version: 2 })),
        delete: vi.fn(async () => undefined)
    };
    const people = {
        listGraphEntities: vi.fn(async (_access, { id }) => id === OWNER
            ? [{ entity_id: OWNER, entity_type: 'person', payload: { display_name: '佐藤圭吾', person_id: OWNER } }]
            : [])
    };
    const readiness = { assertMutationReady: vi.fn() };
    const auditRepository = {
        upsertAuditLog: vi.fn(async (entry) => {
            const existing = auditEntries.get(entry.id);
            const persisted = {
                created_at: existing?.created_at || '2026-07-14T01:00:00.000Z',
                ...existing,
                ...entry
            };
            auditEntries.set(entry.id, persisted);
            return persisted;
        })
    };
    const operations = {
        execute: vi.fn(async ({ run }) => run()),
        executePreparedDelete: vi.fn(async ({ prepare, findTask, removeTask }) => {
            const prepared = await prepare();
            const current = await findTask();
            if (current) await removeTask(current);
            return prepared.result;
        })
    };
    return {
        repository, people, readiness, operations, auditRepository, auditEntries,
        service: new CanonicalTaskService({
            repository,
            infoSSOTService: people,
            readiness,
            operationRepository: operations,
            auditRepository,
            ownerPersonId: OWNER,
            ownerAliasIds
        })
    };
}

function ownerContext() {
    return {
        principal: { type: 'person', id: OWNER }, authSource: 'bearer',
        access: { role: 'ceo', projectCodes: ['brainbase'], clearance: ['internal'], personId: OWNER }
    };
}

describe('CanonicalTaskService', () => {
    let fixture;
    beforeEach(() => { fixture = setup(); });

    it('lists only the configured owner tasks with exact metadata', async () => {
        const page = await fixture.service.listTasks({}, ownerContext());
        expect(fixture.repository.list).toHaveBeenCalledWith(expect.objectContaining({ assigneePersonId: OWNER }));
        expect(page).toMatchObject({ total_count: 1, count_status: 'exact', read_status: 'complete', warnings: [] });
    });

    it('preserves non-exact repository read metadata instead of claiming a complete result', async () => {
        fixture.repository.list.mockResolvedValue({
            items: [task()],
            totalCount: null,
            countStatus: 'unknown',
            readStatus: 'partial',
            nextCursor: null
        });

        await expect(fixture.service.listTasks({}, ownerContext())).resolves.toMatchObject({
            count_status: 'unknown',
            read_status: 'partial'
        });
    });

    it('normalizes an owner alias and rejects an unrelated person principal', async () => {
        fixture = setup({ ownerAliasIds: ['legacy_owner'] });
        const aliasContext = {
            ...ownerContext(),
            principal: { type: 'person', id: 'legacy_owner' },
            access: { ...ownerContext().access, personId: 'legacy_owner' }
        };

        await fixture.service.listTasks({}, aliasContext);
        expect(fixture.repository.list).toHaveBeenCalledWith(expect.objectContaining({ assigneePersonId: OWNER }));

        const unrelatedContext = {
            ...ownerContext(),
            principal: { type: 'person', id: 'person_other' },
            access: { ...ownerContext().access, personId: 'person_other' }
        };
        await expect(fixture.service.listTasks({}, unrelatedContext))
            .rejects.toMatchObject({ code: 'personal_kg_owner_required', status: 403 });
    });

    it('creates once with a server-side actor namespace', async () => {
        const first = await fixture.service.createTask({ title: '確認する', priority: 'high' }, { ...ownerContext(), idempotencyKey: 'request-1' });
        expect(first.id).toBe('task_1');
        expect(fixture.readiness.assertMutationReady).toHaveBeenCalled();
        expect(fixture.repository.create).toHaveBeenCalledWith(expect.objectContaining({
            assignee_person_id: OWNER,
            idempotency_key: expect.stringMatching(/^api:v1\..+:request-1$/)
        }));
    });

    it('audits create, update, transition, and delete with actor and changes', async () => {
        await fixture.service.createTask(
            { title: '監査対象', priority: 'high', source_refs: [{ type: 'manual', id: 'source-1' }] },
            { ...ownerContext(), idempotencyKey: 'audit-create' }
        );
        await fixture.service.updateTask(
            'task_1',
            { expected_version: 1, title: '変更後', due_at: '2026-07-20T09:00:00+09:00' },
            ownerContext()
        );
        await fixture.service.transitionTask(
            'task_1',
            { expected_version: 1, to_status: 'waiting', waiting_on: '先方回答', review_at: '2026-07-21T09:00:00+09:00' },
            ownerContext()
        );
        await fixture.service.deleteTask(
            'task_1',
            { expected_version: 1 },
            { ...ownerContext(), idempotencyKey: 'audit-delete' }
        );

        expect([...fixture.auditEntries.values()]).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: 'canonical_task.created',
                target_id: 'task_1',
                actor_id: OWNER,
                actor_type: 'person',
                auth_source: 'bearer',
                created_at: '2026-07-14T01:00:00.000Z',
                changes: expect.objectContaining({
                    before: null,
                    after: expect.objectContaining({ title: '監査対象', version: 1 })
                }),
                source_refs: [{ type: 'manual', id: 'source-1' }]
            }),
            expect.objectContaining({
                action: 'canonical_task.updated',
                actor_id: OWNER,
                changes: expect.objectContaining({
                    before: { version: 1 },
                    after: expect.objectContaining({ version: 2 }),
                    fields: expect.objectContaining({ title: '変更後', due_at: '2026-07-20T00:00:00.000Z' })
                })
            }),
            expect.objectContaining({
                action: 'canonical_task.transitioned',
                actor_id: OWNER,
                changes: expect.objectContaining({
                    before: { version: 1 },
                    after: expect.objectContaining({ status: 'waiting', version: 2 }),
                    transition: expect.objectContaining({ to_status: 'waiting', waiting_on: '先方回答' })
                })
            }),
            expect.objectContaining({
                action: 'canonical_task.deleted',
                actor_id: OWNER,
                auth_source: 'bearer',
                changes: { before: { task_id: 'task_1', version: 1 }, after: null }
            })
        ]));
    });

    it('upserts the same create audit id when an idempotent request is retried', async () => {
        const completed = new Map();
        fixture.operations.execute.mockImplementation(async (input) => {
            const existing = completed.get(`${input.scope}:${input.operationKey}`);
            if (existing) return existing;
            const result = await input.run();
            completed.set(`${input.scope}:${input.operationKey}`, result);
            return result;
        });
        const context = { ...ownerContext(), idempotencyKey: 'audit-retry' };

        await fixture.service.createTask({ title: '再送監査' }, context);
        await fixture.service.createTask({ title: '再送監査' }, context);

        expect(fixture.repository.create).toHaveBeenCalledTimes(1);
        expect(fixture.auditRepository.upsertAuditLog).toHaveBeenCalledTimes(2);
        const auditIds = fixture.auditRepository.upsertAuditLog.mock.calls.map(([entry]) => entry.id);
        expect(new Set(auditIds)).toHaveLength(1);
        expect(fixture.auditEntries).toHaveLength(1);
    });

    it('materializes a Mana capture with an actor-scoped stable command key', async () => {
        await fixture.service.createManaCapture({
            capture_id: 'capture-1',
            title: 'オンボーディング整理',
            content: '顧客オンボーディングの詰まりを整理する',
            type: 'task',
            project: 'brainbase'
        }, { ...ownerContext(), authSource: 'session' });

        expect(fixture.repository.create).toHaveBeenCalledWith(expect.objectContaining({
            status: 'pending',
            assignee_person_id: OWNER,
            idempotency_key: expect.stringMatching(/^mana:v1\..+:capture-1$/),
            source_refs: [{
                type: 'mana_capture',
                capture_id: 'capture-1',
                capture_type: 'task',
                project: 'brainbase',
                content: '顧客オンボーディングの詰まりを整理する'
            }]
        }));
    });

    it('rejects a Mana capture without a stable capture id before writing', async () => {
        await expect(fixture.service.createManaCapture({ title: '確認する', content: '確認する' }, {
            ...ownerContext(), authSource: 'session'
        })).rejects.toMatchObject({ code: 'validation_failed', status: 422 });
        expect(fixture.repository.create).not.toHaveBeenCalled();
    });

    it('does not let another session actor replay the owner Mana capture namespace', async () => {
        const context = {
            ...ownerContext(),
            principal: { type: 'person', id: 'person_other' },
            authSource: 'session',
            access: { ...ownerContext().access, personId: 'person_other' }
        };

        await expect(fixture.service.createManaCapture({
            capture_id: 'capture-1',
            title: '別actorのcapture',
            content: '同じcapture IDを使う'
        }, context)).rejects.toMatchObject({ code: 'personal_kg_owner_required', status: 403 });
        expect(fixture.operations.execute).not.toHaveBeenCalled();
        expect(fixture.repository.create).not.toHaveBeenCalled();
    });

    it('rejects a different assignee for owner credentials', async () => {
        await expect(fixture.service.createTask({ title: '別担当', assignee_person_id: 'person_other' }, { ...ownerContext(), idempotencyKey: 'request-2' }))
            .rejects.toMatchObject({ code: 'forbidden_assignee', status: 403 });
        expect(fixture.repository.create).not.toHaveBeenCalled();
    });

    it('resolves an exact Graph payload person_id when the entity id differs', async () => {
        fixture.people.listGraphEntities.mockImplementation(async (_access, query) => {
            if (query.id) return [];
            return [{
                entity_id: 'per_01KGYC7NNS0VXADK7NP48W4VR5',
                entity_type: 'person',
                payload: { person_id: OWNER, display_name: '佐藤 圭吾' }
            }];
        });

        await fixture.service.createTask(
            { title: 'Graph payload person_idで担当者を確定する' },
            { ...ownerContext(), idempotencyKey: 'payload-person-id' }
        );

        expect(fixture.people.listGraphEntities).toHaveBeenNthCalledWith(1, ownerContext().access, {
            id: OWNER, entityType: 'person', projectCode: 'brainbase', limit: 1
        });
        expect(fixture.people.listGraphEntities).toHaveBeenNthCalledWith(2, ownerContext().access, {
            query: OWNER, entityType: 'person', projectCode: 'brainbase', limit: 10
        });
        expect(fixture.repository.create).toHaveBeenCalledWith(expect.objectContaining({
            assignee_person_id: OWNER,
            assignee_display_name: '佐藤 圭吾'
        }));
    });

    it('returns current task on version conflict', async () => {
        fixture.repository.get.mockResolvedValue(task({ version: 3 }));
        await expect(fixture.service.updateTask('task_1', { expected_version: 2, title: '変更' }, ownerContext()))
            .rejects.toMatchObject({ code: 'version_conflict', status: 409, currentTask: expect.objectContaining({ version: 3 }) });
    });

    it('fingerprints normalized PATCH input, transition input, and actor identity', async () => {
        await fixture.service.updateTask('task_1', { expected_version: 1, title: '変更A' }, ownerContext());
        await fixture.service.updateTask('task_1', { expected_version: 1, title: '変更B' }, ownerContext());
        await fixture.service.transitionTask('task_1', {
            expected_version: 1,
            to_status: 'waiting',
            waiting_on: '先方A'
        }, ownerContext());
        await fixture.service.transitionTask('task_1', {
            expected_version: 1,
            to_status: 'waiting',
            waiting_on: '先方B'
        }, ownerContext());
        await fixture.service.updateTask('task_1', { expected_version: 1, title: '変更A' }, {
            principal: { type: 'service', id: 'service-other' },
            authSource: 'service-token',
            access: ownerContext().access
        });

        const fingerprints = fixture.operations.execute.mock.calls.map(([input]) => input.fingerprint);
        expect(fingerprints[0]).not.toBe(fingerprints[1]);
        expect(fingerprints[2]).not.toBe(fingerprints[3]);
        expect(fingerprints[0]).not.toBe(fingerprints[4]);
    });

    it('returns 409 instead of replaying another PATCH for the same Task version', async () => {
        const operations = new Map();
        fixture.operations.execute.mockImplementation(async (input) => {
            const existing = operations.get(input.operationKey);
            if (existing) {
                if (existing.fingerprint !== input.fingerprint) {
                    throw new CanonicalTaskError(
                        'idempotency_conflict',
                        'Idempotency key was reused with different input',
                        409
                    );
                }
                return existing.result;
            }
            const result = await input.run();
            operations.set(input.operationKey, { fingerprint: input.fingerprint, result });
            return result;
        });

        await fixture.service.updateTask('task_1', { expected_version: 1, title: '変更A' }, ownerContext());
        await expect(fixture.service.updateTask(
            'task_1',
            { expected_version: 1, title: '変更B' },
            ownerContext()
        )).rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
        expect(fixture.repository.update).toHaveBeenCalledTimes(1);
    });

    it('recovers an already-applied PATCH after restart without writing NocoDB again', async () => {
        fixture.operations.execute.mockResolvedValueOnce(task());
        await fixture.service.updateTask('task_1', { expected_version: 1, title: '適用済み' }, ownerContext());
        const operation = fixture.operations.execute.mock.calls[0][0];

        fixture.repository.update.mockClear();
        fixture.repository.get.mockResolvedValue(task({
            version: 2,
            title: '適用済み',
            _last_operation_key: operation.operationKey,
            _last_operation_fingerprint: operation.fingerprint
        }));
        fixture.operations.execute.mockImplementationOnce(async ({ recover, run }) => {
            const recovered = await recover();
            return recovered.recovered ? recovered.result : run();
        });

        await expect(fixture.service.updateTask(
            'task_1',
            { expected_version: 1, title: '適用済み' },
            ownerContext()
        )).resolves.toMatchObject({ version: 2, title: '適用済み' });
        expect(fixture.repository.update).not.toHaveBeenCalled();
    });

    it('requires waiting_on and seals completed tasks', async () => {
        await expect(fixture.service.transitionTask('task_1', { expected_version: 1, to_status: 'waiting' }, ownerContext()))
            .rejects.toMatchObject({ code: 'validation_failed', status: 422 });
        fixture.repository.get.mockResolvedValue(task({ status: 'completed' }));
        await expect(fixture.service.transitionTask('task_1', { expected_version: 1, to_status: 'in_progress' }, ownerContext()))
            .rejects.toMatchObject({ code: 'invalid_transition', status: 409 });
    });

    it('keeps Task store failures explicit', async () => {
        fixture.repository.list.mockRejectedValue(new Error('network'));
        await expect(fixture.service.listTasks({}, ownerContext()))
            .rejects.toEqual(expect.objectContaining({ code: 'task_store_unavailable', status: 503 }));
    });

    it('prepares an actor-scoped delete intent before removing the Task', async () => {
        const context = { ...ownerContext(), authSource: 'bearer', idempotencyKey: 'delete-1' };

        const result = await fixture.service.deleteTask('task_1', { expected_version: 1 }, context);

        expect(fixture.operations.executePreparedDelete).toHaveBeenCalledWith(expect.objectContaining({
            operationKey: expect.stringMatching(/^delete:v1\..+:delete-1$/),
            versionClaimKey: 'task-version:task_1:1',
            principalNamespace: expect.stringMatching(/^v1\./)
        }));
        expect(fixture.repository.delete).toHaveBeenCalledWith('task_1');
        expect(result).toEqual({ task_id: 'task_1', deleted: true, version: 2 });
    });

    it('materializes approved workflow candidates and applies only declared edits', async () => {
        fixture.repository.create
            .mockResolvedValueOnce(task({ id: 'task_approved', title: '修正後タイトル', priority: 'high' }));

        const result = await fixture.service.materializeWorkflowApproval({
            step: { id: 'human_1', workflow_run_id: 'run_1', project_id: 'brainbase' },
            output: {
                id: 'out_1',
                payload: [
                    { id: 'candidate-a', title: '元タイトル', selected_owner_id: OWNER, priority: 'medium' },
                    { id: 'candidate-b', title: '除外する', selected_owner_id: OWNER }
                ]
            },
            responseRef: {
                decision_mode: 'approveWithEdits',
                review_items: [
                    {
                        candidate_id: 'out_1_item_1',
                        resolution: 'approved',
                        title: '修正後タイトル',
                        priority: 'high',
                        edited_fields: ['title', 'priority']
                    },
                    {
                        candidate_id: 'out_1_item_2',
                        resolution: 'rejected',
                        edited_fields: []
                    }
                ]
            },
            actor: { person_id: OWNER, projectCodes: ['brainbase'], role: 'admin', authSource: 'test' }
        });

        expect(fixture.repository.create).toHaveBeenCalledTimes(1);
        expect(fixture.repository.create).toHaveBeenCalledWith(expect.objectContaining({
            title: '修正後タイトル',
            priority: 'high',
            assignee_person_id: OWNER,
            idempotency_key: expect.stringMatching(/^workflow:out_1:/)
        }));
        expect(result).toMatchObject({
            status: 'completed',
            task_ids: ['task_approved'],
            excluded_candidates: [expect.objectContaining({ candidate_id: 'candidate-b', resolution: 'rejected' })],
            replayed: false
        });
        expect([...fixture.auditEntries.values()]).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: 'canonical_task.created',
                actor_id: OWNER,
                actor_type: 'person',
                auth_source: 'test',
                source_refs: expect.arrayContaining([
                    expect.objectContaining({ type: 'workflow_output', output_id: 'out_1' }),
                    expect.objectContaining({ type: 'workflow_human_step', step_id: 'human_1' })
                ])
            })
        ]));
    });

    it('rejects unresolved assignees before writing any workflow Task', async () => {
        await expect(fixture.service.materializeWorkflowApproval({
            step: { id: 'human_1', workflow_run_id: 'run_1', project_id: 'brainbase' },
            output: { id: 'out_1', payload: [{ title: '担当者未確定' }] },
            responseRef: null,
            actor: { person_id: OWNER, projectCodes: ['brainbase'], role: 'admin', authSource: 'test' }
        })).rejects.toMatchObject({ code: 'unresolved_task_assignee', status: 409 });

        expect(fixture.repository.create).not.toHaveBeenCalled();
    });
});
