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
const rlsPath = path.join(sourceRoot, 'server/sql/info-ssot-rls.sql');

const access = {
    organizationId: 'org_phase0',
    personId: 'person_phase0',
    authSource: 'bearer',
    role: 'gm',
    projectCodes: ['brainbase', 'vibepro'],
    clearance: ['internal', 'restricted', 'finance', 'hr', 'contract']
};

const crossTenantAccess = {
    ...access,
    role: 'ceo',
    authSource: 'bearer',
    projectCodes: ['brainbase', 'aitle']
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

async function applyInfoSSOTRls(pool) {
    await pool.query(await readFile(rlsPath, 'utf8'));
}

async function assertRlsEnforcedConnection(pool) {
    const { rows } = await pool.query(`
        SELECT r.rolsuper, r.rolbypassrls
        FROM pg_roles r
        WHERE r.rolname = current_user
    `);
    const role = rows[0];
    if (!role || role.rolsuper || role.rolbypassrls) {
        throw new Error(
            'Graph maintenance PostgreSQL acceptance requires a NOSUPERUSER, NOBYPASSRLS database role'
        );
    }
}

describeWithPostgres('Graph maintenance PostgreSQL acceptance', () => {
    let database;
    let service;
    let infoSSOTService;
    let initialSnapshot;

    beforeAll(async () => {
        database = await createScopedDatabase('gm_phase0');
        await assertRlsEnforcedConnection(database.pool);
        await applyInfoSSOTSchema(database.pool);
        await database.pool.query(`
            INSERT INTO people (id, name) VALUES ('person_ai_fixture', 'AI fixture');
            INSERT INTO projects (id, code, name, organization_id)
            VALUES
                ('project_phase0', 'brainbase', 'Brainbase', 'org_phase0'),
                ('project_vibepro', 'vibepro', 'VibePro', 'org_phase0'),
                ('project_aitle', 'aitle', 'Aitle', 'org_aitle');
            INSERT INTO graph_entities
                (id, entity_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
            VALUES
                ('decision_rehome', 'decision', 'project_phase0', '{"title":"Move to VibePro","status":"draft"}', 'member', 'internal', 'active', 1),
                ('decision_subject', 'decision', 'project_phase0', '{"title":"Aitle product decision","status":"draft"}', 'ceo', 'restricted', 'active', 1),
                ('project_phase0', 'project', 'project_phase0', '{"name":"Brainbase canonical project"}', 'member', 'internal', 'active', 1),
                ('project_entity_a', 'project', 'project_phase0', '{"name":"Brainbase"}', 'member', 'internal', 'active', 1),
                ('project_entity_b', 'project', 'project_phase0', '{"name":"Brainbase secondary fixture"}', 'member', 'internal', 'active', 1),
                ('project_vibepro_entity', 'project', 'project_vibepro', '{"name":"VibePro"}', 'member', 'internal', 'active', 1),
                ('project_vibepro_restricted', 'project', 'project_vibepro', '{"name":"Restricted VibePro"}', 'ceo', 'restricted', 'active', 1),
                ('person_ai_fixture', 'person', 'project_phase0', '{"name":"AI fixture"}', 'member', 'internal', 'active', 1),
                ('product_aitle', 'product', 'project_aitle', '{"name":"Aitle"}', 'ceo', 'restricted', 'active', 3);
            INSERT INTO graph_edges
                (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
            VALUES
                ('membership_brainbase', 'decision_rehome', 'project_entity_a', 'belongs_to_project',
                 'project_phase0', '{}', 'member', 'internal', 'active', 1),
                ('edge_restricted_endpoint', 'project_entity_a', 'project_vibepro_restricted', 'related_to',
                 'project_phase0', '{}', 'member', 'internal', 'active', 1);
            INSERT INTO graph_maintenance_snapshots
                (id, organization_id, project_id, snapshot_hash, snapshot, created_by)
            VALUES
                ('snapshot_receipt_scope_mismatch', 'org_phase0', 'project_phase0', 'receipt_scope_hash',
                 '{"project_code":"brainbase","entities":[],"edges":[]}', 'person_phase0');
            INSERT INTO graph_maintenance_plans
                (id, organization_id, project_id, snapshot_id, base_snapshot_hash, after_snapshot_hash,
                 idempotency_key, input_fingerprint, reason, operations, before_snapshot, after_snapshot,
                 status, created_by)
            VALUES
                ('plan_receipt_scope_mismatch', 'org_phase0', 'project_phase0',
                 'snapshot_receipt_scope_mismatch', 'receipt_scope_hash', 'receipt_scope_hash',
                 'receipt-scope-mismatch', 'receipt-scope-mismatch', 'Receipt scope fixture', '[]',
                 '{"project_code":"brainbase","entities":[],"edges":[]}',
                 '{"project_code":"brainbase","entities":[],"edges":[]}', 'applied', 'person_phase0');
            INSERT INTO graph_maintenance_receipts
                (id, plan_id, organization_id, project_id, receipt_type, status,
                 before_hash, after_hash, result, actor_id)
            VALUES
                ('apply_receipt_wrong_scope', 'plan_receipt_scope_mismatch', 'org_aitle', 'project_aitle',
                 'apply', 'completed', 'receipt_scope_hash', 'receipt_scope_hash', '{}', 'person_phase0');
        `);
        await applyInfoSSOTRls(database.pool);
        // Pin this acceptance run to the repository's distributed trust anchor.
        // A runtime-injected signing key must not turn it into a false negative
        // when that key belongs to another environment.
        const ontologyRegistry = new OntologyRegistry({ rootDir: sourceRoot, publicKeyPem: '' });
        infoSSOTService = new InfoSSOTService({ pool: database.pool, ontologyRegistry });
        service = new GraphMaintenanceService({ infoSSOTService });
        initialSnapshot = await service.exportSnapshot(access, {
            projectCode: 'brainbase', includeProjectCodes: ['vibepro']
        });
    });

    afterAll(async () => {
        await dropScopedDatabase(database);
    });

    it('tenantまたはprojectが不一致の既存Receiptは取得・Apply・Rollbackで返さない', async () => {
        await expect(service.getPlanReceipt(access, {
            projectCode: 'brainbase',
            planId: 'plan_receipt_scope_mismatch'
        })).rejects.toThrow('Plan receipt is required');

        await expect(service.applyPlan(access, {
            projectCode: 'brainbase',
            planId: 'plan_receipt_scope_mismatch',
            snapshotHash: 'receipt_scope_hash'
        })).rejects.toThrow('Plan is not applicable: applied');

        await expect(service.rollbackPlan(access, {
            projectCode: 'brainbase',
            planId: 'plan_receipt_scope_mismatch',
            applyReceiptId: 'apply_receipt_wrong_scope'
        })).rejects.toThrow('Valid apply receipt is required for rollback');
    });

    it('同一organizationのcross-project edgeは通常readから消さない', async () => {
        await infoSSOTService.withAccessContext(access, (client) => client.query(`
            INSERT INTO graph_edges
                (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
            VALUES
                ('edge_same_org_cross_project', 'project_entity_a', 'project_vibepro_entity', 'related_to',
                 'project_phase0', '{}', 'member', 'internal', 'active', 1)
        `));
        try {
            await expect(infoSSOTService.listGraphEdges(access, {
                projectCode: 'brainbase', relType: 'related_to'
            })).resolves.toEqual([
                expect.objectContaining({ id: 'edge_same_org_cross_project', to_id: 'project_vibepro_entity' })
            ]);
        } finally {
            await infoSSOTService.withAccessContext(access, (client) =>
                client.query(`DELETE FROM graph_edges WHERE id='edge_same_org_cross_project'`));
        }
    });

    it('RLSはendpoint EntityのroleとclearanceをEdge read/writeにも適用する', async () => {
        await expect(infoSSOTService.listGraphEdges(access, {
            projectCode: 'brainbase', relType: 'related_to', toId: 'project_vibepro_restricted'
        })).resolves.toEqual([]);

        const ceoBothScopes = { ...access, role: 'ceo' };
        await expect(infoSSOTService.listGraphEdges(ceoBothScopes, {
            projectCode: 'brainbase', relType: 'related_to', toId: 'project_vibepro_restricted'
        })).resolves.toEqual([
            expect.objectContaining({ id: 'edge_restricted_endpoint', to_id: 'project_vibepro_restricted' })
        ]);

        await expect(infoSSOTService.withAccessContext(
            { ...access, graphMaintenanceMode: true },
            (client) => client.query(`
                INSERT INTO graph_edges
                    (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
                VALUES
                    ('edge_rejected_restricted_endpoint', 'project_entity_b', 'project_vibepro_restricted', 'related_to',
                     'project_phase0', '{}', 'member', 'internal', 'active', 1)
            `)
        )).rejects.toMatchObject({ code: '42501' });
    });

    it('projectless Personは一意なactive member_ofのorganizationで通常readできる', async () => {
        await infoSSOTService.withAccessContext(access, async (client) => {
            await client.query(`
                INSERT INTO graph_entities
                    (id, entity_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
                VALUES
                    ('person_projectless', 'person', NULL, '{"name":"Projectless member"}', 'member', 'internal', 'active', 1)
            `);
            await client.query(`
                INSERT INTO graph_edges
                    (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
                VALUES
                    ('membership_projectless_person', 'person_projectless', 'project_entity_a', 'member_of',
                     'project_phase0', '{}', 'member', 'internal', 'active', 1)
            `);
            await client.query(`
                INSERT INTO graph_edges
                    (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
                VALUES
                    ('edge_projectless_person', 'person_projectless', 'project_entity_b', 'related_to',
                     'project_phase0', '{}', 'member', 'internal', 'active', 1)
            `);
        });
        try {
            await expect(infoSSOTService.listGraphEdges(access, {
                projectCode: 'brainbase', relType: 'related_to', fromId: 'person_projectless'
            })).resolves.toEqual([
                expect.objectContaining({ id: 'edge_projectless_person', from_id: 'person_projectless' })
            ]);
        } finally {
            await infoSSOTService.withAccessContext(access, async (client) => {
                await client.query(`DELETE FROM graph_edges WHERE id IN ('edge_projectless_person', 'membership_projectless_person')`);
                await client.query(`DELETE FROM graph_entities WHERE id='person_projectless'`);
            });
        }
    });

    it('projectless Personは不可視なmember_ofをorganization根拠として利用できない', async () => {
        const ceoAccess = { ...access, role: 'ceo' };
        await infoSSOTService.withAccessContext(ceoAccess, async (client) => {
            await client.query(`
                INSERT INTO graph_entities
                    (id, entity_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
                VALUES
                    ('person_projectless_restricted', 'person', NULL, '{"name":"Restricted projectless member"}',
                     'member', 'internal', 'active', 1)
            `);
            await client.query(`
                INSERT INTO graph_edges
                    (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
                VALUES
                    ('membership_projectless_restricted', 'person_projectless_restricted', 'project_entity_a', 'member_of',
                     'project_phase0', '{}', 'ceo', 'restricted', 'active', 1)
            `);
            await client.query(`
                INSERT INTO graph_edges
                    (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
                VALUES
                    ('edge_projectless_restricted', 'person_projectless_restricted', 'project_entity_b', 'related_to',
                     'project_phase0', '{}', 'member', 'internal', 'active', 1)
            `);
        });
        try {
            await expect(infoSSOTService.listGraphEdges(access, {
                projectCode: 'brainbase', relType: 'related_to', fromId: 'person_projectless_restricted'
            })).resolves.toEqual([]);
            await expect(infoSSOTService.listGraphEdges(ceoAccess, {
                projectCode: 'brainbase', relType: 'related_to', fromId: 'person_projectless_restricted'
            })).resolves.toEqual([
                expect.objectContaining({ id: 'edge_projectless_restricted', from_id: 'person_projectless_restricted' })
            ]);
        } finally {
            await infoSSOTService.withAccessContext(ceoAccess, async (client) => {
                await client.query(`DELETE FROM graph_edges WHERE id IN ('edge_projectless_restricted', 'membership_projectless_restricted')`);
                await client.query(`DELETE FROM graph_entities WHERE id='person_projectless_restricted'`);
            });
        }
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

        expect(plan.apply_human_gate_scope).toMatchObject({
            operation: 'apply_plan', decision_id: 'decision_rehome', plan_id: plan.plan_id
        });
        await expect(service.applyPlan(access, {
            projectCode: 'brainbase', planId: plan.plan_id, snapshotHash: plan.snapshot_hash
        })).rejects.toMatchObject({ code: 'GRAPH_APPLY_HUMAN_GATE_REQUIRED', status: 403 });
        const applyGate = await service.recordHumanGateReceipt(access, {
            projectCode: 'brainbase', decisionId: 'decision_rehome', receiptId: 'gate_apply_rehome_1',
            evidence: { operation_scope: plan.apply_human_gate_scope }
        });

        const applyReceipt = await service.applyPlan(access, {
            projectCode: 'brainbase',
            planId: plan.plan_id,
            snapshotHash: plan.snapshot_hash,
            humanGateReceipt: applyGate.receipt_id
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

    it('cross-tenant Decision subjectをHuman Gate付きでApplyしRollbackする', async () => {
        const baseline = await service.exportSnapshot(crossTenantAccess, { projectCode: 'brainbase' });
        const operation = {
            operation: 'link_decision_subject',
            decision_id: 'decision_subject',
            decision_expected_version: 1,
            subject_entity_id: 'product_aitle',
            subject_expected_version: 3,
            target_project_code: 'aitle',
            expected_version: 0
        };
        const gate = await service.recordHumanGateReceipt(crossTenantAccess, {
            projectCode: 'brainbase',
            decisionId: 'decision_subject',
            receiptId: 'gate_cross_tenant_subject_1',
            evidence: { operation_scope: operation }
        });
        expect(gate).toMatchObject({
            receipt_id: 'gate_cross_tenant_subject_1',
            decision_id: 'decision_subject',
            status: 'approved'
        });

        const plan = await service.planMutations(crossTenantAccess, {
            projectCode: 'brainbase',
            snapshotId: baseline.snapshot_id,
            idempotencyKey: 'cross-tenant-subject-db-roundtrip-1',
            reason: 'Cross-tenant Decision subject PostgreSQL acceptance',
            humanGateReceipt: gate.receipt_id,
            operations: [operation]
        });
        expect(plan.before.external_entities).toEqual([expect.objectContaining({
            id: 'product_aitle', project_code: 'aitle', version: 3
        })]);
        expect(plan.after.edges).toEqual(expect.arrayContaining([expect.objectContaining({
            from_id: 'decision_subject',
            to_id: 'product_aitle',
            rel_type: 'governs',
            project_code: 'brainbase',
            role_min: 'ceo',
            sensitivity: 'restricted',
            lifecycle_status: 'active',
            version: 1
        })]));

        await expect(service.applyPlan(crossTenantAccess, {
            projectCode: 'brainbase', planId: plan.plan_id, snapshotHash: plan.snapshot_hash
        })).rejects.toMatchObject({ code: 'GRAPH_APPLY_HUMAN_GATE_REQUIRED', status: 403 });
        await expect(service.applyPlan({ ...crossTenantAccess, authSource: 'service-token' }, {
            projectCode: 'brainbase', planId: plan.plan_id, snapshotHash: plan.snapshot_hash,
            humanGateReceipt: gate.receipt_id
        })).rejects.toThrow('signed human Bearer principal');
        await expect(service.applyPlan(crossTenantAccess, {
            projectCode: 'brainbase', planId: plan.plan_id, snapshotHash: plan.snapshot_hash,
            humanGateReceipt: gate.receipt_id
        })).rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_SCOPE_MISMATCH', status: 409 });
        const applyGate = await service.recordHumanGateReceipt(crossTenantAccess, {
            projectCode: 'brainbase',
            decisionId: 'decision_subject',
            receiptId: 'gate_apply_cross_tenant_subject_1',
            evidence: { operation_scope: plan.apply_human_gate_scope }
        });

        const applied = await service.applyPlan(crossTenantAccess, {
            projectCode: 'brainbase', planId: plan.plan_id, snapshotHash: plan.snapshot_hash,
            humanGateReceipt: applyGate.receipt_id
        });
        expect(applied).toMatchObject({ receipt_type: 'apply', status: 'completed', after_hash: plan.after_snapshot_hash });
        await expect(service.applyPlan({ ...crossTenantAccess, authSource: 'service-token' }, {
            projectCode: 'brainbase', planId: plan.plan_id, snapshotHash: plan.snapshot_hash,
            humanGateReceipt: applyGate.receipt_id
        })).resolves.toEqual(applied);
        await expect(service.applyPlan(crossTenantAccess, {
            projectCode: 'brainbase', planId: plan.plan_id, snapshotHash: plan.snapshot_hash
        })).resolves.toEqual(applied);
        await expect(service.applyPlan(crossTenantAccess, {
            projectCode: 'brainbase', planId: plan.plan_id, snapshotHash: plan.snapshot_hash,
            humanGateReceipt: gate.receipt_id
        })).resolves.toEqual(applied);
        await expect(service.applyPlan(crossTenantAccess, {
            projectCode: 'brainbase', planId: plan.plan_id, snapshotHash: plan.snapshot_hash,
            humanGateReceipt: applyGate.receipt_id
        })).resolves.toEqual(applied);
        const readback = await service.exportSnapshot(crossTenantAccess, { projectCode: 'brainbase' });
        expect(readback.snapshot_hash).toBe(plan.after_snapshot_hash);
        expect(readback.edges).toEqual(expect.arrayContaining([expect.objectContaining({
            from_id: 'decision_subject', to_id: 'product_aitle', rel_type: 'governs'
        })]));
        await expect(service.validate(crossTenantAccess, { projectCode: 'brainbase' })).resolves.toMatchObject({
            valid: true,
            ontology: { valid: true, verification: 'verified', ontology_version: '1.1.0' }
        });
        const edgeQuery = { projectCode: 'brainbase', relType: 'governs' };
        const sourceOnly = { ...crossTenantAccess, projectCodes: ['brainbase'] };
        const targetOnly = { ...crossTenantAccess, projectCodes: ['aitle'] };
        const gmBothScopes = { ...crossTenantAccess, role: 'gm' };
        const sourceOnlySnapshot = await service.exportSnapshot(sourceOnly, { projectCode: 'brainbase' });
        const gmSnapshot = await service.exportSnapshot(gmBothScopes, { projectCode: 'brainbase' });
        expect(sourceOnlySnapshot.edges).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ from_id: 'decision_subject', to_id: 'product_aitle' })
        ]));
        expect(gmSnapshot.edges).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ from_id: 'decision_subject', to_id: 'product_aitle' })
        ]));
        expect(JSON.stringify(sourceOnlySnapshot)).not.toContain('product_aitle');
        expect(JSON.stringify(gmSnapshot)).not.toContain('product_aitle');
        await expect(service.validate(sourceOnly, { projectCode: 'brainbase' })).resolves.toMatchObject({ valid: true });
        await expect(service.validate(gmBothScopes, { projectCode: 'brainbase' })).resolves.toMatchObject({ valid: true });
        await expect(infoSSOTService.listGraphEdges(crossTenantAccess, edgeQuery)).resolves.toEqual([
            expect.objectContaining({ from_id: 'decision_subject', to_id: 'product_aitle', rel_type: 'governs' })
        ]);
        await expect(infoSSOTService.listGraphEdges(sourceOnly, edgeQuery)).resolves.toEqual([]);
        await expect(infoSSOTService.listGraphEdges(targetOnly, edgeQuery)).resolves.toEqual([]);
        await expect(infoSSOTService.listGraphEdges(gmBothScopes, edgeQuery)).resolves.toEqual([]);
        const publicReadMatrix = [
            [crossTenantAccess, 1],
            [sourceOnly, 0],
            [targetOnly, 0],
            [gmBothScopes, 0]
        ];
        for (const [caller, expectedCount] of publicReadMatrix) {
            const context = await infoSSOTService.getContext(caller, {
                projectCode: 'brainbase', entityTypes: 'decision,product',
                includeEdges: true, humanReadable: true
            });
            const governsEdges = context.edges.filter((edge) => edge.rel_type === 'governs');
            expect(governsEdges).toHaveLength(expectedCount);
            if (expectedCount) {
                expect(governsEdges[0]).toMatchObject({ from_id: 'decision_subject', to_id: 'product_aitle' });
                expect(context.report.relations).toContain('Aitle product decision -[governs]-> Aitle');
            } else {
                expect(JSON.stringify(context)).not.toContain('product_aitle');
            }

        }
        const sourceOnlyExpansion = await infoSSOTService.expandGraph(sourceOnly, {
            projectCode: 'brainbase', seedId: 'decision_subject', depth: 1, humanReadable: true
        });
        expect(sourceOnlyExpansion.edges).toEqual([]);
        expect(JSON.stringify(sourceOnlyExpansion)).not.toContain('product_aitle');
        const bothScopeAudit = await infoSSOTService.auditOntology(crossTenantAccess);
        expect(bothScopeAudit).toMatchObject({ valid: true, completeness: { status: 'complete' } });
        expect(bothScopeAudit.completeness.edge_count).toBeGreaterThanOrEqual(1);
        const sourceOnlyAudit = await infoSSOTService.auditOntology(sourceOnly);
        expect(sourceOnlyAudit).toMatchObject({ valid: true, completeness: { status: 'complete', edge_count: 1 } });
        expect(JSON.stringify(sourceOnlyAudit)).not.toContain('product_aitle');
        const targetOnlyAudit = await infoSSOTService.auditOntology(targetOnly);
        expect(targetOnlyAudit).toMatchObject({ valid: true, completeness: { status: 'complete', edge_count: 0 } });
        const gmAudit = await infoSSOTService.auditOntology(gmBothScopes);
        expect(gmAudit).toMatchObject({ valid: true, completeness: { status: 'complete', edge_count: 1 } });
        expect(JSON.stringify(gmAudit)).not.toContain('product_aitle');
        await expect(service.getPlanReceipt(crossTenantAccess, {
            projectCode: 'brainbase', planId: plan.plan_id
        })).resolves.toMatchObject({
            receipts: [expect.objectContaining({ receipt_type: 'apply', status: 'completed' })]
        });

        const rolledBack = await service.rollbackPlan(crossTenantAccess, {
            projectCode: 'brainbase', planId: plan.plan_id, applyReceiptId: applied.receipt_id
        });
        expect(rolledBack).toMatchObject({ receipt_type: 'rollback', status: 'completed', after_hash: plan.snapshot_hash });
        const restored = await service.exportSnapshot(crossTenantAccess, { projectCode: 'brainbase' });
        expect(restored.entities).toEqual(baseline.entities);
        expect(restored.edges).toEqual(baseline.edges);
        expect(restored.edges.some((edge) => edge.from_id === 'decision_subject' && edge.rel_type === 'governs')).toBe(false);

        const drifted = await service.exportSnapshot(crossTenantAccess, { projectCode: 'brainbase' });
        await infoSSOTService.withAccessContext(crossTenantAccess, (client) =>
            client.query(`UPDATE graph_entities SET version=4 WHERE id='product_aitle'`));
        await expect(service.planMutations(crossTenantAccess, {
            projectCode: 'brainbase',
            snapshotId: drifted.snapshot_id,
            idempotencyKey: 'cross-tenant-subject-version-drift-1',
            reason: 'External endpoint drift must fail closed',
            humanGateReceipt: gate.receipt_id,
            operations: [operation]
        })).rejects.toThrow('expected_version conflict');
    });

    it('maintenance modeでもendpoint未解決Edgeの作成を拒否する', async () => {
        await expect(infoSSOTService.withAccessContext(
            { ...access, graphMaintenanceMode: true },
            (client) => client.query(`
                INSERT INTO graph_edges
                    (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
                VALUES
                    ('edge_rejected_orphan', 'project_entity_a', 'missing_entity', 'legacy_reference',
                     'project_phase0', '{}', 'member', 'internal', 'active', 1)
            `)
        )).rejects.toMatchObject({ code: '42501' });

        const { rows } = await database.pool.query(
            `SELECT id FROM graph_edges WHERE id='edge_rejected_orphan'`
        );
        expect(rows).toEqual([]);
    });

    it('cross-tenant governs Edgeはsource Decisionのproject owner以外へ保存できない', async () => {
        const rejectedEdgeId = 'edge_cross_tenant_wrong_owner_insert';
        const edgePayload = '{"cross_tenant":true,"target_project_code":"aitle"}';

        await expect(infoSSOTService.withAccessContext(crossTenantAccess, (client) => client.query(`
            INSERT INTO graph_edges
                (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
            VALUES
                ($1, 'decision_subject', 'product_aitle', 'governs',
                 'project_aitle', $2::jsonb, 'ceo', 'restricted', 'active', 1)
        `, [rejectedEdgeId, edgePayload]))).rejects.toMatchObject({ code: '42501' });

        await expect(infoSSOTService.withAccessContext(crossTenantAccess, (client) => client.query(
            `SELECT id FROM graph_edges WHERE id=$1`, [rejectedEdgeId]
        ))).resolves.toMatchObject({ rows: [] });

        const persistedEdgeId = 'edge_cross_tenant_wrong_owner_update';
        await infoSSOTService.withAccessContext(crossTenantAccess, (client) => client.query(`
            INSERT INTO graph_edges
                (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
            VALUES
                ($1, 'decision_subject', 'product_aitle', 'governs',
                 'project_phase0', $2::jsonb, 'ceo', 'restricted', 'active', 1)
        `, [persistedEdgeId, edgePayload]));
        try {
            await expect(infoSSOTService.withAccessContext(crossTenantAccess, (client) => client.query(`
                UPDATE graph_edges
                SET project_id='project_aitle'
                WHERE id=$1
            `, [persistedEdgeId]))).rejects.toMatchObject({ code: '42501' });

            await expect(infoSSOTService.withAccessContext(crossTenantAccess, (client) => client.query(
                `SELECT project_id FROM graph_edges WHERE id=$1`, [persistedEdgeId]
            ))).resolves.toMatchObject({ rows: [{ project_id: 'project_phase0' }] });
        } finally {
            await infoSSOTService.withAccessContext(crossTenantAccess, (client) => client.query(
                `DELETE FROM graph_edges WHERE id=$1`, [persistedEdgeId]
            ));
        }
    });

    it('AI query公開面は実DBで越境Edgeの存在とtarget IDをscope外へ漏らさない', async () => {
        await infoSSOTService.withAccessContext(crossTenantAccess, (client) => client.query(`
            INSERT INTO graph_edges
                (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, lifecycle_status, version)
            VALUES
                ('edge_ai_query_subject', 'decision_subject', 'product_aitle', 'governs',
                 'project_phase0', '{"cross_tenant":true,"target_project_code":"aitle"}',
                 'ceo', 'restricted', 'active', 1)
        `));
        const sourceOnly = { ...crossTenantAccess, projectCodes: ['brainbase'] };
        const targetOnly = { ...crossTenantAccess, projectCodes: ['aitle'] };
        const gmBothScopes = { ...crossTenantAccess, role: 'gm' };
        for (const [caller, expectedCount] of [[crossTenantAccess, 1], [sourceOnly, 0], [gmBothScopes, 0]]) {
            const query = await infoSSOTService.createAiQuery(caller, {
                projectCode: 'brainbase', actorPersonId: 'person_ai_fixture',
                queryType: 'edges', relType: 'governs', roleMin: 'member', sensitivity: 'internal',
                humanReadable: true
            });
            expect(query.records).toHaveLength(expectedCount);
            if (expectedCount) {
                expect(query.records[0]).toMatchObject({ from_id: 'decision_subject', to_id: 'product_aitle' });
                expect(query.summary_lines).toEqual(['Aitle product decision -[governs]-> Aitle']);
            } else {
                expect(JSON.stringify(query)).not.toContain('product_aitle');
            }
        }
        await expect(infoSSOTService.createAiQuery(targetOnly, {
            projectCode: 'brainbase', actorPersonId: 'person_ai_fixture',
            queryType: 'edges', relType: 'governs', roleMin: 'member', sensitivity: 'internal',
            humanReadable: true
        })).rejects.toThrow('Access denied for project: brainbase');
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
