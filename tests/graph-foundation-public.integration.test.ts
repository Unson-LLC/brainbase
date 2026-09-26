import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createGraphFoundationReaders,
  type GraphFoundationHistoryRow,
  type GraphFoundationQuery
} from '../src/graph-foundation-reader.js';
import { createFoundationHttpRouter } from '../src/foundation-http.js';
import { createFoundationPublicProvider, createFoundationPublicRoute } from '../src/foundation-public-provider.js';
import { digestFoundationDefinition } from '../src/foundation-catalog.js';
import { philosophyRevisionDigest } from '../src/philosophy-revision-reader.js';
import type { FoundationStoreContext } from '../src/foundation-store.js';
import type { ObjectiveDefinition, VariableDefinition } from '../src/ontology-foundation.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migration = await readFile(resolve(repoRoot, 'contracts/foundation/graph-history.sql'), 'utf8');
type TestDb = InstanceType<typeof PGlite>;

const VALID_FROM = '2026-01-01T00:00:00.000Z';
const VALID_UNTIL = '2026-12-31T23:59:59.000Z';
const CONTEXT: FoundationStoreContext = {
  principal: 'bob',
  scope: {
    subjectIds: ['project-a'],
    validFrom: VALID_FROM,
    validUntil: VALID_UNTIL
  }
};

let db: TestDb | undefined;

afterEach(async () => {
  if (db) await db.close();
  db = undefined;
});

function variable(
  revision: string,
  overrides: Partial<VariableDefinition> = {}
): VariableDefinition {
  return {
    id: 'load',
    type: 'variable',
    revision,
    meaning: 'Weekly operating load',
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation'],
    acl: { ownerId: 'alice', visibility: 'private', readerIds: ['bob'], writerIds: [] },
    storage: 'ontology',
    provenance: [{ sourceId: 'spec-load', sourceKind: 'document', evidenceIds: [] }],
    scope: { subjectIds: ['project-a'], validFrom: VALID_FROM, validUntil: VALID_UNTIL },
    subject: 'project-a',
    valueKind: 'number',
    unit: 'minutes',
    aggregation: 'sum',
    granularity: 'week',
    measurementMethod: 'Recorded operating minutes',
    ...overrides
  };
}

function objective(): ObjectiveDefinition {
  return {
    id: 'goal',
    type: 'objective',
    revision: '1',
    meaning: 'Keep the weekly operating load within a sustainable range',
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation'],
    acl: { ownerId: 'alice', visibility: 'private', readerIds: ['bob'], writerIds: [] },
    storage: 'ontology',
    provenance: [{ sourceId: 'spec-goal', sourceKind: 'document', evidenceIds: [] }],
    scope: { subjectIds: ['project-a'], validFrom: VALID_FROM, validUntil: VALID_UNTIL },
    beneficiaryIds: ['project-a'],
    desiredState: 'Weekly operating load stays at or below the target',
    criteria: [{ variableRef: { id: 'load', type: 'variable', revision: '1' }, operator: 'at_most', target: 600 }],
    evaluationPeriod: { from: VALID_FROM, until: VALID_UNTIL }
  };
}

function philosophyPayload(statement: string, projectId = 'project-a'): Record<string, unknown> {
  return {
    statement,
    judgmentApplicability: {
      scope: { type: 'project', id: projectId },
      validFrom: VALID_FROM,
      validUntil: VALID_UNTIL
    }
  };
}

function graphPayload(value: unknown): string {
  return JSON.stringify(value);
}

async function sql<T extends Record<string, unknown> = Record<string, unknown>>(
  statement: string,
  values: readonly unknown[] = []
): Promise<{ readonly rows: T[] }> {
  if (!db) throw new Error('test database is not initialized');
  return db.query<T>(statement, [...values]);
}

async function setRuntimeProject(projectId: string): Promise<void> {
  await sql('RESET ROLE');
  await sql('SET ROLE app_runtime');
  await sql("SELECT set_config('app.project_id', $1, false)", [projectId]);
  await sql("SELECT set_config('app.principal', $1, false)", [CONTEXT.principal]);
}

async function setOwner(): Promise<void> {
  await sql('RESET ROLE');
}

