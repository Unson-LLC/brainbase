import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { GraphMaintenanceService } from '../../../server/services/graph-maintenance-service.js';
import { InfoSSOTService } from '../../../server/services/info-ssot-service.js';
import { OntologyRegistry } from '../../../server/services/ontology-registry.js';

// VibePro traceability: story-graph-maintenance-phase0:ac:db-roundtrip,
// story-graph-maintenance-phase0:ac:schema-backfill.
//
// These tests are intentionally opt-in because they create and drop schemas on
// a real PostgreSQL instance. The command used for acceptance is:
// RUN_GRAPH_MAINTENANCE_DB_TESTS=true GRAPH_MAINTENANCE_DATABASE_URL=... \
//   npx vitest run tests/server/services/graph-maintenance-postgres.integration.test.js
const databaseUrl = process.env.GRAPH_MAINTENANCE_DATABASE_URL || process.env.INFO_SSOT_DATABASE_URL || '';
const runPostgresTests = process.env.RUN_GRAPH_MAINTENANCE_DB_TESTS === 'true';
const describeWithPostgres = runPostgresTests && databaseUrl ? describe : describe.skip;
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const schemaPath = path.join(sourceRoot, 'server/sql/info-ssot-schema.sql');

const access = {
    organizationId: 'org_phase0',
    personId: 'person_phase0',
    role: 'gm',
    projectCodes: ['brainbase'],
    clearance: ['internal', 'restricted', 'finance', 'hr', 'contract']
};

function scopedConnectionString(schema) {
    const option = encodeURIComponent(`-csearch_path=${schema}`);
    return `${databaseUrl}${databaseUrl.includes('?') ? '&' : '?'}options=${option}`;
}

async function createScopedDatabase(prefix) {
    const adminPool = new Pool({ connectionString: databaseUrl });
    const schema = `${prefix}_${process.pid}_${Date.now()}`;
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({ connectionString: scopedConnectionString(schema), max: 4 });
    return { adminPool, pool, schema };
}

async function dropScopedDatabase(database) {
    if (!database) return;
    const { adminPool, pool, schema } = database;
    await pool?.end();
    await adminPool?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await adminPool?.end();
}

async function applyInfoSSOTSchema(pool) {
    await pool.query(await readFile(schemaPath, 'utf8'));
}

