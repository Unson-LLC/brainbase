import {
  CanonicalTaskService,
  type CanonicalTaskAuditEntry,
  type CanonicalTaskContext,
  type CanonicalTaskPage,
  type CanonicalTaskRecord,
  type CanonicalTaskRepository,
} from '../../src/canonical-task-service.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}
export function createCanonicalTaskServiceFixture() {
  const tasks = new Map<string, CanonicalTaskRecord>();
  const auditEntries: CanonicalTaskAuditEntry[] = [];
  const actions: string[] = [];
  let nextId = 1;
  const repository: CanonicalTaskRepository = {
    async list(filters): Promise<CanonicalTaskPage> {
      const items = [...tasks.values()].filter((task) => {
        const statuses = Array.isArray(filters.statuses) ? filters.statuses : [];
        const priorities = Array.isArray(filters.priorities) ? filters.priorities : [];
        return (statuses.length === 0 || statuses.includes(task.status))
          && (priorities.length === 0 || priorities.includes(task.priority));
      });
      return { items: clone(items), totalCount: items.length, readStatus: 'read' };
    },
    async search(filters): Promise<CanonicalTaskPage> {
      const query = String(filters.q ?? '').toLowerCase();
      const items = [...tasks.values()].filter((task) => task.title.toLowerCase().includes(query));
      return { items: clone(items), totalCount: items.length, readStatus: 'read' };
    },
    async get(taskId) {
      const task = tasks.get(taskId);
      return task ? clone(task) : null;
    },
    async findByIdempotencyKey(key) {
      const task = [...tasks.values()].find((candidate) => candidate.idempotency_key === key);
      return task ? clone(task) : null;
    },
    async create(input) {
      const now = '2026-01-01T00:00:00.000Z';
      const task = {
        ...clone(input),
        id: `task-${nextId++}`,
        version: 1,
        created_at: now,
        updated_at: now,
      } as CanonicalTaskRecord;
      tasks.set(task.id, task);
      return clone(task);
    },
    async update(taskId, patch) {
      const current = tasks.get(taskId);
      if (!current) throw new Error('missing task');
      const updated = { ...current, ...clone(patch) } as CanonicalTaskRecord;
      tasks.set(taskId, updated);
      return clone(updated);
    },
    async delete(taskId, expectedVersion) {
      const current = tasks.get(taskId);
      if (!current || current.version !== expectedVersion) throw new Error('stale task');
      tasks.delete(taskId);
    },
  };
  const service = new CanonicalTaskService({
    repository,
    auditRepository: {
      async upsertAuditLog(entry) {
        auditEntries.push(clone(entry));
      },
    },
    policy: {
      authorize({ action }) {
        actions.push(action);
      },
      scopeFilters({ filters }) {
        return filters;
      },
    },
    clock: () => new Date('2026-01-02T00:00:00.000Z'),
    baseUrl: 'https://consumer.example.test',
  });
  const context = (idempotencyKey?: string): CanonicalTaskContext => ({
    principal: { type: 'person', id: 'consumer-user' },
    authSource: 'bearer',
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
  return { service, repository, tasks, auditEntries, actions, context };
}
