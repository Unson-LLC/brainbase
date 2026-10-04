import { describe, expect, it } from 'vitest';
import { CanonicalTaskService, type CanonicalTaskContext, type CanonicalTaskRecord } from '../src/canonical-task-service.js';

function fixture() {
  const rows = new Map<string, CanonicalTaskRecord>();
  const calls: Array<[string, string | undefined]> = [];
  const audits: any[] = [];
  const replays = new Map<string, any>();
  let allowed = true;
  const visible = (id: string, scope?: string) => rows.get(id)?.scope === scope ? rows.get(id)! : null;
  const repository = {
    async list(_filters: any, scope?: string) { calls.push(['list', scope]); const items = [...rows.values()].filter(x => x.scope === scope); return { items, totalCount: items.length }; },
    async search(filters: any, scope?: string) { calls.push(['search', scope]); return this.list(filters, scope); },
    async get(id: string, scope?: string) { calls.push(['get', scope]); return visible(id, scope); },
    async findByIdempotencyKey(key: string, scope?: string) { calls.push(['find', scope]); return [...rows.values()].find(x => x.scope === scope && x.idempotency_key === key) ?? null; },
    async create(input: any, scope?: string) { calls.push(['create', scope]); const row = { ...input, id: `task-${rows.size}`, scope } as CanonicalTaskRecord; rows.set(row.id, row); return row; },
    async update(id: string, patch: any, scope?: string) { calls.push(['update', scope]); const row = { ...visible(id, scope)!, ...patch }; rows.set(id, row); return row; },
    async delete(id: string, _version: number, scope?: string) { calls.push(['delete', scope]); rows.delete(id); }
  };
  const operationRepository = {
    async execute(request: any) { return request.run(); },
    async executePreparedDelete(request: any) {
      if (replays.has(request.operationKey)) return replays.get(request.operationKey);
      const prepared = await request.prepare();
      expect(prepared.authorizationSnapshot.storage_scope).toBe(prepared.result._storage_scope);
      await request.removeTask(prepared.task);
      replays.set(request.operationKey, prepared.result);
      return prepared.result;
    }
  };
  const service = new CanonicalTaskService({ repository, operationRepository,
    auditRepository: { async upsertAuditLog(entry) { audits.push(entry); } },
    policy: { authorize() { if (!allowed) throw Object.assign(new Error('revoked'), { code: 'revoked' }); } }
  });
  const context = (storageScope: string, key = 'same-key'): CanonicalTaskContext => ({ principal: { type: 'person', id: 'same-person' }, storageScope, idempotencyKey: key });
  return { service, calls, audits, replays, context, revoke() { allowed = false; } };
}

describe('policy supplied storage scope', () => {
  it('isolates same actor/key and passes scope through CRUD, filters, recovery and audit', async () => {
    const f = fixture(); const a = f.context('a'); const b = f.context('b');
    const first = await f.service.createTask({ title: 'first' }, a);
    const second = await f.service.createTask({ title: 'second' }, b);
    expect(first.id).not.toBe(second.id);
    expect((await f.service.listTasks({}, a)).items.map(x => x.id)).toEqual([first.id]);
    await f.service.searchTasks({ query: 'first' }, a);
    await expect(f.service.getTask(first.id, b)).rejects.toMatchObject({ code: 'task_not_found' });
    const updated = await f.service.updateTask(first.id, { title: 'updated' }, 1, a);
    await f.service.transitionTask(first.id, 'in_progress', updated.version, a);
    await f.service.deleteTask(first.id, 3, a);
    expect(f.calls).toContainEqual(['update', 'a']); expect(f.calls).toContainEqual(['delete', 'a']);
    expect(f.calls).toContainEqual(['find', 'b']);
    expect(f.audits.every(x => ['a', 'b'].includes(x.storage_scope))).toBe(true);
  });
  it('binds completed delete replay and rechecks current authorization', async () => {
    const f = fixture(); const context = f.context('a');
    const row = await f.service.createTask({ title: 'delete' }, context);
    const deleted = await f.service.deleteTask(row.id, 1, context);
    expect(await f.service.deleteTask(row.id, 1, context)).toEqual(deleted);
    const [key, result] = [...f.replays.entries()][0];
    f.replays.set(key, { ...result, _storage_scope: 'b' });
    await expect(f.service.deleteTask(row.id, 1, context)).rejects.toMatchObject({ code: 'task_not_found' });
    f.replays.set(key, result); f.revoke();
    await expect(f.service.deleteTask(row.id, 1, context)).rejects.toThrow('revoked');
  });
});