describeWithPostgres('Graph maintenance PostgreSQL acceptance', () => {
    let database;
    let service;
    let initialSnapshot;

    beforeAll(async () => {
        database = await createScopedDatabase('gm_phase0');
        await applyInfoSSOTSchema(database.pool);
        await database.pool.query(`
            INSERT INTO projects (id, code, name, organization_id)
            VALUES ('project_phase0', 'brainbase', 'Brainbase', 'org_phase0');
            INSERT INTO graph_entities
                (id, entity_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
            VALUES
                ('project_entity_a', 'project', 'project_phase0', '{"name":"Before"}', 'member', 'internal', 'active', 1),
                ('project_entity_b', 'project', 'project_phase0', '{"name":"Target"}', 'member', 'internal', 'active', 1);
        `);
        // Pin this acceptance run to the repository's distributed trust anchor.
        // A runtime-injected signing key must not turn it into a false negative
        // when that key belongs to another environment.
        const ontologyRegistry = new OntologyRegistry({ rootDir: sourceRoot, publicKeyPem: '' });
        service = new GraphMaintenanceService({
            infoSSOTService: new InfoSSOTService({ pool: database.pool, ontologyRegistry })
        });
        initialSnapshot = await service.exportSnapshot(access, { projectCode: 'brainbase' });
    });

    afterAll(async () => {
        await dropScopedDatabase(database);
    });

    it('executes Snapshot → Dry Run → Apply → re-fetch → Validate → Rollback and restores the original rows', async () => {
        const plan = await service.planMutations(access, {
            projectCode: 'brainbase',
            snapshotId: initialSnapshot.snapshot_id,
            idempotencyKey: 'phase0-db-roundtrip-1',
            reason: 'Phase 0 PostgreSQL acceptance roundtrip',
            operations: [
                {
                    operation: 'patch_entity',
                    entity_id: 'project_entity_a',
                    expected_version: 1,
                    patch: { name: 'After' }
                },
                {
                    operation: 'upsert_edge',
                    from_id: 'project_entity_a',
                    to_id: 'project_entity_b',
                    rel_type: 'relates_to_project',
                    expected_version: 0,
                    payload: { source: 'phase0-db-roundtrip' }
                }
            ]
        });

        expect(plan.dry_run).toBe(true);
        expect(plan.snapshot_hash).toBe(initialSnapshot.snapshot_hash);
        expect(plan.after.entities.find((entity) => entity.id === 'project_entity_a')).toMatchObject({
            version: 2,
            payload: { name: 'After' }
        });
        expect(plan.after.edges).toHaveLength(1);

        const applyReceipt = await service.applyPlan(access, {
            projectCode: 'brainbase',
            planId: plan.plan_id,
            snapshotHash: plan.snapshot_hash
        });
        expect(applyReceipt).toMatchObject({
            plan_id: plan.plan_id,
            receipt_type: 'apply',
            status: 'completed',
            before_hash: initialSnapshot.snapshot_hash,
            after_hash: plan.after_snapshot_hash
        });

        const appliedSnapshot = await service.exportSnapshot(access, { projectCode: 'brainbase' });
        expect(appliedSnapshot.snapshot_hash).toBe(plan.after_snapshot_hash);
        expect(appliedSnapshot.entities.find((entity) => entity.id === 'project_entity_a')).toMatchObject({
            version: 2,
            payload: { name: 'After' }
        });
        expect(appliedSnapshot.edges).toHaveLength(1);
        await expect(service.validate(access, { projectCode: 'brainbase' })).resolves.toMatchObject({
            valid: true,
            ontology: { valid: true, verification: 'verified', ontology_version: '1.0.0' }
        });

        await expect(service.getPlanReceipt(access, {
            projectCode: 'brainbase',
            planId: plan.plan_id
        })).resolves.toMatchObject({
            plan_id: plan.plan_id,
            receipts: [expect.objectContaining({ receipt_type: 'apply', status: 'completed' })]
        });

        const rollbackReceipt = await service.rollbackPlan(access, {
            projectCode: 'brainbase',
            planId: plan.plan_id,
            applyReceiptId: applyReceipt.receipt_id
        });
        expect(rollbackReceipt).toMatchObject({
            plan_id: plan.plan_id,
            receipt_type: 'rollback',
            status: 'completed',
            before_hash: plan.after_snapshot_hash,
            after_hash: initialSnapshot.snapshot_hash
        });

        const restoredSnapshot = await service.exportSnapshot(access, { projectCode: 'brainbase' });
        expect(restoredSnapshot.snapshot_hash).toBe(initialSnapshot.snapshot_hash);
        expect(restoredSnapshot.entities).toEqual(initialSnapshot.entities);
        expect(restoredSnapshot.edges).toEqual(initialSnapshot.edges);
        await expect(service.validate(access, { projectCode: 'brainbase' })).resolves.toMatchObject({
            valid: true,
            ontology: { valid: true, verification: 'verified', ontology_version: '1.0.0' }
        });

        const { rows: receiptRows } = await database.pool.query(
            `SELECT receipt_type, before_hash, after_hash
             FROM graph_maintenance_receipts
             WHERE plan_id = $1
             ORDER BY receipt_type`,
            [plan.plan_id]
        );
        expect(receiptRows).toEqual([
            {
                receipt_type: 'apply',
                before_hash: initialSnapshot.snapshot_hash,
                after_hash: plan.after_snapshot_hash
            },
            {
                receipt_type: 'rollback',
                before_hash: plan.after_snapshot_hash,
                after_hash: initialSnapshot.snapshot_hash
            }
        ]);
    });
});

