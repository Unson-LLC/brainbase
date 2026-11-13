import { describe, expect, it } from 'vitest';
import { createCanonicalTaskServiceFixture } from './fixtures/canonical-task-service.js';

describe('UNS-604 start date acceptance boundaries', () => {
  it('rejects changing only the start to after the stored deadline', async () => {
    const f = createCanonicalTaskServiceFixture();
    const task = await f.service.createTask({ title: 'Planned', start_at: '2026-11-20', due_at: '2026-11-30' }, f.context('create'));
    await expect(f.service.updateTask(task.id, { start_at: '2026-12-01' }, task.version, f.context('update')))
      .rejects.toMatchObject({ code: 'validation_error', status: 400 });
    expect(f.tasks.get(task.id)?.version).toBe(task.version);
  });

  it('rejects changing only the deadline to before the stored start', async () => {
    const f = createCanonicalTaskServiceFixture();
    const task = await f.service.createTask({ title: 'Planned', start_at: '2026-11-20', due_at: '2026-11-30' }, f.context('create'));
    await expect(f.service.updateTask(task.id, { due_at: '2026-11-19' }, task.version, f.context('update')))
      .rejects.toMatchObject({ code: 'validation_error', status: 400 });
    expect(f.tasks.get(task.id)?.version).toBe(task.version);
  });

  it('rejects a nonexistent calendar date instead of silently moving it into March', async () => {
    const f = createCanonicalTaskServiceFixture();
    await expect(f.service.createTask({ title: 'Impossible', start_at: '2026-02-30' }, f.context('create')))
      .rejects.toMatchObject({ code: 'validation_error', status: 400 });
    expect(f.tasks.size).toBe(0);
    expect(f.auditEntries).toEqual([]);
  });

  it.each(['2026-02-29', '1900-02-29', '2026-04-31', '2026-00-01', '2026-01-00', '2026-13-01', '02/20/2026', '2026-02-30T12:00:00+09:00'])(
    'rejects invalid start date %s without creating a task', async (start_at) => {
      const f = createCanonicalTaskServiceFixture();
      await expect(f.service.createTask({ title: 'Invalid', start_at }, f.context('create')))
        .rejects.toMatchObject({ code: 'validation_error', status: 400 });
      expect(f.tasks.size).toBe(0);
      expect(f.auditEntries).toEqual([]);
    },
  );

  it.each(['2028-02-29', '2000-02-29', '2026-04-30', '2026-11-20T09:00:00+09:00'])(
    'accepts valid start date %s', async (start_at) => {
      const f = createCanonicalTaskServiceFixture();
      const task = await f.service.createTask({ title: 'Valid', start_at }, f.context('create'));
      expect(task.start_at).toBe(new Date(start_at).toISOString());
    },
  );

  it('clears either date and replays a successful date mutation without advancing the version', async () => {
    const f = createCanonicalTaskServiceFixture();
    const task = await f.service.createTask({ title: 'Plan', start_at: '2026-11-20', due_at: '2026-11-30' }, f.context('create'));
    const cleared = await f.service.updateTask(task.id, { start_at: null }, task.version, f.context('clear'));
    const replay = await f.service.updateTask(task.id, { start_at: null }, task.version, f.context('clear'));
    expect(replay.version).toBe(cleared.version);
    expect(replay.start_at).toBeNull();
    const moved = await f.service.updateTask(task.id, { start_at: '2026-12-01', due_at: null }, cleared.version, f.context('move'));
    expect(moved.due_at).toBeNull();
    expect(moved.start_at).toBe('2026-12-01T00:00:00.000Z');
  });

  it('preserves conflict precedence for a stale date mutation', async () => {
    const f = createCanonicalTaskServiceFixture();
    const task = await f.service.createTask({ title: 'Plan', start_at: '2026-11-20', due_at: '2026-11-30' }, f.context('create'));
    const updated = await f.service.updateTask(task.id, { title: 'Updated' }, task.version, f.context('title'));
    await expect(f.service.updateTask(task.id, { start_at: '2026-12-01' }, task.version, f.context('stale')))
      .rejects.toMatchObject({ code: 'version_conflict', status: 409 });
    expect(f.tasks.get(task.id)?.version).toBe(updated.version);
  });
});