async function createDatabase(): Promise<void> {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE public.projects (
      id text PRIMARY KEY,
      code text NOT NULL UNIQUE
    );
    CREATE TABLE public.graph_entities (
      id text PRIMARY KEY,
      entity_type text NOT NULL,
      project_id text,
      payload jsonb NOT NULL,
      role_min text,
      sensitivity text,
      lifecycle_status text,
      version integer NOT NULL DEFAULT 1
    );
    CREATE ROLE app_runtime NOLOGIN;
    GRANT SELECT ON public.projects TO app_runtime;
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

  await sql(`INSERT INTO public.projects (id, code) VALUES ('project-a', 'project-a'), ('project-b', 'project-b')`);
  const initialRows = [
    {
      id: 'load',
      type: 'variable',
      projectId: 'project-a',
      payload: { foundation: variable('1') }
    },
    {
      id: 'goal',
      type: 'objective',
      projectId: 'project-a',
      payload: { foundation: objective() }
    },
    {
      id: 'principle',
      type: 'philosophy',
      projectId: 'project-a',
      payload: philosophyPayload('Prefer sustainable continued use')
    }
  ];
  for (const row of initialRows) {
    await sql(
      `INSERT INTO public.graph_entities
        (id, entity_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
       VALUES ($1, $2, $3, $4::jsonb, 'reader', 'normal', 'active', 1)`,
      [row.id, row.type, row.projectId, graphPayload(row.payload)]
    );
  }

  await sql('BEGIN');
  try {
    await db!.exec(migration);
    await sql('COMMIT');
  } catch (error) {
    await sql('ROLLBACK');
    throw error;
  }
  await sql('GRANT SELECT ON public.graph_foundation_revisions TO app_runtime');
}

function createPublicRouter() {
  if (!db) throw new Error('test database is not initialized');
  const query: GraphFoundationQuery = async (text, values) => {
    const result = await sql<GraphFoundationHistoryRow & Record<string, unknown>>(text, values);
    return { rows: result.rows as readonly GraphFoundationHistoryRow[] };
  };
  const readers = createGraphFoundationReaders({ context: CONTEXT, query });
  const provider = createFoundationPublicProvider(readers);
  const router = createFoundationHttpRouter({
    routes: [createFoundationPublicRoute(provider)],
    resolveContext: () => CONTEXT,
    csrf: { verify: () => true }
  });
  return { router, provider };
}

async function getDefinition(
  router: ReturnType<typeof createPublicRouter>['router'],
  type: string,
  id: string,
  revision: string,
  digest?: string
): Promise<{ readonly response: Response; readonly body: any }> {
  const query = new URLSearchParams({ revision });
  if (digest) query.set('digest', digest);
  const response = await router.handle(new Request(
    `https://local/api/foundation/definitions/${encodeURIComponent(type)}/${encodeURIComponent(id)}?${query}`
  ));
  return { response, body: await response.json() };
}