describeWithPostgres('Info SSOT schema migration compatibility', () => {
    let database;

    beforeAll(async () => {
        database = await createScopedDatabase('gm_phase0_schema');
        // Simulate the pre-Phase 0 Graph tables. The migration must add the
        // tenant and maintenance columns/tables without rewriting old rows.
        await database.pool.query(`
            CREATE TABLE organizations (
                id text PRIMARY KEY,
                name text NOT NULL,
                projects text[] NOT NULL DEFAULT ARRAY[]::text[]
            );
            CREATE TABLE projects (
                id text PRIMARY KEY,
                code text UNIQUE NOT NULL,
                name text NOT NULL
            );
            CREATE TABLE graph_entities (
                id text PRIMARY KEY,
                entity_type text NOT NULL,
                project_id text NOT NULL,
                payload jsonb NOT NULL DEFAULT '{}'::jsonb,
                role_min text NOT NULL,
                sensitivity text NOT NULL,
                created_at timestamptz NOT NULL DEFAULT NOW(),
                updated_at timestamptz NOT NULL DEFAULT NOW()
            );
            CREATE TABLE graph_edges (
                id text PRIMARY KEY,
                from_id text NOT NULL,
                to_id text NOT NULL,
                rel_type text NOT NULL,
                project_id text NOT NULL,
                payload jsonb NOT NULL DEFAULT '{}'::jsonb,
                role_min text NOT NULL,
                sensitivity text NOT NULL,
                created_at timestamptz NOT NULL DEFAULT NOW(),
                updated_at timestamptz NOT NULL DEFAULT NOW(),
                UNIQUE (from_id, to_id, rel_type)
            );
            INSERT INTO organizations (id, name, projects)
            VALUES
                ('org_legacy', 'Legacy owner', ARRAY['legacy']),
                ('org_ambiguous_a', 'Ambiguous A', ARRAY['ambiguous']),
                ('org_ambiguous_b', 'Ambiguous B', ARRAY['ambiguous']);
            INSERT INTO projects (id, code, name)
            VALUES
                ('legacy_project', 'legacy', 'Legacy project'),
                ('ambiguous_project', 'ambiguous', 'Ambiguous project');
            INSERT INTO graph_entities (id, entity_type, project_id, payload, role_min, sensitivity)
            VALUES ('legacy_entity', 'org', 'legacy_project', '{"name":"Legacy"}', 'member', 'internal');
        `);

        await applyInfoSSOTSchema(database.pool);
        // The schema is the migration contract and must be safe to re-apply.
        await applyInfoSSOTSchema(database.pool);
    });

    afterAll(async () => {
        await dropScopedDatabase(database);
    });

    it('adds Phase 0 columns/tables and backfills only unambiguous organization ownership', async () => {
        const { rows: projects } = await database.pool.query(
            `SELECT code, organization_id FROM projects ORDER BY code`
        );
        expect(projects).toEqual([
            { code: 'ambiguous', organization_id: null },
            { code: 'legacy', organization_id: 'org_legacy' }
        ]);

        const { rows: entityRows } = await database.pool.query(
            `SELECT lifecycle_status, version FROM graph_entities WHERE id = 'legacy_entity'`
        );
        expect(entityRows).toEqual([{ lifecycle_status: 'active', version: 1 }]);

        const { rows: maintenanceTables } = await database.pool.query(
            `SELECT table_name
             FROM information_schema.tables
             WHERE table_schema = current_schema()
               AND table_name LIKE 'graph_maintenance_%'
             ORDER BY table_name`
        );
        expect(maintenanceTables.map((row) => row.table_name)).toEqual([
            'graph_maintenance_human_gate_receipts',
            'graph_maintenance_plans',
            'graph_maintenance_receipts',
            'graph_maintenance_snapshots'
        ]);
    });
});
