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
 * This suite is skipped unless an explicit local PostgreSQL URL is provided.
 * The repository's normal package suite does not provision PostgreSQL. Run
 * this suite only against a disposable local test database, for example:
 *
 *   CANONICAL_TASK_PG_TEST_URL=postgres://... npm run test:canonical-task-postgres
 */
const connectionString = process.env.CANONICAL_TASK_PG_TEST_URL;
const postgresIntegrationEnabled = Boolean(connectionString);
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

let adminPool: Pool;
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
    adminPool = new Pool({ connectionString });
    await adminPool.query(`CREATE SCHEMA ${quotedSchemaName}`);
    pool = new Pool({
      connectionString,
      max: 4,
      options: `-c search_path=${quotedSchemaName},public`,
    });
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
    await pool?.end();
    await adminPool?.query(`DROP SCHEMA IF EXISTS ${quotedSchemaName} CASCADE`).catch(() => undefined);
    await adminPool?.end();
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
