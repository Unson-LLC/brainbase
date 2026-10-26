import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CanonicalTaskOperationRepository,
  CanonicalTaskReadiness,
} from '../src/canonical-task-operations.js';
import {
  CanonicalTaskError,
  CanonicalTaskService,
  type CanonicalTaskAuditEntry,
  type CanonicalTaskContext,
  type CanonicalTaskPolicy,
  type CanonicalTaskRecord,
} from '../src/canonical-task-service.js';
import { CanonicalTaskPostgresRepository } from '../src/canonical-task-postgres.js';

/**
 * With CANONICAL_TASK_PG_TEST_ADMIN_URL, creates and drops a disposable local
 * database. The older CANONICAL_TASK_PG_TEST_URL instead isolates a schema in
 * an already disposable test database. Without either URL the suite is skipped
 * unless CANONICAL_TASK_PG_TEST_REQUIRED=1 requires a URL and fails without one.
 * The package CI sets a URL and CANONICAL_TASK_PG_TEST_REQUIRED=1.
 *
 *   CANONICAL_TASK_PG_TEST_URL=postgres://... npm run test:canonical-task-postgres
 */
const adminConnectionString = process.env.CANONICAL_TASK_PG_TEST_ADMIN_URL;
const connectionString = adminConnectionString || process.env.CANONICAL_TASK_PG_TEST_URL;
const postgresIntegrationEnabled = Boolean(connectionString);
if (process.env.CANONICAL_TASK_PG_TEST_REQUIRED === '1' && !connectionString) {
  describe('Required PostgreSQL test configuration', () => {
    it('requires a PostgreSQL test URL', () => {
      throw new Error('CANONICAL_TASK_PG_TEST_REQUIRED=1 but no PostgreSQL test URL');
    });
  });
}
if (connectionString) {
  const parsedConnectionString = new URL(connectionString);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (!localHosts.has(parsedConnectionString.hostname.toLowerCase())) {
    throw new Error('CANONICAL_TASK_PG_TEST_URL must point to localhost, 127.0.0.1, or ::1');
  }
}

const schemaName = `canonical_task_it_${process.pid}_${randomBytes(6).toString('hex')}`;
const quotedSchemaName = `"${schemaName}"`;
const sourceHead = 'canonical-task-pg-integration';
const manifestHash = 'canonical-task-pg-integration-manifest';
const schemaVersion = '1.0.0';

type TestContext = CanonicalTaskContext & {
  verifiedOrgId: string;
  orgMemberships: string[];
};

const actor = (id: string, org: string, idempotencyKey: string): TestContext => ({
  principal: { type: 'person', id },
  authSource: 'bearer',
  idempotencyKey,
  verifiedOrgId: org,
  orgMemberships: [org],
});

const projectOrg = new Map<string, string>([['project-112', 'org-techknight']]);
const revokedPrincipals = new Set<string>();

function forbidden(message: string): never {
  throw new CanonicalTaskError('forbidden', message, 403);
}

/**
 * Host policy fixture for ADR #112. The Task row has no organization column:
 * project ownership and verified token organization are resolved by the host
 * policy, while an unscoped Task is available only to its assignee.
 */
