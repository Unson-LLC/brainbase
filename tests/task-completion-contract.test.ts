import { describe, expect, it } from 'vitest';
import { createCanonicalTaskServiceFixture } from './fixtures/canonical-task-service.js';

const contract = { goal: '判断に使える比較結果を渡す', criteria: [{ id: 'result', condition: '同条件の比較回答を確認できる' }] };

describe('Task completion contract', () => {
  it('preserves the contract through create/read/list/search/update with CAS and audit', async () => {
    const f = createCanonicalTaskServiceFixture();
    const created = await f.service.createTask({ title: 'Comparison', completion_contract: contract }, f.context('create'));
    expect(created.completion_contract).toEqual(contract);
    expect((await f.service.getTask(created.id, f.context())).completion_contract).toEqual(contract);
    expect((await f.service.listTasks({}, f.context())).items[0].completion_contract).toEqual(contract);
    expect((await f.service.searchTasks({ q: 'Comparison' }, f.context())).items[0].completion_contract).toEqual(contract);
    const changed = { ...contract, goal: '修正負担を評価する' };
    const updated = await f.service.updateTask(created.id, { completion_contract: changed }, created.version, f.context());
    expect(updated.completion_contract).toEqual(changed);
    expect(JSON.stringify(f.auditEntries)).toContain('修正負担を評価する');
    await expect(f.service.updateTask(created.id, { completion_contract: contract }, created.version, f.context()))
      .rejects.toMatchObject({ code: 'version_conflict', status: 409 });
    await expect(f.service.createTask({ title: 'Comparison', completion_contract: changed }, f.context('create')))
      .rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
  });

  it('keeps legacy stores compatible and permits an explicit clear under host policy', async () => {
    const f = createCanonicalTaskServiceFixture();
    const legacy = await f.service.createTask({ title: 'Legacy' }, f.context('legacy'));
    expect(f.tasks.get(legacy.id)).not.toHaveProperty('completion_contract');
    expect(legacy.completion_contract).toBeNull();
    const created = await f.service.createTask({ title: 'Contract', completion_contract: contract }, f.context('contract'));
    const cleared = await f.service.updateTask(created.id, { completion_contract: null }, created.version, f.context());
    expect(cleared.completion_contract).toBeNull();
  });

  const invalid = [
    {}, { goal: 'goal' }, { criteria: contract.criteria },
    { ...contract, criteria: new Array(1) },
    { ...contract, criteria: [null] },
    { ...contract, criteria: [{ id: 'result' }] },
    [], 'text', { ...contract, goal: 42 }, { ...contract, goal: ' ' },
    { ...contract, goal: 'a'.repeat(2001) }, { ...contract, criteria: [] },
    { ...contract, criteria: Array.from({ length: 51 }, (_, i) => ({ id: `c-${i}`, condition: 'check' })) },
    { ...contract, satisfied: true }, { ...contract, evidence_refs: ['fake'] },
    { ...contract, criteria: [{ id: 'result', condition: 'check', satisfied: true }] },
    { ...contract, criteria: [{ id: 'result', condition: 'check', evidence_refs: ['fake'] }] },
    { ...contract, criteria: [{ id: 'result', condition: '' }] },
    { ...contract, criteria: [{ id: 'result', condition: 'a'.repeat(2001) }] },
    { ...contract, criteria: [{ id: 'bad id', condition: 'check' }] },
    { ...contract, criteria: [{ id: 1, condition: 'check' }] },
    { ...contract, criteria: [{ id: 'a'.repeat(65), condition: 'check' }] },
    { ...contract, criteria: [{ id: 'same', condition: 'one' }, { id: 'same', condition: 'two' }] },
  ];

  it.each(invalid.map((value, index) => ({ value, index })))('rejects malformed contract $index on create and update', async ({ value, index }) => {
    const f = createCanonicalTaskServiceFixture();
    await expect(f.service.createTask({ title: 'Invalid', completion_contract: value }, f.context(`invalid-${index}`)))
      .rejects.toMatchObject({ code: 'validation_error', status: 400 });
    expect(f.tasks.size).toBe(0);
    const created = await f.service.createTask({ title: 'Valid' }, f.context('valid'));
    await expect(f.service.updateTask(created.id, { completion_contract: value }, created.version, f.context()))
      .rejects.toMatchObject({ code: 'validation_error', status: 400 });
    expect(f.tasks.get(created.id)?.version).toBe(created.version);
  });

  it('fails closed when a stored contract is malformed', async () => {
    const f = createCanonicalTaskServiceFixture();
    const created = await f.service.createTask({ title: 'Corrupted' }, f.context('corrupt'));
    f.tasks.get(created.id)!.completion_contract = { goal: 'lost criteria' };
    await expect(f.service.getTask(created.id, f.context())).rejects.toMatchObject({ code: 'task_store_invalid', status: 503 });
  });
});
