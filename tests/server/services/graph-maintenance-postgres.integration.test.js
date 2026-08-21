import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { GraphMaintenanceService } from '../../../server/services/graph-maintenance-service.js';
import { validateGraphSnapshot } from '../../../server/services/graph-maintenance-engine.js';
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
    projectCodes: ['brainbase', 'vibepro'],
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
            VALUES
                ('project_phase0', 'brainbase', 'Brainbase', 'org_phase0'),
                ('project_vibepro', 'vibepro', 'VibePro', 'org_phase0');
            INSERT INTO graph_entities
                (id, entity_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
            VALUES
                ('decision_rehome', 'decision', 'project_phase0', '{"title":"Move to VibePro","status":"draft"}', 'member', 'internal', 'active', 1),
                ('project_entity_a', 'project', 'project_phase0', '{"name":"Brainbase"}', 'member', 'internal', 'active', 1),
                ('project_entity_b', 'project', 'project_phase0', '{"name":"Brainbase secondary fixture"}', 'member', 'internal', 'active', 1),
                ('project_vibepro_entity', 'project', 'project_vibepro', '{"name":"VibePro"}', 'member', 'internal', 'active', 1);
            INSERT INTO graph_edges
                (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
            VALUES
                ('membership_brainbase', 'decision_rehome', 'project_entity_a', 'belongs_to_project',
                 'project_phase0', '{}', 'member', 'internal', 'active', 1);
        `);
        // Pin this acceptance run to the repository's distributed trust anchor.
        // A runtime-injected signing key must not turn it into a false negative
        // when that key belongs to another environment.
        const ontologyRegistry = new OntologyRegistry({ rootDir: sourceRoot, publicKeyPem: '' });
        service = new GraphMaintenanceService({
            infoSSOTService: new InfoSSOTService({ pool: database.pool, ontologyRegistry })
        });
        initialSnapshot = await service.exportSnapshot(access, {
            projectCode: 'brainbase', includeProjectCodes: ['vibepro']
        });
    });

    afterAll(async () => {
        await dropScopedDatabase(database);
    });

    it('複合scope rehomeをApplyしRollbackで全rowsを復元する', async () => {
        const plan = await service.planMutations(access, {
            projectCode: 'brainbase',
            snapshotId: initialSnapshot.snapshot_id,
            idempotencyKey: 'phase0-db-roundtrip-1',
            reason: 'Phase 0 PostgreSQL acceptance roundtrip',
            operations: [
                {
                    operation: 'rehome_entity',
                    entity_id: 'decision_rehome',
                    expected_version: 1,
                    target_project_code: 'vibepro',
                    target_project_entity_id: 'project_vibepro_entity',
                    target_project_expected_version: 1,
                    membership_edge_id: 'membership_brainbase',
                    membership_expected_version: 1,
                    new_membership_expected_version: 0
                }
            ]
        });

        expect(plan.dry_run).toBe(true);
        expect(plan.snapshot_hash).toBe(initialSnapshot.snapshot_hash);
        expect(plan.after.entities.find((entity) => entity.id === 'decision_rehome')).toMatchObject({
            project_code: 'vibepro',
            version: 2
        });
        expect(plan.after.edges.find((edge) => edge.id === 'membership_brainbase')).toMatchObject({
            project_code: 'brainbase',
            lifecycle_status: 'retired',
            version: 2
        });
        expect(plan.after.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({
                from_id: 'decision_rehome',
                to_id: 'project_vibepro_entity',
                project_code: 'vibepro',
                lifecycle_status: 'active',
                version: 1
            })
        ]));

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

        const appliedSnapshot = await service.exportSnapshot(access, {
            projectCode: 'brainbase', includeProjectCodes: ['vibepro']
        });
        expect(appliedSnapshot.snapshot_hash).toBe(plan.after_snapshot_hash);
        expect(appliedSnapshot.entities.find((entity) => entity.id === 'decision_rehome')).toMatchObject({
            project_code: 'vibepro',
            version: 2
        });
        expect(appliedSnapshot.edges).toHaveLength(2);
        await expect(service.validate(access, { projectCode: 'brainbase', includeProjectCodes: ['vibepro'] })).resolves.toMatchObject({
            valid: true,
            ontology: { valid: true, verification: 'verified', ontology_version: '1.1.0' }
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

        const restoredSnapshot = await service.exportSnapshot(access, {
            projectCode: 'brainbase', includeProjectCodes: ['vibepro']
        });
        expect(restoredSnapshot.snapshot_hash).toBe(initialSnapshot.snapshot_hash);
        expect(restoredSnapshot.entities).toEqual(initialSnapshot.entities);
        expect(restoredSnapshot.edges).toEqual(initialSnapshot.edges);
        await expect(service.validate(access, { projectCode: 'brainbase' })).resolves.toMatchObject({
            valid: true,
            ontology: { valid: true, verification: 'verified', ontology_version: '1.1.0' }
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

    it('keeps an existing orphan unchanged while Apply and Rollback complete', async () => {
        await database.pool.query(`
            INSERT INTO graph_edges
                (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
            VALUES
                ('edge_existing_orphan', 'project_entity_a', 'missing_entity', 'legacy_reference',
                 'project_phase0', '{}', 'member', 'internal', 'active', 1)
        `);
        try {
            const baseline = await service.exportSnapshot(access, { projectCode: 'brainbase' });
            const plan = await service.planMutations(access, {
                projectCode: 'brainbase',
                snapshotId: baseline.snapshot_id,
                idempotencyKey: 'phase0-existing-orphan-roundtrip-1',
                reason: 'Existing orphan must not block an unrelated safe maintenance mutation',
                operations: [{
                    operation: 'patch_entity',
                    entity_id: 'project_entity_b',
                    expected_version: 1,
                    patch: { existing_orphan_roundtrip: true }
                }]
            });

            const applyReceipt = await service.applyPlan(access, {
                projectCode: 'brainbase', planId: plan.plan_id, snapshotHash: plan.snapshot_hash
            });
            expect(applyReceipt).toMatchObject({ receipt_type: 'apply', after_hash: plan.after_snapshot_hash });
            const applied = await service.exportSnapshot(access, { projectCode: 'brainbase' });
            expect(applied.snapshot_hash).toBe(plan.after_snapshot_hash);
            expect(validateGraphSnapshot(applied).issues).toEqual([{ category: 'orphan', id: 'edge_existing_orphan' }]);

            const rollbackReceipt = await service.rollbackPlan(access, {
                projectCode: 'brainbase', planId: plan.plan_id, applyReceiptId: applyReceipt.receipt_id
            });
            expect(rollbackReceipt).toMatchObject({ receipt_type: 'rollback', after_hash: baseline.snapshot_hash });
            const restored = await service.exportSnapshot(access, { projectCode: 'brainbase' });
            expect(restored.snapshot_hash).toBe(baseline.snapshot_hash);
            expect(validateGraphSnapshot(restored).issues).toEqual([{ category: 'orphan', id: 'edge_existing_orphan' }]);
        } finally {
            await database.pool.query(`DELETE FROM graph_edges WHERE id='edge_existing_orphan'`);
        }
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
                ('org_ambiguous_b', 'Ambiguous B', ARRAY['ambiguous']),
                ('unson', 'Unson', ARRAY[]::text[]),
                ('techknight', 'Tech Knight', ARRAY[]::text[]);
            INSERT INTO projects (id, code, name)
            VALUES
                ('legacy_project', 'legacy', 'Legacy project'),
                ('ambiguous_project', 'ambiguous', 'Ambiguous project'),
                ('unson_project', 'unson', 'Unson project'),
                ('aitle_project', 'aitle', 'Aitle project'),
                ('unknown_project', 'unknown', 'Unknown project');
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

    it('承認済みtenant mappingだけを冪等に適用する', async () => {
        const { rows: projects } = await database.pool.query(
            `SELECT code, organization_id FROM projects ORDER BY code`
        );
        expect(projects).toEqual([
            { code: 'aitle', organization_id: 'techknight' },
            { code: 'ambiguous', organization_id: null },
            { code: 'legacy', organization_id: 'org_legacy' },
            { code: 'unknown', organization_id: null },
            { code: 'unson', organization_id: 'unson' }
        ]);

        const { rows: approvedMemberships } = await database.pool.query(
            `SELECT id, projects FROM organizations WHERE id IN ('techknight', 'unson') ORDER BY id`
        );
        expect(approvedMemberships).toEqual([
            { id: 'techknight', projects: ['aitle'] },
            { id: 'unson', projects: ['unson'] }
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
