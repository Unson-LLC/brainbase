import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

execFileSync('npm', ['run', 'build'], {
  cwd: packageRoot,
  stdio: 'pipe',
});

const { NocoDBClient } = await import('../build/nocodb-client.js');

const CANONICAL_BASE_ID = 'pva7l2qlu6fdfip';
const CANONICAL_TABLE_ID = 'm7iys8m7o1abr3f';
const CANONICAL_TABLE_NAME = 'タスク';

function createManifest(overrides = {}) {
  return {
    schema_version: '1.0.0',
    base_id: CANONICAL_BASE_ID,
    table_id: CANONICAL_TABLE_ID,
    table_name: CANONICAL_TABLE_NAME,
    project: 'brainbase',
    owner_person_id: 'person_owner',
    ...overrides,
  };
}

async function withManifest(manifest, callback) {
  const directory = mkdtempSync(join(tmpdir(), 'canonical-task-mcp-'));
  const manifestPath = join(directory, 'canonical-task-store.json');
  const previous = process.env.CANONICAL_TASK_STORE_MANIFEST;

  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
  process.env.CANONICAL_TASK_STORE_MANIFEST = manifestPath;

  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete process.env.CANONICAL_TASK_STORE_MANIFEST;
    } else {
      process.env.CANONICAL_TASK_STORE_MANIFEST = previous;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

function createNocoDBStub({
  canonicalTableTitle = CANONICAL_TABLE_NAME,
  includeCanonicalTable = true,
  columnParents = {},
} = {}) {
  const requests = [];
  const tables = [
    ...(includeCanonicalTable
      ? [{ id: CANONICAL_TABLE_ID, title: canonicalTableTitle }]
      : []),
    { id: 'table_notes', title: 'Notes' },
  ];

  async function respond(method, path, body) {
    requests.push({ method, path, body });

    if (method === 'GET' && path === `/api/v2/meta/bases/${CANONICAL_BASE_ID}/tables`) {
      return { data: { list: tables } };
    }

    if (method === 'GET' && path.startsWith('/api/v2/meta/columns/')) {
      const columnId = path.split('/').at(-1);
      const parentTableId = columnParents[columnId];
      if (!parentTableId) {
        const error = new Error('column not found');
        error.response = { status: 404, data: { message: 'column not found' } };
        throw error;
      }
      return { data: { id: columnId, fk_model_id: parentTableId } };
    }

    if (method === 'GET' && path.startsWith('/api/v1/db/data/noco/')) {
      return { data: { list: [{ ID: 1, Title: 'readable' }] } };
    }

    if (method === 'DELETE') {
      return { data: { success: true } };
    }

    return { data: { ID: 2, Title: 'mutated' } };
  }

  return {
    requests,
    attach(client) {
      client.axios = {
        get: (path) => respond('GET', path),
        post: (path, body) => respond('POST', path, body),
        patch: (path, body) => respond('PATCH', path, body),
        delete: (path) => respond('DELETE', path),
      };
      return client;
    },
  };
}

function mutationRequests(requests) {
  return requests.filter(({ method }) => ['POST', 'PATCH', 'DELETE'].includes(method));
}

async function expectGuardCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

test('SC-040 Given canonical metadata, direct canonical record mutations are rejected before NocoDB mutation', async () => {
  const stub = createNocoDBStub();

  await withManifest(createManifest(), async () => {
    const client = stub.attach(new NocoDBClient('http://stub.invalid', 'token'));

    await expectGuardCode(
      client.create(CANONICAL_BASE_ID, CANONICAL_TABLE_NAME, { Title: 'blocked' }),
      'canonical_task_api_required'
    );
    await expectGuardCode(
      client.update(CANONICAL_BASE_ID, CANONICAL_TABLE_ID, '1', { Title: 'blocked' }),
      'canonical_task_api_required'
    );
    await expectGuardCode(
      client.delete(CANONICAL_BASE_ID, CANONICAL_TABLE_NAME, '1'),
      'canonical_task_api_required'
    );
  });

  assert.deepEqual(mutationRequests(stub.requests), []);
});

test('SC-040 Given a canonical parent table, direct column mutation is rejected before NocoDB mutation', async () => {
  const stub = createNocoDBStub({
    columnParents: { column_status: CANONICAL_TABLE_ID },
  });

  await withManifest(createManifest(), async () => {
    const client = stub.attach(new NocoDBClient('http://stub.invalid', 'token'));

    await expectGuardCode(
      client.updateColumn('column_status', { colOptions: { options: [{ title: 'Done' }] } }),
      'canonical_task_api_required'
    );
  });

  assert.deepEqual(mutationRequests(stub.requests), []);
});

test('SC-040 Given verified canonical identity, non-canonical record and column mutations retain their contract', async () => {
  const stub = createNocoDBStub({
    columnParents: { column_notes: 'table_notes' },
  });

  await withManifest(createManifest(), async () => {
    const client = stub.attach(new NocoDBClient('http://stub.invalid', 'token'));

    await client.create(CANONICAL_BASE_ID, 'Notes', { Title: 'created' });
    await client.update(CANONICAL_BASE_ID, 'Notes', '2', { Title: 'updated' });
    await client.delete(CANONICAL_BASE_ID, 'Notes', '2');
    await client.updateColumn('column_notes', {
      colOptions: { options: [{ title: 'Kept' }] },
    });
  });

  assert.equal(mutationRequests(stub.requests).length, 4);
});

test('SC-040 Given a missing manifest, reads remain available while every mutation fails closed', async () => {
  const stub = createNocoDBStub();
  const previous = process.env.CANONICAL_TASK_STORE_MANIFEST;
  process.env.CANONICAL_TASK_STORE_MANIFEST = join(tmpdir(), 'missing-canonical-task-store.json');

  try {
    const client = stub.attach(new NocoDBClient('http://stub.invalid', 'token'));
    const records = await client.list(CANONICAL_BASE_ID, 'Notes');

    assert.equal(records.length, 1);
    await expectGuardCode(
      client.create(CANONICAL_BASE_ID, 'Notes', { Title: 'blocked' }),
      'canonical_task_mutation_not_ready'
    );
    await expectGuardCode(
      client.update(CANONICAL_BASE_ID, 'Notes', '1', { Title: 'blocked' }),
      'canonical_task_mutation_not_ready'
    );
    await expectGuardCode(
      client.delete(CANONICAL_BASE_ID, 'Notes', '1'),
      'canonical_task_mutation_not_ready'
    );
    await expectGuardCode(
      client.updateColumn('column_notes', {
        colOptions: { options: [{ title: 'blocked' }] },
      }),
      'canonical_task_mutation_not_ready'
    );
    assert.deepEqual(mutationRequests(stub.requests), []);
  } finally {
    if (previous === undefined) {
      delete process.env.CANONICAL_TASK_STORE_MANIFEST;
    } else {
      process.env.CANONICAL_TASK_STORE_MANIFEST = previous;
    }
  }
});

test('SC-040 Given canonical identity mismatch, mutation readiness closes without fallback', async () => {
  const stub = createNocoDBStub({ canonicalTableTitle: 'Wrong table' });

  await withManifest(createManifest(), async () => {
    const client = stub.attach(new NocoDBClient('http://stub.invalid', 'token'));

    await expectGuardCode(
      client.create(CANONICAL_BASE_ID, 'Notes', { Title: 'blocked' }),
      'canonical_task_mutation_not_ready'
    );
    await expectGuardCode(
      client.updateColumn('unknown_column', {
        colOptions: { options: [{ title: 'blocked' }] },
      }),
      'canonical_task_mutation_not_ready'
    );
  });

  assert.deepEqual(mutationRequests(stub.requests), []);
});

test('SC-040 Given an unresolved table, mutation readiness closes without a later fallback', async () => {
  const stub = createNocoDBStub({
    columnParents: { column_notes: 'table_notes' },
  });

  await withManifest(createManifest(), async () => {
    const client = stub.attach(new NocoDBClient('http://stub.invalid', 'token'));

    await expectGuardCode(
      client.create(CANONICAL_BASE_ID, 'Unknown table', { Title: 'blocked' }),
      'canonical_task_mutation_not_ready'
    );
    await expectGuardCode(
      client.updateColumn('column_notes', {
        colOptions: { options: [{ title: 'blocked' }] },
      }),
      'canonical_task_mutation_not_ready'
    );
  });

  assert.deepEqual(mutationRequests(stub.requests), []);
});

test('SC-040 Given an unresolved column, mutation readiness closes without a later fallback', async () => {
  const stub = createNocoDBStub();

  await withManifest(createManifest(), async () => {
    const client = stub.attach(new NocoDBClient('http://stub.invalid', 'token'));

    await expectGuardCode(
      client.updateColumn('unknown_column', {
        colOptions: { options: [{ title: 'blocked' }] },
      }),
      'canonical_task_mutation_not_ready'
    );
    await expectGuardCode(
      client.create(CANONICAL_BASE_ID, 'Notes', { Title: 'blocked' }),
      'canonical_task_mutation_not_ready'
    );
  });

  assert.deepEqual(mutationRequests(stub.requests), []);
});
