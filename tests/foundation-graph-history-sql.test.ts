import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = resolve(repoRoot, 'contracts/foundation/graph-history.sql');
const migration = await readFile(migrationPath, 'utf8');

type TestDb = InstanceType<typeof PGlite>;

const foundation = (
  type: 'objective' | 'variable' | 'model' | 'constraint',
  id: string,
  revision: string,
  projectId: string,
  overrides: Record<string, unknown> = {}
) => {
  const base = {
    id,
    type,
    revision,
    meaning: `${type} meaning`,
    adoptionState: 'draft',
    authorizedUses: ['draft'],
    acl: { ownerId: 'person-a', visibility: 'project', readerIds: [], writerIds: [] },
    storage: 'candidate',
    provenance: [],
    scope: { subjectIds: [projectId], validFrom: '2026-01-01' },
  };
  if (type === 'objective') {
    return {
      ...base,
      beneficiaryIds: ['person-a'],
      desiredState: 'desired',
      criteria: [],
      evaluationPeriod: { from: '2026-01-01', until: '2026-12-31' },
      ...overrides,
    };
  }
  if (type === 'variable') {
    return {
      ...base,
      subject: 'subject',
      valueKind: 'number',
      aggregation: 'sum',
      granularity: 'week',
      measurementMethod: 'counter',
      ...overrides,
    };
  }
  if (type === 'model') {
    return {
      ...base,
      epistemicState: 'hypothesis',
      inputVariableRefs: [],
      outputVariableRefs: [],
      applicability: { subjectIds: [projectId], validFrom: '2026-01-01' },
      relationship: 'relationship',
      uncertainty: 'unknown',
      validationState: 'unverified',
      ...overrides,
    };
  }
  return {
    ...base,
    condition: 'condition',
    appliesTo: [],
    exceptions: [],
    adoptionBasis: [],
    ...overrides,
  };
};

const philosophy = (id: string, projectId: string, meaning = 'philosophy') => ({
  meaning,
  judgmentApplicability: {
    scope: { type: 'project', id: projectId },
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
  },
});

const row = (
  id: string,
  entityType: string,
  projectId: string,
  payload: unknown,
  lifecycleStatus = 'active',
  roleMin = 'reader'
) => ({
  id,
  entityType,
  projectId,
  payload: JSON.stringify(payload),
  roleMin,
  sensitivity: 'normal',
  lifecycleStatus,
  version: 1,
});

let db: TestDb | undefined;
const TEST_TIMEOUT_MS = 30_000;

const query = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []) => {
  if (!db) throw new Error('test database is not initialized');
  return db.query<T>(sql, values);
};

const setRuntimeProject = async (projectId: string) => {
  await query('RESET ROLE');
  await query('SET ROLE app_runtime');
  await query("SELECT set_config('app.project_id', $1, false)", [projectId]);
};

const setOwner = async () => {
  await query('RESET ROLE');
};

const createDatabase = async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE public.graph_entities (
      id text PRIMARY KEY,
      entity_type text NOT NULL,
      project_id text,
      payload jsonb,
      role_min text,
      sensitivity text,
      lifecycle_status text,
      version integer NOT NULL DEFAULT 1
    );
    CREATE ROLE app_runtime NOLOGIN;
    CREATE ROLE brainbase_app NOLOGIN;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.graph_entities TO app_runtime;
    ALTER TABLE public.graph_entities ENABLE ROW LEVEL SECURITY;
    CREATE POLICY graph_entities_runtime_access ON public.graph_entities
      FOR ALL
      USING (
        lifecycle_status = 'active'
        AND project_id = current_setting('app.project_id', true)
      )
      WITH CHECK (project_id = current_setting('app.project_id', true));
  `);

  const initialRows = [
    row(
      'objective-1',
      'objective',
      'project-a',
      { foundation: foundation('objective', 'objective-1', '3', 'project-a') }
    ),
    row('philosophy-1', 'philosophy', 'project-a', philosophy('philosophy-1', 'project-a')),
    row('variable-b', 'variable', 'project-b', { foundation: foundation('variable', 'variable-b', '1', 'project-b') }),
    row('inactive-objective', 'objective', 'project-a', {
      foundation: foundation('objective', 'inactive-objective', '1', 'project-a'),
    }, 'inactive'),
  ];
  for (const initial of initialRows) {
    await query(
      `INSERT INTO public.graph_entities
        (id, entity_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
      [
        initial.id,
        initial.entityType,
        initial.projectId,
        initial.payload,
        initial.roleMin,
        initial.sensitivity,
        initial.lifecycleStatus,
        initial.version,
      ]
    );
  }
  await db.exec(migration);
  await query('GRANT SELECT ON public.graph_foundation_revisions TO app_runtime');
};

