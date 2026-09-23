import { describe, expect, it } from 'vitest';
import {
  CanonicalTaskError,
  CanonicalTaskService,
  type CanonicalTaskOperationRepository,
  type CanonicalTaskOperationRequest,
  type CanonicalTaskPage,
  type CanonicalTaskRecord,
} from '../src/canonical-task-service.js';
import { createCanonicalTaskServiceFixture } from './fixtures/canonical-task-service.js';

const taskContext = (idempotencyKey?: string) => ({
  principal: { type: 'person' as const, id: 'consumer-user' },
  authSource: 'bearer',
  ...(idempotencyKey ? { idempotencyKey } : {}),
});

describe('CanonicalTaskService parity contracts', () => {
  it('preserves incomplete search counts, validates the bounded query, and fails closed without search', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    fixture.repository.search = async (): Promise<CanonicalTaskPage> => ({
      items: [],
      totalCount: null,
      countStatus: 'not_requested',
      readStatus: 'complete',
    });

    await expect(fixture.service.searchTasks({ query: '  contract  ' }, taskContext())).resolves.toMatchObject({
      totalCount: null,
      total_count: null,
      countStatus: 'not_requested',
      count_status: 'not_requested',
    });
    await expect(fixture.service.searchTasks({}, taskContext())).rejects.toMatchObject({
      code: 'validation_failed',
      status: 422,
      fieldErrors: { query: ['required'] },
    });
    await expect(fixture.service.searchTasks({ query: 'contract', limit: 21 }, taskContext())).rejects.toMatchObject({
      code: 'validation_failed',
      status: 422,
      fieldErrors: { limit: ['must_be_between_1_and_20'] },
    });

    const missingSearchRepository = { ...fixture.repository } as typeof fixture.repository & { search?: unknown };
    delete missingSearchRepository.search;
    const missingSearchService = new CanonicalTaskService({ repository: missingSearchRepository });
    await expect(missingSearchService.searchTasks({ query: 'contract' }, taskContext())).rejects.toMatchObject({
      code: 'task_search_unavailable',
      status: 503,
    });
  });

  it('projects operation results, recovers persisted creates, and retries audit with one deterministic id', async () => {
    const requests: Array<CanonicalTaskOperationRequest<CanonicalTaskRecord>> = [];
    const claimed = new Set<string>();
    const operationRepository: CanonicalTaskOperationRepository = {
      async execute<T>(request: CanonicalTaskOperationRequest<T>): Promise<T> {
        requests.push(request as CanonicalTaskOperationRequest<CanonicalTaskRecord>);
        if (!claimed.has(request.operationKey)) {
          claimed.add(request.operationKey);
          return request.run();
        }
        const recovered = await request.recover?.();
        return recovered?.recovered ? recovered.result as T : request.run();
      },
    };
    const fixture = createCanonicalTaskServiceFixture({ operationRepository });
    const context = taskContext('create-recovery');

    const first = await fixture.service.createTask({ title: 'Recoverable task' }, context);
    const replay = await fixture.service.createTask({ title: 'Recoverable task' }, context);

    expect(replay).toMatchObject({ id: first.id, version: 1 });
    expect(fixture.tasks).toHaveLength(1);
    expect(requests[0].projectResult?.({ id: 'task-1', version: 1 } as CanonicalTaskRecord))
      .toEqual({ task_id: 'task-1', task_version: 1 });
    expect(fixture.auditCalls).toHaveLength(2);
    expect(fixture.auditEntries).toHaveLength(1);
    expect(fixture.auditCalls[0].id).toBe(fixture.auditCalls[1].id);
    expect(fixture.auditEntries[0]).toMatchObject({
      action: 'canonical_task.created',
      actor_id: 'consumer-user',
      actor_type: 'person',
      actor_principal: { type: 'person', id: 'consumer-user' },
      actor_namespace: expect.stringMatching(/^v1\./u),
      auth_source: 'bearer',
      changes: {
        before: null,
        after: expect.objectContaining({ id: 'task-1', version: 1 }),
      },
    });
  });

  it('uses the audit envelope for every mutation and keeps IDs tied to operation identity', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const context = (idempotencyKey?: string) => ({
      ...taskContext(idempotencyKey),
      auditPrincipal: { type: 'person' as const, id: 'audited-user' },
      auditAuthSource: 'workflow-human-step',
    });

    await fixture.service.createTask({
      title: 'Audited task',
      source_refs: [{ type: 'manual', id: 'source-1' }],
    }, context('audit-create'));
    await fixture.service.updateTask('task-1', {
      title: 'Audited task updated',
      due_at: '2026-07-20T09:00:00+09:00',
    }, 1, context());
    await fixture.service.transitionTask('task-1', {
      to_status: 'waiting',
      expected_version: 2,
      waiting_on: 'external response',
      review_at: '2026-07-21T09:00:00+09:00',
    }, context());
    await fixture.service.deleteTask('task-1', { expected_version: 3 }, context('audit-delete'));

    const entries = new Map(fixture.auditEntries.map((entry) => [entry.action, entry]));
    expect(entries.get('canonical_task.created')).toMatchObject({
      actor_id: 'audited-user',
      actor_type: 'person',
      actor_principal: { type: 'person', id: 'audited-user' },
      auth_source: 'workflow-human-step',
      changes: {
        before: null,
        after: expect.objectContaining({ title: 'Audited task', version: 1 }),
      },
      source_refs: [{ type: 'manual', id: 'source-1' }],
    });
    expect(entries.get('canonical_task.updated')).toMatchObject({
      changes: {
        before: { version: 1 },
        after: { version: 2 },
        fields: { title: 'Audited task updated', due_at: '2026-07-20T00:00:00.000Z' },
      },
    });
    expect(entries.get('canonical_task.transitioned')).toMatchObject({
      changes: {
        before: { version: 2 },
        after: { status: 'waiting', version: 3 },
        transition: {
          to_status: 'waiting',
          waiting_on: 'external response',
          review_at: '2026-07-21T00:00:00.000Z',
        },
      },
    });
    expect(entries.get('canonical_task.deleted')).toMatchObject({
      changes: { before: { task_id: 'task-1', version: 3 }, after: null },
    });
    expect(fixture.auditEntries.map((entry) => entry.id)).toEqual([
      expect.stringMatching(/^canonical-task:[a-f0-9]{64}$/u),
      expect.stringMatching(/^canonical-task:[a-f0-9]{64}$/u),
      expect.stringMatching(/^canonical-task:[a-f0-9]{64}$/u),
      expect.stringMatching(/^canonical-task:[a-f0-9]{64}$/u),
    ]);
  });

  it('recovers an applied versioned mutation and sends the prepared delete claim with actor evidence', async () => {
    const requests: Array<CanonicalTaskOperationRequest<CanonicalTaskRecord>> = [];
    const claimed = new Set<string>();
    const preparedDeletes: Array<Record<string, unknown>> = [];
    let completedDelete: { task_id: string; deleted: true; version: number } | undefined;
    let removeCalls = 0;
    const operationRepository: CanonicalTaskOperationRepository = {
      async execute<T>(request: CanonicalTaskOperationRequest<T>): Promise<T> {
        requests.push(request as CanonicalTaskOperationRequest<CanonicalTaskRecord>);
        if (!claimed.has(request.operationKey)) {
          claimed.add(request.operationKey);
          return request.run();
        }
        const recovered = await request.recover?.();
        return recovered?.recovered ? recovered.result as T : request.run();
      },
      async executePreparedDelete<T>(request) {
        preparedDeletes.push(request as unknown as Record<string, unknown>);
        if (completedDelete) return completedDelete as T;
        const prepared = await request.prepare();
        const current = await request.findTask();
        if (current) {
          removeCalls += 1;
          await request.removeTask(current);
        }
        completedDelete = prepared.result as typeof completedDelete;
        return prepared.result;
      },
    };
    const fixture = createCanonicalTaskServiceFixture({ operationRepository });
    const sourceRefs = [{ type: 'manual', id: 'delete-source' }];
    await fixture.service.createTask({ title: 'Versioned task', source_refs: sourceRefs }, taskContext('seed'));

    let updateCalls = 0;
    const update = fixture.repository.update.bind(fixture.repository);
    fixture.repository.update = async (taskId, patch) => {
      updateCalls += 1;
      return update(taskId, patch);
    };

    const first = await fixture.service.updateTask('task-1', { title: 'Applied once' }, 1, taskContext());
    const replay = await fixture.service.updateTask('task-1', { title: 'Applied once' }, 1, taskContext());

    expect(first).toMatchObject({ version: 2, title: 'Applied once' });
    expect(replay).toMatchObject({ version: 2, title: 'Applied once' });
    expect(updateCalls).toBe(1);

    const deleted = await fixture.service.deleteTask('task-1', { expected_version: 2 }, taskContext('delete-1'));
    expect(deleted).toEqual({ task_id: 'task-1', deleted: true, version: 3 });
    expect(deleted).not.toHaveProperty('_audit_source_refs');
    expect(preparedDeletes[0]).toMatchObject({
      operationKey: expect.stringMatching(/^delete:v1\..+:delete-1$/u),
      versionClaimKey: 'task-version:task-1:2',
      principalNamespace: expect.stringMatching(/^v1\./u),
      versionFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(preparedDeletes[0].prepare).toBeTypeOf('function');
    expect(fixture.tasks).toHaveLength(0);

    const deleteReplay = await fixture.service.deleteTask('task-1', { expected_version: 2 }, taskContext('delete-1'));
    expect(deleteReplay).toEqual(deleted);
    expect(deleteReplay).not.toHaveProperty('_audit_source_refs');
    expect(removeCalls).toBe(1);
    expect(preparedDeletes).toHaveLength(2);
    const deleteAuditCalls = fixture.auditCalls.filter((entry) => entry.action === 'canonical_task.deleted');
    expect(deleteAuditCalls).toHaveLength(2);
    expect(deleteAuditCalls[0].source_refs).toEqual(sourceRefs);
    expect(deleteAuditCalls[1].source_refs).toEqual(sourceRefs);
    expect(fixture.auditEntries.filter((entry) => entry.action === 'canonical_task.deleted')).toHaveLength(1);
    expect(fixture.auditEntries.find((entry) => entry.action === 'canonical_task.deleted')?.source_refs)
      .toEqual(sourceRefs);
  });

  it('rechecks delete authorization immediately before removing a prepared task', async () => {
    let deleteAuthorizations = 0;
    let deleteCalls = 0;
    const fixture = createCanonicalTaskServiceFixture();
    const operationRepository: CanonicalTaskOperationRepository = {
      async execute<T>(request: CanonicalTaskOperationRequest<T>): Promise<T> {
        return request.run();
      },
      async executePreparedDelete<T>(request): Promise<T> {
        const prepared = await request.prepare();
        const current = await request.findTask();
        if (current) await request.removeTask(current);
        return prepared.result;
      },
    };
    const service = new CanonicalTaskService({
      repository: fixture.repository,
      auditRepository: fixture.auditRepository,
      operationRepository,
      policy: {
        authorize({ action }) {
          if (action !== 'delete') return;
          deleteAuthorizations += 1;
          if (deleteAuthorizations > 1) {
            throw new CanonicalTaskError('forbidden', 'Delete authorization was revoked', 403);
          }
        },
      },
      clock: () => new Date('2026-01-02T00:00:00.000Z'),
      baseUrl: 'https://consumer.example.test',
    });
    const repositoryDelete = fixture.repository.delete.bind(fixture.repository);
    fixture.repository.delete = async (taskId, expectedVersion) => {
      deleteCalls += 1;
      return repositoryDelete(taskId, expectedVersion);
    };

    await service.createTask({ title: 'Revocable delete' }, taskContext('seed'));

    await expect(service.deleteTask('task-1', { expected_version: 1 }, taskContext('delete-1')))
      .rejects.toMatchObject({ code: 'forbidden', status: 403 });
    expect(deleteAuthorizations).toBe(2);
    expect(deleteCalls).toBe(0);
    expect(fixture.tasks).toHaveLength(1);
  });

  it('preserves completed_at when an ordinary update follows a completed transition', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    await fixture.service.createTask({ title: 'Completed task' }, taskContext('create-1'));
    await fixture.service.transitionTask('task-1', 'completed', 1, taskContext());

    const updated = await fixture.service.updateTask('task-1', { title: 'Completed task renamed' }, 2, taskContext());

    expect(updated).toMatchObject({
      title: 'Completed task renamed',
      status: 'completed',
      version: 3,
      completed_at: '2026-01-02T00:00:00.000Z',
    });
    expect(fixture.tasks.get('task-1')).toMatchObject({
      version: 3,
      completed_at: '2026-01-02T00:00:00.000Z',
    });
  });

  it('requires waiting details and explicitly clears completed_at on non-completed transitions', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    await fixture.service.createTask({ title: 'Transition task' }, taskContext('transition-create'));

    await expect(fixture.service.transitionTask('task-1', 'waiting', 1, taskContext()))
      .rejects.toMatchObject({
        code: 'validation_failed',
        status: 422,
        fieldErrors: { waiting_on: ['required_for_waiting'] },
      });
    await fixture.service.transitionTask('task-1', 'cancelled', 1, taskContext());
    const stored = fixture.tasks.get('task-1');
    expect(stored).toMatchObject({ status: 'cancelled', completed_at: null, version: 2 });
  });

  it('preserves the backend selection error and reports malformed project codes as field validation', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const backendError = Object.assign(new Error('backend is not configured'), {
      code: 'canonical_task_backend_not_configured',
    });
    const failingService = new CanonicalTaskService({
      repository: {
        ...fixture.repository,
        async get() {
          throw backendError;
        },
      },
    });

    await expect(failingService.getTask('task-1', taskContext())).rejects.toMatchObject({
      code: 'canonical_task_backend_not_configured',
      status: 503,
    });
    await expect(fixture.service.createTask({ title: 'Malformed project', project_codes: [42] }, taskContext('bad-project')))
      .rejects.toMatchObject({
        code: 'validation_failed',
        status: 422,
        fieldErrors: { project_codes: ['invalid_project_code'] },
      });
  });
});