describe('Graph foundation history through the public provider and HTTP boundary', () => {
  it('reads exact Foundation and philosophy revisions, then rechecks current Graph access', async () => {
    await createDatabase();

    const initialHistory = await sql<{ entity_id: string; entity_type: string; revision: string }>(
      `SELECT entity_id, entity_type, revision
       FROM public.graph_foundation_revisions
       ORDER BY entity_type, entity_id, revision::numeric`
    );
    expect(initialHistory.rows.map((row) => `${row.entity_type}/${row.entity_id}@${row.revision}`)).toEqual([
      'objective/goal@1',
      'philosophy/principle@1',
      'variable/load@1'
    ]);

    await setRuntimeProject('project-a');
    const { router } = createPublicRouter();
    const variableV1 = variable('1');
    const objectiveV1 = objective();
    const philosophyV1 = philosophyPayload('Prefer sustainable continued use');
    const variableDigest = digestFoundationDefinition(variableV1);
    const objectiveDigest = digestFoundationDefinition(objectiveV1);
    const philosophyApplicability = philosophyV1.judgmentApplicability as {
      scope: { type: 'project'; id: string };
      validFrom: string;
      validUntil: string;
    };
    const philosophyDigest = philosophyRevisionDigest({
      kind: 'philosophy',
      id: 'principle',
      revision: '1',
      payload: philosophyV1,
      applicability: philosophyApplicability
    });

    const exactFoundation = await getDefinition(router, 'variable', 'load', '1', variableDigest);
    expect(exactFoundation.response.status).toBe(200);
    expect(exactFoundation.body).toEqual({ definition: variableV1, digest: variableDigest });

    const exactObjective = await getDefinition(router, 'objective', 'goal', '1', objectiveDigest);
    expect(exactObjective.response.status).toBe(200);
    expect(exactObjective.body).toEqual({ definition: objectiveV1, digest: objectiveDigest });

    const objectiveValidation = await router.handle(new Request(
      'https://local/api/foundation/judgment-references/validate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reference: {
            kind: 'objective',
            id: 'goal',
            revision: '1',
            digest: objectiveDigest,
            scope: { type: 'project', id: 'project-a' },
            valid_from: VALID_FROM,
            valid_to: VALID_UNTIL
          },
          phase: 'read'
        })
      }
    ));
    expect(objectiveValidation.status).toBe(200);
    expect(await objectiveValidation.json()).toEqual({ status: 'resolved', digest: objectiveDigest });

    const exactPhilosophy = await getDefinition(router, 'philosophy', 'principle', '1');
    expect(exactPhilosophy.response.status).toBe(200);
    expect(exactPhilosophy.body).toMatchObject({
      kind: 'philosophy',
      id: 'principle',
      revision: '1',
      digest: philosophyDigest,
      payload: philosophyV1,
      applicability: philosophyApplicability,
      currentAcl: { ownerId: CONTEXT.principal, visibility: 'private', readerIds: [], writerIds: [] },
      currentScope: philosophyApplicability.scope
    });

    const historyDigest = await sql<{ storage_digest_valid: boolean }>(
      `SELECT storage_digest_valid
       FROM (
         SELECT storage_digest = 'sha256:' || encode(sha256(convert_to(payload::text, 'UTF8')), 'hex') AS storage_digest_valid
         FROM public.graph_foundation_revisions
         WHERE entity_id = 'load' AND entity_type = 'variable' AND revision = '1'
       ) AS checked`
    );
    expect(historyDigest.rows).toEqual([{ storage_digest_valid: true }]);

    await setOwner();
    await sql(
      `UPDATE public.graph_entities
       SET payload = $1::jsonb
       WHERE id = 'load'`,
      [graphPayload({ foundation: variable('2', { meaning: 'Updated weekly operating load' }) })]
    );
    await sql(
      `UPDATE public.graph_entities
       SET payload = $1::jsonb
       WHERE id = 'principle'`,
      [graphPayload(philosophyPayload('Prefer sustainable continued use, even after adoption'))]
    );
    await setRuntimeProject('project-a');

    const oldVariableAfterUpdate = await getDefinition(router, 'variable', 'load', '1', variableDigest);
    expect(oldVariableAfterUpdate.response.status).toBe(200);
    expect(oldVariableAfterUpdate.body.definition).toEqual(variableV1);

    const oldPhilosophyAfterUpdate = await getDefinition(router, 'philosophy', 'principle', '1');
    expect(oldPhilosophyAfterUpdate.response.status).toBe(200);
    expect(oldPhilosophyAfterUpdate.body.payload).toEqual(philosophyV1);
    expect(oldPhilosophyAfterUpdate.body.digest).toBe(philosophyDigest);

    await setOwner();
    await sql(
      `UPDATE public.graph_entities
       SET payload = $1::jsonb
       WHERE id = 'load'`,
      [graphPayload({
        foundation: variable('3', {
          meaning: 'Revoked reader access',
          acl: { ownerId: 'alice', visibility: 'private', readerIds: [], writerIds: [] }
        })
      })]
    );
    await setRuntimeProject('project-a');
    const revokedVariable = await getDefinition(router, 'variable', 'load', '1', variableDigest);
    expect(revokedVariable.response.status).toBe(403);
    expect(revokedVariable.body.error.code).toBe('authorization_denied');

    await setOwner();
    await sql(
      `UPDATE public.graph_entities
       SET project_id = 'project-b', payload = $1::jsonb
       WHERE id = 'load'`,
      [graphPayload({
        foundation: variable('4', {
          meaning: 'Moved outside the trusted project',
          scope: { subjectIds: ['project-b'], validFrom: VALID_FROM, validUntil: VALID_UNTIL },
          acl: { ownerId: 'alice', visibility: 'private', readerIds: ['bob'], writerIds: [] }
        })
      })]
    );
    await setRuntimeProject('project-a');
    const hiddenMovedVariable = await getDefinition(router, 'variable', 'load', '1', variableDigest);
    expect(hiddenMovedVariable.response.status).toBe(404);

    await setOwner();
    await sql(
      `UPDATE public.graph_entities
       SET project_id = 'project-b', payload = $1::jsonb
       WHERE id = 'principle'`,
      [graphPayload(philosophyPayload('Moved outside the trusted project', 'project-b'))]
    );
    await setRuntimeProject('project-b');
    const scopeDeniedPhilosophy = await getDefinition(router, 'philosophy', 'principle', '1');
    expect(scopeDeniedPhilosophy.response.status).toBe(403);
    expect(scopeDeniedPhilosophy.body.error.code).toBe('authorization_denied');
  }, 30_000);
});