afterEach(async () => {
  if (db) await db.close();
  db = undefined;
});

describe('canonical Graph Foundation history SQL', () => {
  it('backfills one current snapshot, uses SQL jsonb storage digest, and is idempotent', { timeout: TEST_TIMEOUT_MS }, async () => {
    await createDatabase();

    const initial = await query<{ entity_id: string; entity_type: string; revision: string; storage_digest: string }>(
      `SELECT entity_id, entity_type, revision, storage_digest
       FROM public.graph_foundation_revisions
       ORDER BY entity_id, entity_type, revision`
    );
    expect(initial.rows.map(({ entity_id, entity_type, revision }) => `${entity_type}/${entity_id}@${revision}`)).toEqual([
      'objective/inactive-objective@1',
      'objective/objective-1@3',
      'philosophy/philosophy-1@1',
      'variable/variable-b@1',
    ]);
    expect(initial.rows.every(({ storage_digest }) => /^sha256:[0-9a-f]{64}$/u.test(storage_digest))).toBe(true);

    const canonicalRuntimeGrant = await query<{ granted: boolean }>(
      `SELECT has_table_privilege('brainbase_app', 'public.graph_foundation_revisions', 'SELECT') AS granted`
    );
    expect(canonicalRuntimeGrant.rows[0]?.granted).toBe(true);
    const canonicalRuntimeWriteGrant = await query<{ granted: boolean }>(
      `SELECT has_table_privilege('brainbase_app', 'public.graph_foundation_revisions', 'INSERT') AS granted`
    );
    expect(canonicalRuntimeWriteGrant.rows[0]?.granted).toBe(false);
    const canonicalRuntimeTruncateGrant = await query<{ granted: boolean }>(
      `SELECT has_table_privilege('brainbase_app', 'public.graph_foundation_revisions', 'TRUNCATE') AS granted`
    );
    expect(canonicalRuntimeTruncateGrant.rows[0]?.granted).toBe(false);
    const canonicalRuntimeAppendGrant = await query<{ granted: boolean }>(
      `SELECT has_function_privilege(
         'brainbase_app',
         'public.append_graph_foundation_revision(text,text,text,jsonb,text,text,text,text,boolean)',
         'EXECUTE'
       ) AS granted`
    );
    expect(canonicalRuntimeAppendGrant.rows[0]?.granted).toBe(false);

    const rlsMode = await query<{ enabled: boolean; forced: boolean }>(
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
       FROM pg_catalog.pg_class
       WHERE oid = 'public.graph_foundation_revisions'::regclass`
    );
    expect(rlsMode.rows[0]).toEqual({ enabled: true, forced: false });

    const triggerNames = await query<{ tgname: string }>(
      `SELECT tgname
       FROM pg_catalog.pg_trigger
       WHERE tgrelid IN ('public.graph_entities'::regclass, 'public.graph_foundation_revisions'::regclass)
         AND NOT tgisinternal
       ORDER BY tgname`
    );
    expect(triggerNames.rows.map(({ tgname }) => tgname)).toEqual([
      'graph_entities_foundation_history_capture',
      'graph_foundation_revisions_guard',
      'graph_foundation_revisions_truncate_guard',
    ]);

    const digestReadback = await query<{ matches: boolean }>(
      `SELECT bool_and(storage_digest = 'sha256:' || encode(sha256(convert_to(payload::text, 'UTF8')), 'hex')) AS matches
       FROM public.graph_foundation_revisions`
    );
    expect(digestReadback.rows[0]?.matches).toBe(true);

    const beforeRerun = await query<{ count: string }>(
      'SELECT count(*)::text AS count FROM public.graph_foundation_revisions'
    );
    await query('RESET ROLE');
    await db!.exec(migration);
    const afterRerun = await query<{ count: string }>(
      'SELECT count(*)::text AS count FROM public.graph_foundation_revisions'
    );
    expect(afterRerun.rows[0]?.count).toBe(beforeRerun.rows[0]?.count);
  });

  it('captures writer updates, rejects skipped/reused Foundation revisions, and advances philosophy independently', { timeout: TEST_TIMEOUT_MS }, async () => {
    await createDatabase();
    await setRuntimeProject('project-a');

    const noOpBefore = await query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.graph_foundation_revisions
       WHERE entity_id = 'objective-1'`
    );
    await query(`UPDATE public.graph_entities SET version = version + 1 WHERE id = 'objective-1'`);
    const noOpAfter = await query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.graph_foundation_revisions
       WHERE entity_id = 'objective-1'`
    );
    expect(noOpAfter.rows[0]?.count).toBe(noOpBefore.rows[0]?.count);

    const revision4 = { foundation: foundation('objective', 'objective-1', '4', 'project-a', { meaning: 'changed' }) };
    await query('UPDATE public.graph_entities SET payload = $1::jsonb WHERE id = $2', [JSON.stringify(revision4), 'objective-1']);

    const metadataOnly = await query<{ payload: unknown }>(
      `SELECT payload FROM public.graph_entities WHERE id = 'objective-1'`
    );
    const revision5 = {
      foundation: foundation('objective', 'objective-1', '5', 'project-a', { meaning: 'metadata revision' }),
    };
    await expect(
      query(`UPDATE public.graph_entities SET role_min = 'admin' WHERE id = 'objective-1'`)
    ).rejects.toThrow(/GRAPH_FOUNDATION_HISTORY_REVISION_SEQUENCE/u);
    expect(metadataOnly.rows[0]?.payload).toBeDefined();

    await query(
      `UPDATE public.graph_entities SET payload = $1::jsonb, role_min = 'admin' WHERE id = $2`,
      [JSON.stringify(revision5), 'objective-1']
    );
    await expect(
      query('UPDATE public.graph_entities SET payload = $1::jsonb WHERE id = $2', [
        JSON.stringify({ foundation: foundation('objective', 'objective-1', '7', 'project-a') }),
        'objective-1',
      ])
    ).rejects.toThrow(/GRAPH_FOUNDATION_HISTORY_REVISION_SEQUENCE/u);
    await expect(
      query('UPDATE public.graph_entities SET payload = $1::jsonb WHERE id = $2', [
        JSON.stringify({ foundation: foundation('objective', 'objective-1', '5', 'project-a', { meaning: 'reused' }) }),
        'objective-1',
      ])
    ).rejects.toThrow(/GRAPH_FOUNDATION_HISTORY_REVISION_SEQUENCE/u);

    const philosophy2 = philosophy('philosophy-1', 'project-a', 'updated philosophy');
    await query('UPDATE public.graph_entities SET payload = $1::jsonb WHERE id = $2', [JSON.stringify(philosophy2), 'philosophy-1']);
    await query(`DELETE FROM public.graph_entities WHERE id = 'philosophy-1'`);
    await setOwner();
    await expect(
      query(`SELECT count(*)::text AS count FROM public.graph_foundation_revisions WHERE entity_id = 'philosophy-1'`)
    ).resolves.toMatchObject({ rows: [{ count: '2' }] });
    await query(
      `INSERT INTO public.graph_entities
        (id, entity_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
       VALUES ('philosophy-1', 'philosophy', 'project-a', $1::jsonb, 'reader', 'normal', 'active', 1)`,
      [JSON.stringify(philosophy('philosophy-1', 'project-a', 'recreated philosophy'))]
    );

    const revisions = await query<{ entity_type: string; revision: string }>(
      `SELECT entity_type, revision
       FROM public.graph_foundation_revisions
       WHERE entity_id IN ('objective-1', 'philosophy-1')
       ORDER BY entity_id, revision::numeric`
    );
    expect(revisions.rows).toEqual([
      { entity_type: 'objective', revision: '3' },
      { entity_type: 'objective', revision: '4' },
      { entity_type: 'objective', revision: '5' },
      { entity_type: 'philosophy', revision: '1' },
      { entity_type: 'philosophy', revision: '2' },
      { entity_type: 'philosophy', revision: '3' },
    ]);

    await query(`DELETE FROM public.graph_entities WHERE id = 'objective-1'`);
    await expect(
      query(
        `INSERT INTO public.graph_entities
          (id, entity_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
         VALUES ('objective-1', 'objective', 'project-a', $1::jsonb, 'reader', 'normal', 'active', 1)`,
        [JSON.stringify({ foundation: foundation('objective', 'objective-1', '1', 'project-a') })]
      )
    ).rejects.toThrow(/GRAPH_FOUNDATION_HISTORY_REVISION_SEQUENCE/u);
  });

  it('uses current Graph RLS and active state for historical reads, and rejects digest corruption', { timeout: TEST_TIMEOUT_MS }, async () => {
    await createDatabase();
    await setRuntimeProject('project-a');

    const projectA = await query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.graph_foundation_revisions
       WHERE entity_id = 'objective-1'`
    );
    expect(projectA.rows[0]?.count).toBe('1');

    await setRuntimeProject('project-b');
    const projectB = await query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.graph_foundation_revisions
       WHERE entity_id = 'objective-1'`
    );
    expect(projectB.rows[0]?.count).toBe('0');

    await setOwner();
    await query(
      `UPDATE public.graph_entities
       SET payload = $1::jsonb, lifecycle_status = 'inactive'
       WHERE id = 'objective-1'`,
      [JSON.stringify({ foundation: foundation('objective', 'objective-1', '4', 'project-a', { meaning: 'retired' }) })]
    );
    await setRuntimeProject('project-a');
    const inactive = await query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.graph_foundation_revisions
       WHERE entity_id = 'objective-1'`
    );
    expect(inactive.rows[0]?.count).toBe('0');

    await setOwner();
    await query(`ALTER TABLE public.graph_foundation_revisions DISABLE TRIGGER graph_foundation_revisions_guard`);
    await expect(
      query(
        `UPDATE public.graph_foundation_revisions
         SET storage_digest = $1
         WHERE entity_id = 'philosophy-1' AND revision = '1'`,
        [`sha256:${'0'.repeat(64)}`]
      )
    ).rejects.toThrow(/graph_foundation_revisions_storage_digest_check/u);
    await query(`ALTER TABLE public.graph_foundation_revisions ENABLE TRIGGER graph_foundation_revisions_guard`);
    await setRuntimeProject('project-a');
    const corrupted = await query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.graph_foundation_revisions
       WHERE entity_id = 'philosophy-1'`
    );
    expect(corrupted.rows[0]?.count).toBe('1');
  });

  it('rejects direct history writes and rejects incomplete or mismatched Foundation payloads', { timeout: TEST_TIMEOUT_MS }, async () => {
    await createDatabase();
    await setOwner();

    await expect(
      query(
        `INSERT INTO public.graph_foundation_revisions
          (entity_id, entity_type, revision, payload, lifecycle_status, storage_digest)
         VALUES ('direct', 'philosophy', '1', '{}'::jsonb, 'active', $1)`,
        [`sha256:${'0'.repeat(64)}`]
      )
    ).rejects.toThrow(/GRAPH_FOUNDATION_HISTORY_DIRECT_INSERT_FORBIDDEN/u);
    await expect(
      query(`UPDATE public.graph_foundation_revisions SET lifecycle_status = 'inactive' WHERE entity_id = 'objective-1'`)
    ).rejects.toThrow(/GRAPH_FOUNDATION_HISTORY_APPEND_ONLY/u);
    await expect(
      query(`DELETE FROM public.graph_foundation_revisions WHERE entity_id = 'objective-1'`)
    ).rejects.toThrow(/GRAPH_FOUNDATION_HISTORY_APPEND_ONLY/u);
    await expect(
      query('TRUNCATE public.graph_foundation_revisions')
    ).rejects.toThrow(/GRAPH_FOUNDATION_HISTORY_APPEND_ONLY/u);

    await setRuntimeProject('project-a');
    await expect(
      query(
        `INSERT INTO public.graph_foundation_revisions
          (entity_id, entity_type, revision, payload, lifecycle_status, storage_digest)
         VALUES ('direct-runtime', 'philosophy', '1', '{}'::jsonb, 'active', $1)`,
        [`sha256:${'0'.repeat(64)}`]
      )
    ).rejects.toThrow(/permission denied|GRAPH_FOUNDATION_HISTORY_DIRECT_INSERT_FORBIDDEN/u);

    await setOwner();
    await expect(
      query(
        `INSERT INTO public.graph_entities
          (id, entity_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
         VALUES ('incomplete', 'objective', 'project-a', '{"foundation":{"id":"incomplete","type":"objective","revision":"1"}}'::jsonb, 'reader', 'normal', 'active', 1)`
      )
    ).rejects.toThrow(/GRAPH_FOUNDATION_HISTORY_FOUNDATION_FIELD_REQUIRED/u);
    await expect(
      query(
        `INSERT INTO public.graph_entities
          (id, entity_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
         VALUES ('mismatched', 'objective', 'project-a', $1::jsonb, 'reader', 'normal', 'active', 1)`,
        [JSON.stringify({ foundation: foundation('objective', 'different-id', '1', 'project-a') })]
      )
    ).rejects.toThrow(/GRAPH_FOUNDATION_HISTORY_FOUNDATION_ID_MISMATCH/u);

    const digest = createHash('sha256').update('{}', 'utf8').digest('hex');
    expect(digest).toMatch(/^[0-9a-f]{64}$/u);
  });
});
