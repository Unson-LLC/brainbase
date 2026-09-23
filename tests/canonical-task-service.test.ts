import { describe, expect, it } from 'vitest';
import { CanonicalTaskError, CanonicalTaskService } from '../src/canonical-task-service.js';
import { createCanonicalTaskServiceFixture } from './fixtures/canonical-task-service.js';

describe('CanonicalTaskService', () => {
  it('keeps task behavior policy-neutral and uses injected repository, audit, clock, and base URL', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const created = await fixture.service.createTask({
      title: '  Prepare consumer contract  ',
      priority: 'high',
      project_codes: ['shared, public'],
      source_refs: [{ type: 'issue', id: '42' }],
    }, fixture.context('create-1'));

    expect(created).toMatchObject({
      id: 'task-1',
      title: 'Prepare consumer contract',
      status: 'pending',
      priority: 'high',
      project_codes: ['shared', 'public'],
      web_url: 'https://consumer.example.test/api/tasks/task-1',
    });
    expect(created).not.toHaveProperty('_payload_fingerprint');
    expect(fixture.auditEntries[0]).toMatchObject({
      action: 'canonical_task.created',
      target_type: 'canonical_task',
      target_id: 'task-1',
      actor: { type: 'person', id: 'consumer-user' },
      actor_id: 'consumer-user',
      actor_type: 'person',
      actor_principal: { type: 'person', id: 'consumer-user' },
    });
    expect(fixture.auditEntries[0]).not.toHaveProperty('project_id');

    const list = await fixture.service.listTasks({ statuses: 'pending' }, fixture.context());
    const search = await fixture.service.searchTasks({ q: 'contract' }, fixture.context());
    const read = await fixture.service.getTask('task-1', fixture.context());
    expect(list.items).toHaveLength(1);
    expect(search.items.map((task) => task.id)).toEqual(['task-1']);
    expect(read.id).toBe('task-1');
    expect(fixture.actions).toEqual(['create', 'list', 'search', 'read']);
  });

  it('replays the same idempotent create and rejects a changed payload', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const first = await fixture.service.createTask({ title: 'One task' }, fixture.context('same-key'));
    const replay = await fixture.service.createTask({ title: 'One task' }, fixture.context('same-key'));
    expect(replay.id).toBe(first.id);
    expect(fixture.tasks.size).toBe(1);
    await expect(fixture.service.createTask({ title: 'Another task' }, fixture.context('same-key')))
      .rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
  });

  it('applies optimistic versioning, canonical transitions, and injected audit timestamps', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    await fixture.service.createTask({ title: 'Versioned task' }, fixture.context('create-1'));
    const started = await fixture.service.transitionTask('task-1', 'in_progress', 1, fixture.context());
    expect(started).toMatchObject({ status: 'in_progress', version: 2, updated_at: '2026-01-02T00:00:00.000Z' });
    const completed = await fixture.service.transitionTask('task-1', 'completed', 2, fixture.context());
    expect(completed).toMatchObject({ status: 'completed', version: 3, completed_at: '2026-01-02T00:00:00.000Z' });
    await expect(fixture.service.updateTask('task-1', { title: 'Stale' }, 2, fixture.context()))
      .rejects.toMatchObject({ code: 'version_conflict', status: 409 });
    await expect(fixture.service.transitionTask('task-1', 'pending', 3, fixture.context()))
      .rejects.toMatchObject({ code: 'invalid_transition', status: 409 });
  });

  it('accepts the existing body-shaped mutation calls used by HTTP consumers', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    await fixture.service.createTask({ title: 'HTTP task' }, fixture.context('create-1'));
    const updated = await fixture.service.updateTask('task-1', {
      expected_version: 1,
      title: 'HTTP task updated',
    }, fixture.context());
    expect(updated).toMatchObject({ title: 'HTTP task updated', version: 2 });
    const completed = await fixture.service.transitionTask('task-1', {
      expected_version: 2,
      to_status: 'completed',
    }, fixture.context());
    expect(completed).toMatchObject({ status: 'completed', version: 3 });
    await expect(fixture.service.deleteTask('task-1', { expected_version: 3 }, fixture.context('delete-1')))
      .resolves.toMatchObject({ task_id: 'task-1', deleted: true, version: 4 });
  });

  it('lets injected policy own authorization and tenant/scoping decisions', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const deniedService = new CanonicalTaskService({
      repository: fixture.repository,
      policy: {
        authorize({ action }) {
          if (action === 'list') throw new CanonicalTaskError('forbidden', 'Denied by policy', 403);
        },
        scopeFilters({ filters }) {
          return { ...filters, projectCodes: ['tenant-visible'] };
        },
      },
    });
    await expect(deniedService.listTasks({}, fixture.context())).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });

  it('delegates operation coordination without coupling the kernel to a persistence implementation', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const operations: Array<{ scope: string; operationKey: string; fingerprint: string }> = [];
    const service = new CanonicalTaskService({
      repository: fixture.repository,
      policy: { authorize() {} },
      operationRepository: {
        async execute(request) {
          operations.push({
            scope: request.scope,
            operationKey: request.operationKey,
            fingerprint: request.fingerprint,
          });
          return request.run();
        },
      },
    });

    await service.createTask({ title: 'Coordinated task' }, fixture.context('operation-1'));

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      scope: 'canonical_task',
      operationKey: expect.stringContaining('api:v1.'),
    });
    expect(operations[0].fingerprint).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('wraps repository failures as a stable public error', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const failingService = new CanonicalTaskService({
      repository: {
        ...fixture.repository,
        async list() {
          throw new Error('database detail');
        },
      },
    });
    await expect(failingService.listTasks({}, fixture.context())).rejects.toMatchObject({
      code: 'task_store_unavailable',
      status: 503,
      message: 'Task store is unavailable',
    });
  });

  it('does not expose audit failure details', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const failingService = new CanonicalTaskService({
      repository: fixture.repository,
      auditRepository: {
        async upsertAuditLog() {
          throw new Error('database audit detail');
        },
      },
    });
    await expect(failingService.createTask({ title: 'Audited task' }, fixture.context('audit-1')))
      .rejects.toMatchObject({
        code: 'task_audit_unavailable',
        status: 503,
        message: 'Task audit is unavailable',
        details: {},
      });
  });
});
