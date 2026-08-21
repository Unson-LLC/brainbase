import { describe, expect, it, vi } from 'vitest';
import { GraphMaintenanceService } from '../../../server/services/graph-maintenance-service.js';
import { hashGraphSnapshot } from '../../../server/services/graph-maintenance-engine.js';

const service = new GraphMaintenanceService({ infoSSOTService: {} });

describe('GraphMaintenanceService authorization', () => {
    it('署名tenant、project scope、gm以上を必須にする', () => {
        expect(() => service.assertMaintenanceAccess({ role: 'gm', projectCodes: ['brainbase'] }, 'brainbase'))
            .toThrow('Signed tenant authorization');
        expect(() => service.assertMaintenanceAccess({ role: 'gm', projectCodes: ['other'], organizationId: 'org_1' }, 'brainbase'))
            .toThrow('Access denied for project');
        expect(() => service.assertMaintenanceAccess({ role: 'member', projectCodes: ['brainbase'], organizationId: 'org_1' }, 'brainbase'))
            .toThrow('requires gm or ceo');
        expect(() => service.assertMaintenanceAccess({ role: 'gm', projectCodes: ['brainbase'], organizationId: 'org_1' }, 'brainbase'))
            .not.toThrow();
    });

    it('replaceSnapshotは別tenantのedge IDを上書きしない', async () => {
        const snapshot = {
            project_code: 'brainbase',
            entities: [
                { id: 'entity_a', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 },
                { id: 'entity_b', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }
            ],
            edges: [{ id: 'edge_owned_by_other_tenant', from_id: 'entity_a', to_id: 'entity_b', rel_type: 'knows', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }]
        };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('SELECT id, code FROM projects')) return { rows: [{ id: 'project_brainbase', code: 'brainbase' }] };
            if (sql.includes('SELECT id FROM graph_entities')) return { rows: [] };
            if (sql.includes('SELECT id FROM graph_edges')) return { rows: [{ id: 'edge_owned_by_other_tenant' }] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        await expect(service.replaceSnapshot(client, {
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm'
        }, snapshot)).rejects.toThrow('edge id tenant conflict');
        expect(client.query).toHaveBeenCalledTimes(3);
    });

    it('replaceSnapshotは既存のorphanを増やさない変更を許容する', async () => {
        const before = {
            project_code: 'brainbase',
            entities: [{ id: 'entity_a', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }],
            edges: [{ id: 'edge_orphan', from_id: 'entity_a', to_id: 'missing_entity', rel_type: 'knows', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }]
        };
        const after = structuredClone(before);
        after.entities[0].lifecycle_status = 'retired';
        after.entities[0].version = 2;
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('SELECT id, code FROM projects')) return { rows: [{ id: 'project_brainbase', code: 'brainbase' }] };
            if (sql.includes('SELECT id FROM graph_entities') || sql.includes('SELECT id FROM graph_edges')) return { rows: [] };
            if (sql.includes('INSERT INTO graph_entities') || sql.includes('INSERT INTO graph_edges')) return { rowCount: 1, rows: [] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        await expect(service.replaceSnapshot(client, {
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm'
        }, after, { baseline: before })).resolves.toBeUndefined();
        expect(client.query).toHaveBeenCalledTimes(5);
    });

    it('rejects a stored plan snapshot whose content no longer matches its hash before mutation', async () => {
        const before = {
            project_code: 'brainbase',
            entities: [{ id: 'entity_a', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }],
            edges: []
        };
        before.hash = hashGraphSnapshot(before);
        const after = structuredClone(before);
        after.entities[0].version = 2;
        after.hash = hashGraphSnapshot(after);
        const plan = {
            id: 'plan_tampered', project_id: 'project_brainbase', organization_id: 'org_1', project_code: 'brainbase', status: 'planned',
            base_snapshot_hash: before.hash, after_snapshot_hash: after.hash,
            before_snapshot: before, after_snapshot: structuredClone(after)
        };
        plan.after_snapshot.entities[0].payload.tampered = true;
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('FROM graph_maintenance_plans')) return { rows: [plan] };
            if (sql.includes('FROM graph_maintenance_receipts')) return { rows: [] };
            throw new Error(`mutation query must not run: ${sql}`);
        }) };
        const tamperService = new GraphMaintenanceService({ infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) } });
        await expect(tamperService.applyPlan({ organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm' }, {
            projectCode: 'brainbase', planId: 'plan_tampered', snapshotHash: before.hash
        })).rejects.toThrow('stored plan snapshot hash mismatch');
        expect(client.query).toHaveBeenCalledTimes(2);
    });

    it('rejects an introduced orphan that is absent from the immutable baseline', async () => {
        const before = {
            project_code: 'brainbase',
            entities: [{ id: 'entity_a', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }],
            edges: []
        };
        const image = structuredClone(before);
        image.edges.push({ id: 'edge_new_orphan', from_id: 'entity_a', to_id: 'missing_new', rel_type: 'knows', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 });
        const client = { query: vi.fn() };
        await expect(service.loadSnapshotImage(client, { organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm' }, image, {
            baseline: before
        })).rejects.toThrow('Graph snapshot image is invalid: orphan');
        expect(client.query).not.toHaveBeenCalled();
    });

    it('rejects a missing planned row during baseline-relative readback', async () => {
        const image = {
            project_code: 'brainbase',
            entities: [
                { id: 'entity_a', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 },
                { id: 'entity_b', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }
            ],
            edges: []
        };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('SELECT id, code FROM projects')) return { rows: [{ id: 'project_brainbase', code: 'brainbase' }] };
            if (sql.includes('SELECT ge.id, ge.entity_type')) return { rows: [image.entities[0]] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        await expect(service.loadSnapshotImage(client, { organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm' }, image, {
            baseline: image
        })).rejects.toThrow('Graph snapshot image contains missing or inaccessible records');
    });

    it('keeps strict validation when no immutable baseline is supplied', async () => {
        const invalid = {
            project_code: 'brainbase',
            entities: [{ id: 'entity_a', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }],
            edges: [{ id: 'edge_orphan', from_id: 'entity_a', to_id: 'missing_entity', rel_type: 'knows', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }]
        };
        const client = { query: vi.fn() };
        await expect(service.replaceSnapshot(client, { organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm' }, invalid))
            .rejects.toThrow('Graph snapshot is invalid: orphan');
        expect(client.query).not.toHaveBeenCalled();
    });

    it('複合scope snapshotは全project accessとorganization一致を要求する', async () => {
        const rowsByCode = {
            brainbase: { id: 'project_brainbase', code: 'brainbase', organization_id: 'org_1' },
            vibepro: { id: 'project_vibepro', code: 'vibepro', organization_id: 'org_1' }
        };
        const client = { query: vi.fn(async (sql, params) => {
            if (sql.includes('SELECT id, code, organization_id FROM projects')) {
                return { rows: rowsByCode[params[0]] ? [rowsByCode[params[0]]] : [] };
            }
            if (sql.includes('SELECT ge.id, ge.entity_type')) return { rows: [
                { id: 'decision_1', entity_type: 'decision', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 },
                { id: 'project_vibepro_entity', entity_type: 'project', project_code: 'vibepro', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }
            ] };
            if (sql.includes('SELECT gx.id, gx.from_id')) return { rows: [] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const multiScopeService = new GraphMaintenanceService({ infoSSOTService: {} });
        const access = { organizationId: 'org_1', projectCodes: ['brainbase', 'vibepro'], role: 'gm' };
        const { snapshot } = await multiScopeService.loadSnapshot(client, access, 'brainbase', {
            includeProjectCodes: ['vibepro', 'vibepro']
        });
        expect(snapshot.entities.map((entity) => entity.project_code)).toEqual(['brainbase', 'vibepro']);
        const entityQuery = client.query.mock.calls.find(([sql]) => sql.includes('SELECT ge.id, ge.entity_type'));
        expect(entityQuery?.[1]).toEqual([['project_brainbase', 'project_vibepro']]);

        await expect(multiScopeService.loadSnapshot(client, {
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm'
        }, 'brainbase', { includeProjectCodes: ['vibepro'] })).rejects.toThrow('Access denied for project: vibepro');
    });

    it('Human Gate receiptは署名Bearerの人間principalからのみ供給できる', async () => {
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('SELECT id, code, organization_id FROM projects')) return { rows: [{ id: 'project_brainbase', code: 'brainbase', organization_id: 'org_1' }] };
            if (sql.includes("entity_type='decision'")) return { rows: [{ id: 'decision_1' }] };
            if (sql.includes('INSERT INTO graph_maintenance_human_gate_receipts')) return { rows: [{
                receipt_id: 'gate_1', organization_id: 'org_1', project_id: 'project_brainbase', decision_id: 'decision_1',
                status: 'approved', approved_by: 'person_1', approved_at: '2026-08-21T00:00:00.000Z', evidence: { source: 'human-review' }
            }] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const withAccessContext = vi.fn(async (_access, callback) => callback(client));
        const humanGateService = new GraphMaintenanceService({ infoSSOTService: { withAccessContext } });
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'service-token', personId: 'svc_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_1', evidence: {} })).rejects
            .toThrow('signed human Bearer principal');
        const receipt = await humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_1', evidence: { source: 'human-review' } });
        expect(receipt).toMatchObject({ receipt_id: 'gate_1', status: 'approved', decision_id: 'decision_1' });
        expect(withAccessContext).toHaveBeenCalledTimes(1);
    });

    it('rollbackはafter imageで新規作成されたedgeだけをorg/project限定で消し、残存を検出する', async () => {
        const before = {
            project_code: 'brainbase',
            entities: [
                { id: 'entity_a', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 },
                { id: 'entity_b', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }
            ], edges: []
        };
        before.hash = hashGraphSnapshot(before);
        const after = structuredClone(before);
        after.edges = [{ id: 'edge_created', from_id: 'entity_a', to_id: 'entity_b', rel_type: 'knows', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }];
        after.hash = hashGraphSnapshot(after);
        const plan = {
            id: 'plan_1', project_id: 'project_brainbase', organization_id: 'org_1', project_code: 'brainbase', status: 'applied',
            operations: [], reason: 'rollback test', idempotency_key: 'rollback-1', base_snapshot_hash: before.hash,
            after_snapshot_hash: after.hash, before_snapshot: before, after_snapshot: after
        };
        let edgeExists = true;
        const client = { query: vi.fn(async (sql, params) => {
            if (sql.includes('FROM graph_maintenance_plans')) return { rows: [plan] };
            if (sql.includes('FROM graph_maintenance_receipts')) {
                return params[1] === 'apply' ? { rows: [{ receipt_id: 'apply_1' }] } : { rows: [] };
            }
            if (sql.includes('SELECT id, code FROM projects') && sql.includes('ANY($1::text[])')) return { rows: [{ id: 'project_brainbase', code: 'brainbase' }] };
            if (sql.includes('SELECT id, code, organization_id FROM projects')) return { rows: [{ id: 'project_brainbase', code: 'brainbase', organization_id: 'org_1' }] };
            if (sql.includes('SELECT id FROM projects WHERE code=ANY')) return { rows: [{ id: 'project_brainbase' }] };
            if (sql.includes('SELECT ge.id, ge.entity_type')) return { rows: after.entities };
            if (sql.includes('SELECT gx.id, gx.from_id')) return { rows: edgeExists ? after.edges : [] };
            if (sql.includes('SELECT ge.id') && sql.includes('JOIN projects')) return { rows: [{ id: 'entity_a' }, { id: 'entity_b' }] };
            if (sql.includes('DELETE FROM graph_edges')) { edgeExists = false; return { rowCount: 1, rows: [] }; }
            if (sql.includes('SELECT id FROM graph_edges')) return { rows: edgeExists ? [{ id: 'edge_created' }] : [] };
            if (sql.includes('SELECT id FROM graph_entities')) return { rows: [] };
            if (sql.includes('INSERT INTO graph_entities')) return { rowCount: 1, rows: [] };
            if (sql.includes('INSERT INTO graph_maintenance_receipts')) return { rows: [{ receipt_id: 'rollback_1', receipt_type: 'rollback', status: 'completed' }] };
            if (sql.includes('UPDATE graph_maintenance_plans')) return { rowCount: 1, rows: [] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const rollbackService = new GraphMaintenanceService({ infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) } });
        const receipt = await rollbackService.rollbackPlan({ organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm' }, {
            projectCode: 'brainbase', planId: 'plan_1', applyReceiptId: 'apply_1'
        });
        expect(receipt).toMatchObject({ receipt_id: 'rollback_1', receipt_type: 'rollback' });
        const deleteCall = client.query.mock.calls.find(([sql]) => sql.includes('DELETE FROM graph_edges'));
        expect(deleteCall?.[1]).toEqual([['edge_created'], 'org_1', ['brainbase']]);
        expect(edgeExists).toBe(false);
    });
});