const policy: CanonicalTaskPolicy = {
  normalizeContext(context) {
    const candidate = context as TestContext;
    if (candidate.authSource !== 'bearer'
      || typeof candidate.verifiedOrgId !== 'string'
      || !candidate.orgMemberships.includes(candidate.verifiedOrgId)) {
      throw new CanonicalTaskError('unauthenticated_context', 'A verified bearer organization is required', 401);
    }
    return candidate;
  },
  authorize({ action, context, task, input }) {
    const candidate = context as TestContext;
    const principalId = candidate.principal.id;
    if (revokedPrincipals.has(principalId)) forbidden('The principal is no longer an active organization member');

    if (action === 'create') {
      const createInput = (input || {}) as Record<string, unknown>;
      const projectCodes = Array.isArray(createInput.project_codes)
        ? createInput.project_codes.map(String)
        : [];
      const requiredOrgs = projectCodes.map((code) => projectOrg.get(code)).filter(Boolean);
      if (requiredOrgs.some((org) => org !== candidate.verifiedOrgId)) {
        forbidden('The verified token organization does not own the project');
      }
      if (requiredOrgs.length === 0 && createInput.assignee_person_id !== principalId) {
        forbidden('An unscoped Task may only be created for the requesting assignee');
      }
      return;
    }

    if (!task) return;
    const projectCodes = Array.isArray(task.project_codes) ? task.project_codes : [];
    const requiredOrgs = projectCodes.map((code) => projectOrg.get(String(code))).filter(Boolean);
    if (requiredOrgs.some((org) => org !== candidate.verifiedOrgId)) {
      forbidden('The verified token organization does not own the project');
    }
    if (requiredOrgs.length === 0 && task.assignee_person_id !== principalId) {
      forbidden('An unscoped Task is restricted to its assignee');
    }
  },
};

let adminPool: Pool | undefined;
let pool: Pool;
let repository: CanonicalTaskPostgresRepository;
let operations: CanonicalTaskOperationRepository;
let readiness: CanonicalTaskReadiness;
let service: CanonicalTaskService;
const auditEntries = new Map<string, CanonicalTaskAuditEntry>();
let auditCalls = 0;

async function applySchema(file: string): Promise<void> {
  const sql = await readFile(resolve(process.cwd(), file), 'utf8');
  await pool.query(sql);
}

async function restoreReadiness(): Promise<void> {
  await pool.query(
    `UPDATE canonical_task_readiness
     SET ready = TRUE, writer_token = $1, manifest_hash = $2, schema_version = $3,
         source_head = $4, evidence_hash = 'integration-evidence',
         evidence_path = 'local://canonical-task-pg-integration', reason = NULL,
         updated_at = NOW()
     WHERE singleton_id = TRUE`,
    [operations.writerToken, manifestHash, schemaVersion, sourceHead],
  );
  const result = await readiness.initialize();
  expect(result.ready).toBe(true);
}

function createServiceContext(id: string, org = 'org-techknight', key = `key-${id}`): TestContext {
  return actor(id, org, key);
}

