import { describe, expect, it, vi } from 'vitest';
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

  it('keeps line breaks and tabs in the description but rejects other control characters', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const created = await fixture.service.createTask({
      title: 'Multi-line purpose',
      description: '目的\r\n\n完了条件:\t確認済み  ',
    }, fixture.context('multiline-create'));
    expect(created.description).toBe('目的\n\n完了条件:\t確認済み');

    const updated = await fixture.service.updateTask(created.id, { description: '1行目\n2行目' }, created.version, fixture.context());
    expect(updated.description).toBe('1行目\n2行目');

    await expect(fixture.service.createTask({ title: 'Bell', description: 'ring\u0007' }, fixture.context('bell')))
      .rejects.toMatchObject({ code: 'validation_error', status: 400 });
    await expect(fixture.service.createTask({ title: 'Line\nbreak' }, fixture.context('title-newline')))
      .rejects.toMatchObject({ code: 'validation_error', status: 400 });
  });

  it('keeps one short single-line purpose label per task, and clears it when empty', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const unlabelled = await fixture.service.createTask({ title: 'No label yet' }, fixture.context('label-none'));
    expect(unlabelled.purpose_label).toBeNull();
    // An unlabelled create does not write the field at all, so a store without the column keeps working.
    expect(fixture.tasks.get(unlabelled.id)).not.toHaveProperty('purpose_label');

    const labelled = await fixture.service.createTask({ title: 'Review campaign', purpose_label: '  口コミ  ' }, fixture.context('label-create'));
    expect(labelled.purpose_label).toBe('口コミ');
    const relabelled = await fixture.service.updateTask(labelled.id, { purpose_label: 'Googleマップ強化' }, labelled.version, fixture.context());
    expect(relabelled.purpose_label).toBe('Googleマップ強化');
    const cleared = await fixture.service.updateTask(labelled.id, { purpose_label: '' }, relabelled.version, fixture.context());
    expect(cleared.purpose_label).toBeNull();

    await expect(fixture.service.createTask({ title: 'Too long', purpose_label: 'あ'.repeat(31) }, fixture.context('label-long')))
      .rejects.toMatchObject({ code: 'validation_error', status: 400 });
    await expect(fixture.service.updateTask(labelled.id, { purpose_label: '口コミ\n清掃' }, cleared.version, fixture.context()))
      .rejects.toMatchObject({ code: 'validation_error', status: 400 });
  });

  it('records who a waiting task waits on as a person, beside the free-text condition', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const created = await fixture.service.createTask({ title: 'Needs a review' }, fixture.context('waiting-person'));
    expect(created.waiting_on_person_id).toBeNull();
    // A create without the person does not write the field, so a store without the column keeps working.
    expect(fixture.tasks.get(created.id)).not.toHaveProperty('waiting_on_person_id');

    const waiting = await fixture.service.transitionTask(created.id, {
      expected_version: created.version,
      to_status: 'waiting',
      waiting_on: '佐藤さんの承認',
      waiting_on_person_id: '  per_keigo_sato  ',
    }, fixture.context());
    expect(waiting).toMatchObject({ status: 'waiting', waiting_on: '佐藤さんの承認', waiting_on_person_id: 'per_keigo_sato' });

    // Leaving the waiting state clears both what and whom it waited on.
    const resumed = await fixture.service.transitionTask(created.id, 'in_progress', waiting.version, fixture.context());
    expect(resumed).toMatchObject({ waiting_on: null, waiting_on_person_id: null });

    // The free-text condition stays required; the person alone is not enough.
    await expect(fixture.service.transitionTask(created.id, {
      expected_version: resumed.version,
      to_status: 'waiting',
      waiting_on_person_id: 'per_keigo_sato',
    }, fixture.context())).rejects.toMatchObject({ code: 'validation_failed', status: 422 });

    // Waiting on a condition rather than a person clears an earlier person.
    const conditionOnly = await fixture.service.transitionTask(created.id, 'waiting', resumed.version, fixture.context(), { waitingOn: '契約書の到着' });
    expect(conditionOnly).toMatchObject({ waiting_on: '契約書の到着', waiting_on_person_id: null });

    const reassigned = await fixture.service.updateTask(created.id, { waiting_on_person_id: 'per_reviewer' }, conditionOnly.version, fixture.context());
    expect(reassigned.waiting_on_person_id).toBe('per_reviewer');
    await expect(fixture.service.updateTask(created.id, { waiting_on_person_id: 'p'.repeat(201) }, reassigned.version, fixture.context()))
      .rejects.toMatchObject({ code: 'validation_error', status: 400 });
  });

  it('reports task normalization warnings by code instead of an unreadable object string', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const created = await fixture.service.createTask({ title: 'Legacy task' }, fixture.context('warning-create'));
    (fixture.tasks.get(created.id) as Record<string, unknown>).normalization_warnings = [
      { code: 'assignee_unresolved', message: 'Legacy assignee has no Graph person ID' },
      'legacy_warning',
    ];
    const page = await fixture.service.listTasks({}, fixture.context());
    expect(page.warnings).toEqual(['assignee_unresolved', 'legacy_warning']);
  });

  it('lists tasks with an assignee when no optional filter is given', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const assigned = await fixture.service.createTask({ title: 'Assigned', assignee_person_id: 'per_owner' }, fixture.context('assigned'));
    const unassigned = await fixture.service.createTask({ title: 'Unassigned' }, fixture.context('unassigned'));
    let seen: Record<string, unknown> = {};
    const original = fixture.repository.list.bind(fixture.repository);
    fixture.repository.list = async (filters, ...rest) => { seen = filters as Record<string, unknown>; return original(filters, ...rest); };

    for (const filters of [{}, { assigneePersonId: '' }, { assigneePersonId: null, dueAfter: '', dueBefore: null, cursor: '' }]) {
      const page = await fixture.service.listTasks(filters as never, fixture.context());
      expect(page.items.map((task) => task.id).sort()).toEqual([assigned.id, unassigned.id].sort());
      for (const key of ['assigneePersonId', 'dueAfter', 'dueBefore', 'cursor']) expect(seen).not.toHaveProperty(key);
    }

    const filtered = await fixture.service.listTasks({ assigneePersonId: 'per_owner' }, fixture.context());
    expect(filtered.items.map((task) => task.id)).toEqual([assigned.id]);
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

  it('keeps source_refs replacement compatibility and appends source_refs_append idempotently', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const existing = [
      { type: 'manual', id: 'keep' },
      { id: 'keep', type: 'manual' },
    ];
    const created = await fixture.service.createTask({ title: 'Source refs task', source_refs: existing }, fixture.context('source-create'));

    const appended = await fixture.service.updateTask(created.id, {
      source_refs_append: [
        { id: 'new', type: 'manual' },
        { type: 'manual', id: 'new' },
        { id: 'keep', type: 'manual' },
      ],
    }, created.version, fixture.context());

    expect(appended).toMatchObject({ version: 2 });
    expect(appended.source_refs).toEqual([
      existing[0],
      existing[1],
      { id: 'new', type: 'manual' },
    ]);

    const replayed = await fixture.service.updateTask(created.id, {
      source_refs_append: [
        { id: 'new', type: 'manual' },
        { type: 'manual', id: 'new' },
        { id: 'keep', type: 'manual' },
      ],
    }, created.version, fixture.context());
    expect(replayed.source_refs).toEqual(appended.source_refs);

    const replaced = await fixture.service.updateTask(created.id, {
      source_refs: [{ type: 'replacement', id: 'only' }],
    }, appended.version, fixture.context());
    expect(replaced.source_refs).toEqual([{ type: 'replacement', id: 'only' }]);
  });

  it('uses code-unit key order for Unicode source ref deduplication and append replay', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const created = await fixture.service.createTask({ title: 'Unicode source refs task' }, fixture.context('unicode-source-create'));
    const firstRef = {
      'K': { nested: { 'K': 1, K: 2 } },
      K: { nested: { 'K': 1, K: 2 } },
    };
    const reorderedRef = {
      K: { nested: { K: 2, 'K': 1 } },
      'K': { nested: { K: 2, 'K': 1 } },
    };

    const appended = await fixture.service.updateTask(created.id, {
      source_refs_append: [firstRef, reorderedRef],
    }, created.version, fixture.context());
    expect(appended.source_refs).toEqual([firstRef]);

    const replayed = await fixture.service.updateTask(created.id, {
      source_refs_append: [reorderedRef, reorderedRef],
    }, created.version, fixture.context());
    expect(replayed.source_refs).toEqual(appended.source_refs);
    expect(replayed.version).toBe(appended.version);
  });

  it('rejects invalid or ambiguous source_refs_append before mutation', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const created = await fixture.service.createTask({
      title: 'Validated source refs task',
      source_refs: [{ type: 'manual', id: 'keep' }],
    }, fixture.context('source-validation-create'));
    const before = structuredClone(fixture.tasks.get(created.id));
    const update = vi.spyOn(fixture.repository, 'update');
    const sparse: unknown[] = [];
    sparse.length = 1;
    const symbolRef = { type: 'manual' };
    Object.defineProperty(symbolRef, Symbol('hidden'), { value: 'x', enumerable: true });
    const nonEnumerableRef = { type: 'manual' };
    Object.defineProperty(nonEnumerableRef, 'hidden', { value: 'x', enumerable: false });
    const accessorRef = { type: 'manual' };
    Object.defineProperty(accessorRef, 'hidden', { get: () => 'x', enumerable: true });
    const symbolArray: unknown[] = [{ type: 'manual' }];
    Object.defineProperty(symbolArray, Symbol('hidden'), { value: 'x', enumerable: true });
    let accessorArrayReads = 0;
    const accessorArray: unknown[] = [];
    Object.defineProperty(accessorArray, 0, {
      enumerable: true,
      get: () => {
        accessorArrayReads += 1;
        return { type: 'manual' };
      },
    });
    let topLevelAccessorReads = 0;
    const topLevelAccessorInput = {} as { source_refs_append: unknown[] };
    Object.defineProperty(topLevelAccessorInput, 'source_refs_append', {
      enumerable: true,
      get: () => {
        topLevelAccessorReads += 1;
        return [{ type: 'manual' }];
      },
    });
    const deeplyNested: Record<string, unknown> = {};
    let nestedCursor = deeplyNested;
    for (let depth = 0; depth < 130; depth += 1) {
      const next: Record<string, unknown> = {};
      nestedCursor.nested = next;
      nestedCursor = next;
    }

    await expect(fixture.service.updateTask(created.id, {
      source_refs_append: [null],
    }, created.version, fixture.context())).rejects.toMatchObject({ code: 'validation_error', status: 400 });
    await expect(fixture.service.updateTask(created.id, {
      source_refs_append: [{ nested: undefined }],
    }, created.version, fixture.context())).rejects.toMatchObject({ code: 'validation_error', status: 400 });
    await expect(fixture.service.updateTask(created.id, {
      source_refs_append: sparse,
    }, created.version, fixture.context())).rejects.toMatchObject({ code: 'validation_error', status: 400 });
    await expect(fixture.service.updateTask(created.id, {
      source_refs_append: [symbolRef],
    }, created.version, fixture.context())).rejects.toMatchObject({ code: 'validation_error', status: 400 });
    await expect(fixture.service.updateTask(created.id, {
      source_refs_append: [nonEnumerableRef],
    }, created.version, fixture.context())).rejects.toMatchObject({ code: 'validation_error', status: 400 });
    await expect(fixture.service.updateTask(created.id, {
      source_refs_append: [accessorRef],
    }, created.version, fixture.context())).rejects.toMatchObject({ code: 'validation_error', status: 400 });
    await expect(fixture.service.updateTask(created.id, {
      source_refs_append: symbolArray,
    }, created.version, fixture.context())).rejects.toMatchObject({ code: 'validation_error', status: 400 });
    await expect(fixture.service.updateTask(created.id, {
      source_refs_append: accessorArray,
    }, created.version, fixture.context())).rejects.toMatchObject({ code: 'validation_error', status: 400 });
    await expect(fixture.service.updateTask(created.id, topLevelAccessorInput, created.version, fixture.context()))
      .rejects.toMatchObject({ code: 'validation_error', status: 400 });
    await expect(fixture.service.updateTask(created.id, {
      source_refs_append: [deeplyNested],
    }, created.version, fixture.context())).rejects.toMatchObject({ code: 'validation_error', status: 400 });
    expect(accessorArrayReads).toBe(0);
    expect(topLevelAccessorReads).toBe(0);
    await expect(fixture.service.updateTask(created.id, {
      source_refs: [],
      source_refs_append: [],
    }, created.version, fixture.context())).rejects.toMatchObject({ code: 'validation_error', status: 400 });

    expect(update).not.toHaveBeenCalled();
    expect(fixture.tasks.get(created.id)).toEqual(before);
    update.mockRestore();
  });

  it('treats nullish legacy source_refs as empty and rejects other non-array legacy state', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const created = await fixture.service.createTask({ title: 'Legacy source refs state' }, fixture.context('legacy-source-create'));
    const stored = fixture.tasks.get(created.id) as Record<string, unknown>;

    stored.source_refs = null;
    const appendedFromNull = await fixture.service.updateTask(created.id, {
      source_refs_append: [{ type: 'manual', id: 'from-null' }],
    }, created.version, fixture.context());
    expect(appendedFromNull.source_refs).toEqual([{ type: 'manual', id: 'from-null' }]);

    (fixture.tasks.get(created.id) as Record<string, unknown>).source_refs = undefined;
    const appendedFromUndefined = await fixture.service.updateTask(created.id, {
      source_refs_append: [{ type: 'manual', id: 'from-undefined' }],
    }, appendedFromNull.version, fixture.context());
    expect(appendedFromUndefined.source_refs).toEqual([{ type: 'manual', id: 'from-undefined' }]);

    const currentStored = fixture.tasks.get(created.id) as Record<string, unknown>;
    currentStored.source_refs = 'legacy-invalid';
    const before = structuredClone(currentStored);
    await expect(fixture.service.updateTask(created.id, {
      source_refs_append: [{ type: 'manual', id: 'must-not-write' }],
    }, appendedFromUndefined.version, fixture.context()))
      .rejects.toMatchObject({ code: 'validation_error', status: 400 });
    expect(fixture.tasks.get(created.id)).toEqual(before);
  });

  it('rejects stale source_refs_append without changing the task', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const created = await fixture.service.createTask({ title: 'Stale append task' }, fixture.context('stale-append-create'));
    const current = await fixture.service.updateTask(created.id, { title: 'Current title' }, created.version, fixture.context());
    await expect(fixture.service.updateTask(created.id, {
      source_refs_append: [{ type: 'manual', id: 'late' }],
    }, created.version, fixture.context())).rejects.toMatchObject({ code: 'version_conflict', status: 409 });
    expect(fixture.tasks.get(created.id)).toMatchObject({ version: current.version, title: 'Current title', source_refs: [] });
  });

  it('preserves the existing nullable source_refs replacement validator', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const created = await fixture.service.createTask({
      title: 'Nullable source refs task',
      source_refs: null as unknown as unknown[],
    }, fixture.context('nullable-source-create'));
    expect(created.source_refs).toEqual([]);
    const updated = await fixture.service.updateTask(created.id, {
      source_refs: null as unknown as unknown[],
    }, created.version, fixture.context());
    expect(updated.source_refs).toEqual([]);
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