describe.skipIf(!postgresIntegrationEnabled)('Canonical Task PostgreSQL adapter and Service integration', () => {
  beforeAll(async () => {
    let testConnectionString = connectionString;
    if (adminConnectionString) {
      adminPool = new Pool({ connectionString: adminConnectionString });
      await adminPool.query(`CREATE DATABASE ${quotedSchemaName}`);
      const databaseUrl = new URL(adminConnectionString);
      databaseUrl.pathname = `/${schemaName}`;
      testConnectionString = databaseUrl.toString();
    }
    pool = new Pool({
      connectionString: testConnectionString,
      max: 4,
      options: `-c search_path=${quotedSchemaName},public`,
    });
    await pool.query(`CREATE SCHEMA ${quotedSchemaName}`);
    await applySchema('contracts/canonical-task/store-schema.sql');
    await applySchema('contracts/canonical-task/operation-schema.sql');

    operations = new CanonicalTaskOperationRepository({
      pool,
      writerToken: `integration-writer-${process.pid}`,
      processIdentity: { test: 'canonical-task-postgres-service', pid: process.pid },
      writerEnabled: true,
    });
    await operations.claimWriter({ sourceHead });
    await pool.query(
      `INSERT INTO canonical_task_readiness (
         singleton_id, ready, writer_token, manifest_hash, schema_version,
         source_head, evidence_hash, evidence_path, reason
       ) VALUES (TRUE, TRUE, $1, $2, $3, $4, 'integration-evidence',
                 'local://canonical-task-pg-integration', NULL)`,
      [operations.writerToken, manifestHash, schemaVersion, sourceHead],
    );
    readiness = new CanonicalTaskReadiness({
      operationRepository: operations,
      manifestHash,
      schemaVersion,
      sourceHead,
      logger: null,
    });
    expect((await readiness.initialize()).ready).toBe(true);

    repository = new CanonicalTaskPostgresRepository({
      pool,
      schemaVersion,
      idSecret: 'local-integration-only-secret',
    });
    service = new CanonicalTaskService({
      repository,
      operationRepository: operations,
      readiness,
      policy,
      auditRepository: {
        async upsertAuditLog(entry) {
          auditCalls += 1;
          auditEntries.set(entry.id, entry);
        },
      },
    });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE canonical_task_operations, canonical_tasks RESTART IDENTITY');
    revokedPrincipals.clear();
    auditEntries.clear();
    auditCalls = 0;
    await restoreReadiness();
  });

  afterAll(async () => {
    if (operations) {
      await operations.releaseWriter().catch(() => false);
    }
    await pool?.query(`DROP SCHEMA IF EXISTS ${quotedSchemaName} CASCADE`);
    await pool?.end();
    if (adminConnectionString) await adminPool?.query(`DROP DATABASE IF EXISTS ${quotedSchemaName}`);
    await adminPool?.end();
  });

  it('upgrades existing rows with default work, nullable ledger columns and an idempotent partial index', async () => {
    // Recreate the pre-ledger shape in this disposable database, with a real row.
    await pool.query(`ALTER TABLE canonical_tasks
      DROP COLUMN record_kind CASCADE, DROP COLUMN ledger_attributes, DROP COLUMN ledger_agreed`);
    try {
      await pool.query(`INSERT INTO canonical_tasks (id, title, status, priority, idempotency_key)
        VALUES (gen_random_uuid(), 'Existing work', 'pending', 'medium', 'pre-ledger')`);
      await applySchema('contracts/canonical-task/store-schema.sql');
      await applySchema('contracts/canonical-task/store-schema.sql');
      const rows = await pool.query('SELECT record_kind, ledger_attributes, ledger_agreed FROM canonical_tasks');
      expect(rows.rows).toEqual([{ record_kind: 'work', ledger_attributes: null, ledger_agreed: null }]);
      const columns = await pool.query(`SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'canonical_tasks'
        AND column_name IN ('record_kind', 'ledger_attributes', 'ledger_agreed')`, [schemaName]);
      expect(columns.rows).toEqual(expect.arrayContaining([
        { column_name: 'record_kind', data_type: 'text', is_nullable: 'NO', column_default: "'work'::text" },
        { column_name: 'ledger_attributes', data_type: 'jsonb', is_nullable: 'YES', column_default: null },
        { column_name: 'ledger_agreed', data_type: 'boolean', is_nullable: 'YES', column_default: null },
      ]));
      const index = await pool.query(`SELECT indexdef FROM pg_indexes
        WHERE schemaname = $1 AND indexname = 'canonical_tasks_ledger_record_kind_idx'`, [schemaName]);
      expect(index.rows).toHaveLength(1);
      expect(index.rows[0].indexdef).toContain('(record_kind, created_at, id)');
      expect(index.rows[0].indexdef).toContain("WHERE (record_kind <> 'work'::text)");
      const check = await pool.query(`SELECT convalidated FROM pg_constraint
        WHERE conrelid = 'canonical_tasks'::regclass AND conname = 'canonical_tasks_ledger_agreed_check'`);
      expect(check.rows).toEqual([{ convalidated: false }]);
      // Validation is a separate migration window, as specified in §2.5.
      await pool.query('ALTER TABLE canonical_tasks VALIDATE CONSTRAINT canonical_tasks_ledger_agreed_check');
      const constraints = await pool.query(`SELECT oid, conname, convalidated FROM pg_constraint
        WHERE conrelid = 'canonical_tasks'::regclass
        AND conname IN ('canonical_tasks_record_kind_check', 'canonical_tasks_ledger_agreed_check') ORDER BY conname`);
      await applySchema('contracts/canonical-task/store-schema.sql');
      expect((await pool.query(`SELECT oid, conname, convalidated FROM pg_constraint
        WHERE conrelid = 'canonical_tasks'::regclass
        AND conname IN ('canonical_tasks_record_kind_check', 'canonical_tasks_ledger_agreed_check') ORDER BY conname`)).rows)
        .toEqual(constraints.rows);
    } finally {
      await applySchema('contracts/canonical-task/store-schema.sql');
    }
  });

  it('enforces three record kinds and allows agreement only on requirements including NULL', async () => {
    for (const kind of ['work', 'request', 'requirement']) {
      for (const agreed of [null, false, true]) {
        const insert = pool.query(`INSERT INTO canonical_tasks
          (id, title, status, priority, idempotency_key, record_kind, ledger_agreed)
          VALUES (gen_random_uuid(), 'Check', 'pending', 'medium', $1, $2, $3)
          RETURNING record_kind, ledger_agreed`, [`check-${kind}-${agreed}`, kind, agreed]);
        if (kind !== 'requirement' && agreed !== null) {
          await expect(insert).rejects.toMatchObject({ code: '23514', constraint: 'canonical_tasks_ledger_agreed_check' });
        } else {
          await expect(insert).resolves.toMatchObject({ rows: [{ record_kind: kind, ledger_agreed: agreed }] });
        }
      }
    }
    await expect(pool.query(`UPDATE canonical_tasks SET record_kind = 'other' WHERE record_kind = 'work'`))
      .rejects.toMatchObject({ code: '23514', constraint: 'canonical_tasks_record_kind_check' });
    await expect(pool.query(`UPDATE canonical_tasks SET record_kind = NULL WHERE record_kind = 'work'`))
      .rejects.toMatchObject({ code: '23502', column: 'record_kind' });
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM canonical_tasks')).rows[0].count).toBe(5);
  });

  it('creates and reads back work, request and requirement with create-only ledger metadata', async () => {
    const work = await service.createTask({ title: 'Work', project_codes: ['project-112'] }, createServiceContext('person-a', undefined, 'kind-work'));
    expect(work).toMatchObject({ record_kind: 'work', ledger_attributes: null, ledger_agreed: null });
    for (const kind of ['request', 'requirement'] as const) {
      const task = await service.createTask({
        title: kind, record_kind: kind, project_codes: ['project-112'],
        ledger_attributes: { basis: 'Approved premise' },
        ...(kind === 'requirement' ? { ledger_agreed: false } : {}),
      }, createServiceContext('person-a', undefined, `kind-${kind}`));
      await expect(service.getTask(task.id, createServiceContext('person-a'))).resolves.toMatchObject({
        id: task.id, record_kind: kind, ledger_attributes: { basis: 'Approved premise' }, ledger_agreed: kind === 'requirement' ? false : null,
      });
      const warnings = (await service.getTask(task.id, createServiceContext('person-a'))).normalization_warnings as unknown[];
      expect(warnings).not.toContainEqual(expect.objectContaining({ code: 'unknown_record_kind' }));
      for (const field of ['record_kind', 'ledger_attributes', 'ledger_agreed']) {
        await expect(service.updateTask(task.id, { [field]: 'work' }, 1, createServiceContext('person-a')))
          .rejects.toMatchObject({ code: 'validation_error', status: 400 });
      }
    }
    for (const kind of [null, '', 'future-kind', 42]) {
      await expect(service.createTask({ title: 'Invalid', record_kind: kind, project_codes: ['project-112'] } as never,
        createServiceContext('person-a', undefined, `invalid-kind-${kind}`)))
        .rejects.toMatchObject({ code: 'validation_error', status: 400 });
    }
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM canonical_tasks')).rows[0].count).toBe(3);
    expect(auditEntries.size).toBe(3);
  });

  it('refuses general ledger updates, transitions, source appends and deletes with a distinct 409 and no mutation', async () => {
    for (const kind of ['request', 'requirement'] as const) {
      const task = await service.createTask({ title: 'Ledger', record_kind: kind, project_codes: ['project-112'] },
        createServiceContext('person-a', undefined, `blocked-${kind}`));
      const expected = { code: 'ledger_record_use_ledger_api', status: 409 };
      await expect(service.updateTask(task.id, { title: 'Changed' }, 1, createServiceContext('person-a', undefined, `title-${kind}`))).rejects.toMatchObject(expected);
      await expect(service.updateTask(task.id, { source_refs_append: [{ type: 'manual', id: 'new' }] }, 1,
        createServiceContext('person-a', undefined, `refs-${kind}`))).rejects.toMatchObject(expected);
      await expect(service.transitionTask(task.id, 'in_progress', 1,
        createServiceContext('person-a', undefined, `transition-${kind}`))).rejects.toMatchObject(expected);
      await expect(service.deleteTask(task.id, 1,
        createServiceContext('person-a', undefined, `delete-${kind}`))).rejects.toMatchObject(expected);
      // Exercise the SQL boundary independently of the Service preflight.
      await expect(repository.delete(task.id, 1)).rejects.toMatchObject(expected);
      await expect(service.getTask(task.id, createServiceContext('person-a'))).resolves.toMatchObject({
        title: 'Ledger', record_kind: kind, version: 1, status: 'pending', source_refs: [],
      });
    }
    expect(auditEntries.size).toBe(2); // Only the creates were audited.
  });

  it('refuses a ledger row atomically when its kind changes after the Service reads work', async () => {
    const task = await service.createTask({ title: 'Race', project_codes: ['project-112'] }, createServiceContext('person-a', undefined, 'race-create'));
    const raceRepository = new CanonicalTaskPostgresRepository({ pool, schemaVersion, idSecret: 'local-integration-only-secret' });
    const originalUpdate = raceRepository.update.bind(raceRepository);
    raceRepository.update = async (id, patch, scope) => {
      await pool.query(`UPDATE canonical_tasks SET record_kind = 'requirement' WHERE id = $1`, [repository.decodeTaskLocator(id).value]);
      return originalUpdate(id, patch, scope);
    };
    const raceService = new CanonicalTaskService({ repository: raceRepository, readiness, policy });
    await expect(raceService.updateTask(task.id, { title: 'Must not persist' }, 1, createServiceContext('person-a')))
      .rejects.toMatchObject({ code: 'ledger_record_use_ledger_api', status: 409 });
    await expect(service.getTask(task.id, createServiceContext('person-a'))).resolves.toMatchObject({
      title: 'Race', record_kind: 'requirement', version: 1,
    });
  });

  it('refuses a ledger delete atomically when its kind changes after the Service reads work', async () => {
    const task = await service.createTask({ title: 'Delete race', project_codes: ['project-112'] },
      createServiceContext('person-a', undefined, 'delete-race-create'));
    const raceRepository = new CanonicalTaskPostgresRepository({ pool, schemaVersion, idSecret: 'local-integration-only-secret' });
    const originalDelete = raceRepository.delete.bind(raceRepository);
    raceRepository.delete = async (id, version, scope) => {
      await pool.query(`UPDATE canonical_tasks SET record_kind = 'request' WHERE id = $1`, [repository.decodeTaskLocator(id).value]);
      return originalDelete(id, version, scope);
    };
    const raceService = new CanonicalTaskService({ repository: raceRepository, readiness, policy });
    await expect(raceService.deleteTask(task.id, 1, createServiceContext('person-a', undefined, 'delete-race')))
      .rejects.toMatchObject({ code: 'ledger_record_use_ledger_api', status: 409 });
    await expect(service.getTask(task.id, createServiceContext('person-a'))).resolves.toMatchObject({
      title: 'Delete race', record_kind: 'request', version: 1,
    });
    expect(auditEntries.size).toBe(1);
  });

  it('guards legacy locators and transaction guarded updates with the same ledger error', async () => {
    const task = await service.createTask({ title: 'Legacy ledger', record_kind: 'requirement', project_codes: ['project-112'] },
      createServiceContext('person-a', undefined, 'legacy-ledger'));
    const rowId = repository.decodeTaskLocator(task.id).value;
    await pool.query(`UPDATE canonical_tasks SET legacy_nocodb_id = 'ledger-legacy' WHERE id = $1`, [rowId]);
    const guardedRepository = new CanonicalTaskPostgresRepository({
      pool, schemaVersion, idSecret: 'local-integration-only-secret',
      legacyIdentity: { baseId: 'local-test', tableId: 'tasks' },
      mutationGuard: { async check() {} },
    });
    const legacyId = guardedRepository.encodeTaskId({ legacy_nocodb_id: 'ledger-legacy' });
    await expect(guardedRepository.update(legacyId, { title: 'Blocked legacy' }))
      .rejects.toMatchObject({ code: 'ledger_record_use_ledger_api', status: 409 });
    await expect(guardedRepository.delete(legacyId, 1))
      .rejects.toMatchObject({ code: 'ledger_record_use_ledger_api', status: 409 });
    const uuidId = guardedRepository.encodeTaskId({ id: rowId });
    await expect(guardedRepository.update(uuidId, { status: 'completed', version: 2 }))
      .rejects.toMatchObject({ code: 'ledger_record_use_ledger_api', status: 409 });
    expect((await pool.query('SELECT title, status, version FROM canonical_tasks WHERE id = $1', [rowId])).rows)
      .toEqual([{ title: 'Legacy ledger', status: 'pending', version: 1 }]);
  });

  it('returns unknown and one warning for invalid or NULL persisted kinds and refuses their updates', async () => {
    const task = await service.createTask({ title: 'Corrupt kind', project_codes: ['project-112'] }, createServiceContext('person-a', undefined, 'corrupt-kind'));
    const rowId = repository.decodeTaskLocator(task.id).value;
    await pool.query(`ALTER TABLE canonical_tasks DROP CONSTRAINT canonical_tasks_record_kind_check,
      ALTER COLUMN record_kind DROP NOT NULL`);
    try {
      for (const kind of [null, 'future-kind']) {
        await pool.query('UPDATE canonical_tasks SET record_kind = $1 WHERE id = $2', [kind, rowId]);
        const read = await service.getTask(task.id, createServiceContext('person-a'));
        expect(read.record_kind).toBe('unknown');
        expect(read.normalization_warnings).toEqual([expect.objectContaining({ code: 'unknown_record_kind' })]);
        await expect(service.updateTask(task.id, { title: 'Blocked' }, 1, createServiceContext('person-a', undefined, `corrupt-update-${kind}`)))
          .rejects.toMatchObject({ code: 'ledger_record_use_ledger_api', status: 409 });
        await expect(repository.delete(task.id, 1))
          .rejects.toMatchObject({ code: 'ledger_record_use_ledger_api', status: 409 });
      }
    } finally {
      await pool.query(`UPDATE canonical_tasks SET record_kind = 'work' WHERE id = $1`, [rowId]);
      await pool.query('ALTER TABLE canonical_tasks ALTER COLUMN record_kind SET NOT NULL');
      await applySchema('contracts/canonical-task/store-schema.sql');
    }
  });

  it('persists Service CRUD and coordinated replay in real PostgreSQL with host authorization boundaries', async () => {
    const owner = createServiceContext('person-a', 'org-techknight', 'create-project-1');
    const projectTask = await service.createTask({
      title: 'Project 112 task',
      assignee_person_id: 'person-a',
      project_codes: ['project-112'],
      source_refs: [{ source: 'integration', id: '112' }],
    }, owner);
    expect(projectTask.id).toMatch(/^ct1\./u);
    expect(projectTask.id).not.toMatch(/^[0-9a-f-]{36}$/iu);
    expect(repository.decodeTaskLocator(projectTask.id).column).toBe('id');

    const rawRow = await pool.query('SELECT id, version, project_codes FROM canonical_tasks');
    expect(rawRow.rows).toHaveLength(1);
    expect(rawRow.rows[0].id).toBe(repository.decodeTaskLocator(projectTask.id).value);
    expect(rawRow.rows[0].project_codes).toEqual(['project-112']);

    const projectReplay = await service.createTask({
      title: 'Project 112 task',
      assignee_person_id: 'person-a',
      project_codes: ['project-112'],
      source_refs: [{ source: 'integration', id: '112' }],
    }, owner);
    expect(projectReplay).toMatchObject({ id: projectTask.id, version: 1 });
    expect(auditCalls).toBe(2);
    expect(auditEntries.size).toBe(1);

    const sameOrgReader = createServiceContext('person-b', 'org-techknight', 'read-project-1');
    await expect(service.getTask(projectTask.id, sameOrgReader)).resolves.toMatchObject({ id: projectTask.id });
    const otherOrgReader = createServiceContext('person-c', 'org-other', 'read-project-2');
    await expect(service.getTask(projectTask.id, otherOrgReader)).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    });

    const unscopedTask = await service.createTask({
      title: 'Assignee-only task',
      assignee_person_id: 'person-a',
      project_codes: [],
    }, createServiceContext('person-a', 'org-techknight', 'create-unscoped-1'));
    await expect(service.getTask(unscopedTask.id, sameOrgReader)).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    });

    const updated = await service.updateTask(
      projectTask.id,
      { title: 'Project 112 task updated' },
      1,
      createServiceContext('person-a', 'org-techknight', 'update-project-1'),
    );
    expect(updated).toMatchObject({ id: projectTask.id, title: 'Project 112 task updated', version: 2 });
    const updateReplay = await service.updateTask(
      projectTask.id,
      { title: 'Project 112 task updated' },
      1,
      createServiceContext('person-a', 'org-techknight', 'update-project-1'),
    );
    expect(updateReplay).toMatchObject({ id: projectTask.id, version: 2 });

    const transitioned = await service.transitionTask(
      projectTask.id,
      'in_progress',
      2,
      createServiceContext('person-a', 'org-techknight', 'transition-project-1'),
    );
    expect(transitioned).toMatchObject({ id: projectTask.id, status: 'in_progress', version: 3 });

    const deleteContext = createServiceContext('person-a', 'org-techknight', 'delete-project-1');
    const deleted = await service.deleteTask(projectTask.id, 3, deleteContext);
    expect(deleted).toEqual({ task_id: projectTask.id, deleted: true, version: 4 });
    await expect(pool.query(
      'SELECT id FROM canonical_tasks WHERE id = $1',
      [repository.decodeTaskLocator(projectTask.id).value],
    )).resolves.toMatchObject({ rows: [] });

    revokedPrincipals.add('person-a');
    await expect(service.deleteTask(projectTask.id, 3, deleteContext)).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    });
    revokedPrincipals.delete('person-a');
    await expect(service.deleteTask(projectTask.id, 3, deleteContext)).resolves.toEqual(deleted);

    const persistedOperations = await pool.query(
      `SELECT scope, state FROM canonical_task_operations ORDER BY scope, operation_key`,
    );
    expect(persistedOperations.rows.length).toBeGreaterThanOrEqual(6);
    expect(persistedOperations.rows.every((row) => row.state === 'completed')).toBe(true);
    expect([...auditEntries.values()].map((entry) => entry.action)).toEqual(expect.arrayContaining([
      'canonical_task.created',
      'canonical_task.updated',
      'canonical_task.transitioned',
      'canonical_task.deleted',
    ]));
  });

  it('commits the Task with the audit writer and rolls back when that writer fails', async () => {
    let clientSeen: unknown = null;
    const atomicService = new CanonicalTaskService({
      repository,
      operationRepository: operations,
      readiness,
      policy,
      auditRepository: {
        supportsTransactionClient: true,
        async upsertAuditLog(_entry, options) {
          clientSeen = options?.client ?? null;
        },
      },
    });

    const created = await atomicService.createTask({
      title: 'Atomic commit task',
      assignee_person_id: 'person-a',
      project_codes: ['project-112'],
    }, createServiceContext('person-a', 'org-techknight', 'atomic-commit-1'));
    expect(clientSeen).not.toBeNull();
    const committed = await pool.query(
      'SELECT id FROM canonical_tasks WHERE idempotency_key LIKE $1',
      ['%atomic-commit-1%'],
    );
    expect(committed.rows.map((row) => row.id)).toEqual([repository.decodeTaskLocator(created.id).value]);

    const failingService = new CanonicalTaskService({
      repository,
      operationRepository: operations,
      readiness,
      policy,
      auditRepository: {
        supportsTransactionClient: true,
        async upsertAuditLog() {
          throw new Error('audit storage down');
        },
      },
    });
    await expect(failingService.createTask({
      title: 'Atomic rollback task',
      assignee_person_id: 'person-a',
      project_codes: ['project-112'],
    }, createServiceContext('person-a', 'org-techknight', 'atomic-rollback-1')))
      .rejects.toMatchObject({ code: 'task_audit_unavailable', status: 503 });

    const rolledBack = await pool.query(
      'SELECT id FROM canonical_tasks WHERE idempotency_key LIKE $1',
      ['%atomic-rollback-1%'],
    );
    expect(rolledBack.rowCount).toBe(0);
  });

  it('fails closed for every Service mutation and replay when persisted readiness closes', async () => {
    const owner = createServiceContext('person-a', 'org-techknight', 'readiness-create-1');
    const task = await service.createTask({
      title: 'Readiness boundary task',
      assignee_person_id: 'person-a',
      project_codes: ['project-112'],
    }, owner);
    const replayTask = await service.createTask({
      title: 'Readiness replay task',
      assignee_person_id: 'person-a',
      project_codes: ['project-112'],
    }, createServiceContext('person-a', 'org-techknight', 'readiness-replay-1'));
    const deleteContext = createServiceContext('person-a', 'org-techknight', 'readiness-delete-1');
    await service.deleteTask(replayTask.id, 1, deleteContext);

    await pool.query(
      `UPDATE canonical_task_readiness
       SET ready = FALSE, reason = 'integration readiness closed', updated_at = NOW()
       WHERE singleton_id = TRUE`,
    );

    const expected = { code: 'canonical_task_mutation_not_ready', status: 503 };
    await expect(service.createTask({
      title: 'blocked create',
      assignee_person_id: 'person-a',
      project_codes: ['project-112'],
    }, createServiceContext('person-a', 'org-techknight', 'readiness-blocked-create'))).rejects.toMatchObject(expected);
    await expect(service.createTask({
      title: 'Readiness replay task',
      assignee_person_id: 'person-a',
      project_codes: ['project-112'],
    }, createServiceContext('person-a', 'org-techknight', 'readiness-replay-1'))).rejects.toMatchObject(expected);
    await expect(service.updateTask(
      task.id,
      { title: 'blocked update' },
      1,
      createServiceContext('person-a', 'org-techknight', 'readiness-blocked-update'),
    )).rejects.toMatchObject(expected);
    await expect(service.transitionTask(
      task.id,
      'in_progress',
      1,
      createServiceContext('person-a', 'org-techknight', 'readiness-blocked-transition'),
    )).rejects.toMatchObject(expected);
    await expect(service.deleteTask(
      task.id,
      1,
      createServiceContext('person-a', 'org-techknight', 'readiness-blocked-delete'),
    )).rejects.toMatchObject(expected);

    await restoreReadiness();
  });
});
