import { describe, expect, it, vi } from 'vitest';
import { GraphMaintenanceService } from '../../../server/services/graph-maintenance-service.js';
import { hashGraphSnapshot, validateGraphSnapshot } from '../../../server/services/graph-maintenance-engine.js';

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

    it('cross-tenant subjectはCEOと双方project scopeを要求しtarget最小行だけを読む', async () => {
        const target = { id: 'product_aitle', entity_type: 'product', project_code: 'aitle', organization_id: 'techknight', role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 4 };
        const client = { query: vi.fn(async () => ({ rows: [target] })) };
        const operations = [{ operation: 'link_decision_subject', subject_entity_id: 'product_aitle', target_project_code: 'aitle' }];
        await expect(service.loadExternalEntities(client, {
            organizationId: 'org_unson', projectCodes: ['brainbase', 'aitle'], role: 'gm'
        }, operations)).rejects.toThrow('requires ceo role');
        await expect(service.loadExternalEntities(client, {
            organizationId: 'org_unson', projectCodes: ['brainbase'], role: 'ceo'
        }, operations)).rejects.toThrow('Access denied for target project scope');
        await expect(service.loadExternalEntities(client, {
            organizationId: 'org_unson', projectCodes: ['brainbase', 'aitle'], role: 'ceo'
        }, operations, { lock: true })).resolves.toEqual([target]);
        const [sql, params] = client.query.mock.calls.at(-1);
        expect(sql).toContain('p.code=ANY($2::text[])');
        expect(sql).toContain('p.organization_id IS NOT NULL');
        expect(sql).toContain('FOR UPDATE');
        expect(params).toEqual([['product_aitle'], ['aitle']]);
    });

    it('cross-tenant subject planはHuman Gateを検証しtarget payloadを複製せずEdge 1件だけをdry-runする', async () => {
        const snapshot = {
            project_code: 'brainbase',
            entities: [{ id: 'decision_1', entity_type: 'decision', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 2 }],
            edges: []
        };
        const snapshotHash = hashGraphSnapshot(snapshot);
        snapshot.hash = snapshotHash;
        const stored = { id: 'gms_1', project_id: 'project_brainbase', snapshot, snapshot_hash: snapshotHash };
        const target = { id: 'product_aitle', entity_type: 'product', project_code: 'aitle', role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 4 };
        const client = { query: vi.fn(async (sql, params) => {
            if (sql.includes('FROM graph_maintenance_snapshots')) return { rows: [stored] };
            if (sql.includes('SELECT id FROM graph_edges')) return { rows: [] };
            if (sql.includes('SELECT ge.id, ge.entity_type')) return { rows: [target] };
            if (sql.includes('FROM graph_maintenance_human_gate_receipts')) return { rows: [{
                id: 'gate_1',
                evidence: { operation_scope: {
                    operation: 'link_decision_subject', decision_id: 'decision_1', decision_expected_version: 2,
                    subject_entity_id: 'product_aitle', subject_expected_version: 4,
                    target_project_code: 'aitle', expected_version: 0
                } }
            }] };
            if (sql.includes('SELECT * FROM graph_maintenance_plans')) return { rows: [] };
            if (sql.includes('INSERT INTO graph_maintenance_plans')) return { rows: [{
                id: params[0], project_id: params[2], snapshot_id: params[3], base_snapshot_hash: params[4],
                after_snapshot_hash: params[5], idempotency_key: params[6], input_fingerprint: params[7],
                reason: params[8], operations: JSON.parse(params[9]), before_snapshot: JSON.parse(params[10]),
                after_snapshot: JSON.parse(params[11]), status: 'planned'
            }] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const planService = new GraphMaintenanceService({ infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) } });
        const plan = await planService.planMutations({
            organizationId: 'org_unson', projectCodes: ['brainbase', 'aitle'], role: 'ceo', personId: 'person_1'
        }, {
            projectCode: 'brainbase', snapshotId: 'gms_1', idempotencyKey: 'subject-plan-1', reason: 'Aitle subject link',
            humanGateReceipt: 'gate_1', operations: [{
                operation: 'link_decision_subject', decision_id: 'decision_1', decision_expected_version: 2,
                subject_entity_id: 'product_aitle', subject_expected_version: 4, target_project_code: 'aitle', expected_version: 0
            }]
        });
        expect(plan.dry_run).toBe(true);
        expect(plan.before.external_entities).toEqual([target]);
        expect(plan.before.external_entities[0]).not.toHaveProperty('payload');
        expect(plan.after.edges).toEqual([expect.objectContaining({
            from_id: 'decision_1', to_id: 'product_aitle', rel_type: 'governs', project_code: 'brainbase'
        })]);
        expect(plan.after.entities).toEqual(snapshot.entities);
        expect(plan.diff_summary).toMatchObject({
            entities: { added_count: 0, removed_count: 0, modified_count: 0, truncated: false },
            edges: {
                added_count: 1, removed_count: 0, modified_count: 0, truncated: false,
                added: [expect.objectContaining({ from_id: 'decision_1', to_id: 'product_aitle', rel_type: 'governs' })]
            },
            validation: { issue_count_delta: 0, orphan_count_delta: 0 }
        });
        expect(validateGraphSnapshot(plan.after)).toMatchObject({ valid: true, issues: [] });
    });

    it('target project全体を含むsnapshotではDecision subject planを作成せずpayload露出を防ぐ', async () => {
        const snapshot = {
            project_code: 'brainbase',
            entities: [
                { id: 'decision_1', entity_type: 'decision', project_code: 'brainbase', payload: {}, version: 2 },
                { id: 'product_aitle', entity_type: 'product', project_code: 'aitle', payload: { confidential: 'must-not-leak' }, version: 4 }
            ],
            edges: [{ id: 'aitle_private_edge', from_id: 'product_aitle', to_id: 'aitle_private', rel_type: 'contains', project_code: 'aitle', payload: { confidential: true }, version: 1 }]
        };
        snapshot.hash = hashGraphSnapshot(snapshot);
        const client = { query: vi.fn(async (sql, params = []) => {
            if (sql.includes('FROM graph_maintenance_snapshots')) return { rows: [{
                project_id: 'project_brainbase', snapshot, snapshot_hash: snapshot.hash
            }] };
            throw new Error(`query must not run after snapshot scope rejection: ${sql}`);
        }) };
        const scopedService = new GraphMaintenanceService({ infoSSOTService: {
            withAccessContext: async (_access, callback) => callback(client)
        } });
        await expect(scopedService.planMutations({
            organizationId: 'org_unson', projectCodes: ['brainbase', 'aitle'], role: 'ceo'
        }, {
            projectCode: 'brainbase', snapshotId: 'gms_composite', idempotencyKey: 'subject-plan-composite', reason: 'reject composite image',
            operations: [{
                operation: 'link_decision_subject', decision_id: 'decision_1', decision_expected_version: 2,
                subject_entity_id: 'product_aitle', subject_expected_version: 4, target_project_code: 'aitle', expected_version: 0
            }]
        })).rejects.toMatchObject({ code: 'GRAPH_CROSS_TENANT_SNAPSHOT_SCOPE_MISMATCH', status: 409 });
        expect(client.query).toHaveBeenCalledTimes(1);
    });

    it('Decision subjectのHuman Gateは承認したtargetとversionへ束縛する', async () => {
        const operation = {
            operation: 'link_decision_subject', decision_id: 'decision_1', decision_expected_version: 2,
            subject_entity_id: 'product_aitle', subject_expected_version: 4,
            target_project_code: 'aitle', expected_version: 0
        };
        const snapshot = { project_code: 'brainbase', entities: [{
            id: 'decision_1', entity_type: 'decision', project_code: 'brainbase', payload: {},
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 2
        }], edges: [] };
        snapshot.hash = hashGraphSnapshot(snapshot);
        const client = { query: vi.fn(async (sql, params = []) => {
            if (sql.includes('FROM graph_maintenance_snapshots')) return { rows: [{ project_id: 'project_brainbase', snapshot, snapshot_hash: snapshot.hash }] };
            if (sql.includes('SELECT id FROM graph_edges')) return { rows: [] };
            if (sql.includes('SELECT ge.id, ge.entity_type')) return { rows: [{ id: 'product_aitle', entity_type: 'product', project_code: 'aitle', lifecycle_status: 'active', version: 4 }] };
            if (sql.includes('FROM graph_maintenance_human_gate_receipts')) return { rows: [{ id: 'gate_1', evidence: { operation_scope: { ...operation, subject_expected_version: 3 } } }] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const boundService = new GraphMaintenanceService({ infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) } });
        await expect(boundService.planMutations({
            organizationId: 'org_unson', projectCodes: ['brainbase', 'aitle'], role: 'ceo'
        }, {
            projectCode: 'brainbase', snapshotId: 'gms_1', idempotencyKey: 'subject-plan-mismatch',
            reason: 'mismatch', humanGateReceipt: 'gate_1', operations: [operation]
        })).rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_SCOPE_MISMATCH', status: 409 });
    });

    it('Decision subjectのHuman Gate scope欠損は構造化409で拒否する', async () => {
        const operation = {
            operation: 'link_decision_subject', decision_id: 'decision_1', decision_expected_version: 2,
            subject_entity_id: 'product_aitle', subject_expected_version: 4,
            target_project_code: 'aitle', expected_version: 0
        };
        const snapshot = { project_code: 'brainbase', entities: [{
            id: 'decision_1', entity_type: 'decision', project_code: 'brainbase', payload: {},
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 2
        }], edges: [] };
        snapshot.hash = hashGraphSnapshot(snapshot);
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('FROM graph_maintenance_snapshots')) return { rows: [{ project_id: 'project_brainbase', snapshot, snapshot_hash: snapshot.hash }] };
            if (sql.includes('SELECT id FROM graph_edges')) return { rows: [] };
            if (sql.includes('SELECT ge.id, ge.entity_type')) return { rows: [{ id: 'product_aitle', entity_type: 'product', project_code: 'aitle', lifecycle_status: 'active', version: 4 }] };
            if (sql.includes('FROM graph_maintenance_human_gate_receipts')) return { rows: [{ id: 'gate_1', evidence: {} }] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const boundService = new GraphMaintenanceService({ infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) } });
        await expect(boundService.planMutations({
            organizationId: 'org_unson', projectCodes: ['brainbase', 'aitle'], role: 'ceo'
        }, {
            projectCode: 'brainbase', snapshotId: 'gms_1', idempotencyKey: 'subject-plan-missing-scope',
            reason: 'missing scope', humanGateReceipt: 'gate_1', operations: [operation]
        })).rejects.toMatchObject({
            code: 'GRAPH_HUMAN_GATE_SCOPE_MISMATCH', status: 409,
            details: { expected_operation_scope: operation }
        });
    });

    it('AC-005 INV-002 external endpoint version drift changes composite snapshot hash', async () => {
        const planned = {
            project_code: 'brainbase', entities: [], edges: [],
            external_entities: [{ id: 'product_aitle', entity_type: 'product', project_code: 'aitle', role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 4 }]
        };
        const client = { query: vi.fn(async () => ({ rows: [{ ...planned.external_entities[0], version: 5 }] })) };
        const current = structuredClone(planned);
        current.external_entities = await service.loadExternalEntitiesFromImage(client, {
            organizationId: 'org_unson', projectCodes: ['brainbase', 'aitle'], role: 'ceo'
        }, planned, { lock: true });
        expect(hashGraphSnapshot(current)).not.toBe(hashGraphSnapshot(planned));
        expect(client.query.mock.calls[0][0]).toContain('FOR UPDATE');
    });

    it('既存cross-tenant targetを保持したまま別targetをPlanの複合hashへ追加する', async () => {
        const existing = {
            id: 'product_existing', entity_type: 'product', project_code: 'existing',
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 3
        };
        const added = {
            id: 'product_added', entity_type: 'product', project_code: 'added', organization_id: 'org_added',
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 7
        };
        const snapshot = {
            project_code: 'brainbase',
            entities: [{ id: 'decision_1', entity_type: 'decision', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 2 }],
            edges: [{ id: 'edge_existing', from_id: 'decision_1', to_id: existing.id, rel_type: 'governs', project_code: 'brainbase', payload: { cross_tenant: true, target_project_code: 'existing' }, role_min: 'ceo', sensitivity: 'restricted', lifecycle_status: 'active', version: 1 }],
            external_entities: [existing]
        };
        snapshot.hash = hashGraphSnapshot(snapshot);
        const stored = { id: 'snapshot_1', project_id: 'project_brainbase', snapshot, snapshot_hash: snapshot.hash };
        const operation = {
            operation: 'link_decision_subject', decision_id: 'decision_1', decision_expected_version: 2,
            subject_entity_id: added.id, subject_expected_version: 7, target_project_code: 'added',
            edge_id: 'edge_added', expected_version: 0, human_gate_receipt: 'gate_added'
        };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('FROM graph_maintenance_snapshots')) return { rows: [stored] };
            if (sql.includes('SELECT id FROM graph_edges')) return { rows: [] };
            if (sql.includes('SELECT ge.id, ge.entity_type')) return { rows: [added] };
            if (sql.includes('FROM graph_maintenance_human_gate_receipts')) return { rows: [{ evidence: { operation_scope: {
                operation: operation.operation, decision_id: operation.decision_id,
                decision_expected_version: operation.decision_expected_version,
                subject_entity_id: operation.subject_entity_id,
                subject_expected_version: operation.subject_expected_version,
                target_project_code: operation.target_project_code,
                expected_version: operation.expected_version
            } } }] };
            if (sql.includes('FROM graph_maintenance_plans')) return { rows: [] };
            if (sql.includes('INSERT INTO graph_maintenance_plans')) return { rows: [{
                id: 'plan_added', status: 'planned', snapshot_id: stored.id,
                base_snapshot_hash: snapshot.hash, after_snapshot_hash: 'after', reason: 'add subject',
                idempotency_key: 'add-subject', operations: [operation], before_snapshot: snapshot,
                after_snapshot: { ...snapshot, external_entities: [existing, added] }
            }] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const planningService = new GraphMaintenanceService({ infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) } });
        const plan = await planningService.planMutations({
            organizationId: 'org_source', projectCodes: ['brainbase', 'existing', 'added'], role: 'ceo'
        }, { projectCode: 'brainbase', snapshotId: stored.id, idempotencyKey: 'add-subject', reason: 'add subject', operations: [operation] });
        const insertedSnapshot = JSON.parse(client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO graph_maintenance_plans'))[1][11]);
        expect(insertedSnapshot.external_entities.map((entity) => entity.id)).toEqual(['product_added', 'product_existing']);
        expect(plan.plan_id).toBe('plan_added');
    });

    it.each([
        ['applyPlan', 'planned', 'apply', 'snapshot hash conflict'],
        ['rollbackPlan', 'applied', 'rollback', 'rollback snapshot hash conflict']
    ])('%sはexternal endpointのversion drift時に書込みとReceipt作成を行わない', async (method, status, receiptType, message) => {
        const local = { project_code: 'brainbase', entities: [{ id: 'decision_1', entity_type: 'decision', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 2 }], edges: [] };
        const external = { id: 'product_aitle', entity_type: 'product', project_code: 'aitle', role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 4 };
        const before = { ...structuredClone(local), external_entities: [external] };
        before.hash = hashGraphSnapshot(before);
        const after = structuredClone(before);
        after.edges.push({ id: 'edge_subject', from_id: 'decision_1', to_id: 'product_aitle', rel_type: 'governs', project_code: 'brainbase', payload: { target_project_code: 'aitle', cross_tenant: true }, role_min: 'ceo', sensitivity: 'restricted', lifecycle_status: 'active', version: 1 });
        after.hash = hashGraphSnapshot(after);
        const plan = {
            id: 'plan_drift', project_id: 'project_brainbase', organization_id: 'org_unson', project_code: 'brainbase', status,
            operations: [{ operation: 'link_decision_subject' }], reason: 'drift test', idempotency_key: 'drift-1',
            base_snapshot_hash: before.hash, after_snapshot_hash: after.hash, before_snapshot: before, after_snapshot: after
        };
        const client = { query: vi.fn(async (sql, params) => {
            if (sql.includes('FROM graph_maintenance_plans')) return { rows: [plan] };
            if (sql.includes('FROM graph_maintenance_receipts')) {
                if (method === 'rollbackPlan' && params[1] === 'apply') return { rows: [{ receipt_id: 'apply_1' }] };
                return { rows: [] };
            }
            throw new Error(`mutation query must not run: ${sql}`);
        }) };
        const driftService = new GraphMaintenanceService({ infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) } });
        vi.spyOn(driftService, 'loadSnapshot').mockResolvedValue({ snapshot: { ...structuredClone(local), hash: hashGraphSnapshot(local) } });
        vi.spyOn(driftService, 'loadExternalEntitiesFromImage').mockResolvedValue([{ ...external, version: 5 }]);
        const replace = vi.spyOn(driftService, 'replaceSnapshot');
        const createReceipt = vi.spyOn(driftService, 'createReceipt');
        const access = { organizationId: 'org_unson', projectCodes: ['brainbase', 'aitle'], role: 'ceo' };
        const input = method === 'applyPlan'
            ? { projectCode: 'brainbase', planId: 'plan_drift', snapshotHash: before.hash }
            : { projectCode: 'brainbase', planId: 'plan_drift', applyReceiptId: 'apply_1' };
        await expect(driftService[method](access, input)).rejects.toThrow(message);
        expect(replace).not.toHaveBeenCalled();
        expect(createReceipt).not.toHaveBeenCalled();
        expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO graph_maintenance_receipts'))).toBe(false);
        expect(receiptType).toBe(method === 'applyPlan' ? 'apply' : 'rollback');
    });

    it('複数Decisionを含むPlanは単一Human GateでApplyせず変更前に停止する', async () => {
        const before = {
            project_code: 'brainbase',
            entities: ['decision_1', 'decision_2'].map((id) => ({
                id, entity_type: 'decision', project_code: 'brainbase', payload: {}, role_min: 'member',
                sensitivity: 'internal', lifecycle_status: 'active', version: 1
            })),
            edges: []
        };
        before.hash = hashGraphSnapshot(before);
        const after = structuredClone(before);
        after.entities.forEach((entity) => { entity.lifecycle_status = 'retired'; entity.version = 2; });
        after.hash = hashGraphSnapshot(after);
        const plan = {
            id: 'plan_two_decisions', project_id: 'project_brainbase', organization_id: 'org_1',
            project_code: 'brainbase', status: 'planned', base_snapshot_hash: before.hash,
            after_snapshot_hash: after.hash, before_snapshot: before, after_snapshot: after,
            operations: before.entities.map((entity) => ({
                operation: 'retire_entity', entity_id: entity.id, expected_version: 1
            }))
        };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('FROM graph_maintenance_plans')) return { rows: [plan] };
            if (sql.includes('FROM graph_maintenance_receipts')) return { rows: [] };
            throw new Error(`mutation query must not run: ${sql}`);
        }) };
        const multiDecisionService = new GraphMaintenanceService({
            infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) }
        });
        await expect(multiDecisionService.applyPlan({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm',
            authSource: 'bearer', personId: 'person_1'
        }, {
            projectCode: 'brainbase', planId: plan.id, snapshotHash: before.hash,
            humanGateReceipt: 'gate_single'
        })).rejects.toMatchObject({ code: 'GRAPH_APPLY_HUMAN_GATE_SCOPE_UNSUPPORTED', status: 409 });
        expect(client.query).toHaveBeenCalledTimes(2);
    });

    it('適用済みの複数Decision Planは追加Human Gate評価前に既存Receiptを返す', async () => {
        const before = {
            project_code: 'brainbase',
            entities: ['decision_1', 'decision_2'].map((id) => ({
                id, entity_type: 'decision', project_code: 'brainbase', payload: {}, role_min: 'member',
                sensitivity: 'internal', lifecycle_status: 'active', version: 1
            })),
            edges: []
        };
        before.hash = hashGraphSnapshot(before);
        const plan = {
            id: 'plan_applied_two_decisions', project_id: 'project_brainbase', organization_id: 'org_1',
            project_code: 'brainbase', status: 'applied', base_snapshot_hash: before.hash,
            after_snapshot_hash: before.hash, before_snapshot: before, after_snapshot: before,
            operations: before.entities.map((entity) => ({
                operation: 'retire_entity', entity_id: entity.id, expected_version: 1
            }))
        };
        const receipt = { receipt_id: 'apply_existing', plan_id: plan.id, receipt_type: 'apply', status: 'completed' };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('FROM graph_maintenance_plans')) return { rows: [plan] };
            if (sql.includes('FROM graph_maintenance_receipts')) return { rows: [receipt] };
            throw new Error(`mutation query must not run: ${sql}`);
        }) };
        const appliedService = new GraphMaintenanceService({
            infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) }
        });
        await expect(appliedService.applyPlan({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm'
        }, {
            projectCode: 'brainbase', planId: plan.id, snapshotHash: before.hash
        })).resolves.toEqual(receipt);
        expect(client.query).toHaveBeenCalledTimes(2);
    });

    it('適用済みPlanでもbase snapshot hash不一致はReceipt readbackより先に拒否する', async () => {
        const before = {
            project_code: 'brainbase',
            entities: [],
            edges: []
        };
        before.hash = hashGraphSnapshot(before);
        const plan = {
            id: 'plan_applied_hash_mismatch', project_id: 'project_brainbase', organization_id: 'org_1',
            project_code: 'brainbase', status: 'applied', base_snapshot_hash: before.hash,
            after_snapshot_hash: before.hash, before_snapshot: before, after_snapshot: before,
            operations: []
        };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('FROM graph_maintenance_plans')) return { rows: [plan] };
            throw new Error(`Receipt readback must not run: ${sql}`);
        }) };
        const appliedService = new GraphMaintenanceService({
            infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) }
        });
        await expect(appliedService.applyPlan({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm'
        }, {
            projectCode: 'brainbase', planId: plan.id, snapshotHash: 'sha256:wrong'
        })).rejects.toThrow('snapshot hash mismatch');
        expect(client.query).toHaveBeenCalledTimes(1);
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

    it.each([
        ['gm', ['brainbase']],
        ['ceo', ['brainbase']]
    ])('既存cross-tenant edgeは片側scopeの%s snapshotから存在も返さない', async (role, projectCodes) => {
        const crossEdge = {
            id: 'edge_subject', from_id: 'decision_1', to_id: 'product_aitle', rel_type: 'governs',
            project_code: 'brainbase', payload: { cross_tenant: true, target_project_code: 'aitle' },
            role_min: 'ceo', sensitivity: 'restricted', lifecycle_status: 'active', version: 1
        };
        const client = { query: vi.fn(async (sql, params) => {
            if (sql.includes('SELECT id, code, organization_id FROM projects')) {
                return { rows: [{ id: 'project_brainbase', code: 'brainbase', organization_id: 'org_unson' }] };
            }
            if (sql.includes('SELECT ge.id, ge.entity_type')) return { rows: [{
                id: 'decision_1', entity_type: 'decision', project_code: 'brainbase', payload: {},
                role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1
            }] };
            if (sql.includes('SELECT gx.id, gx.from_id')) {
                const visible = params[1] === 'ceo' && params[2].includes('aitle');
                return { rows: visible ? [crossEdge] : [] };
            }
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const scoped = new GraphMaintenanceService({ infoSSOTService: {} });
        const { snapshot } = await scoped.loadSnapshot(client, { organizationId: 'org_unson', role, projectCodes }, 'brainbase');
        expect(snapshot.edges).toEqual([]);
        expect(snapshot).not.toHaveProperty('external_entities');
    });

    it('Human Gate receiptは署名Bearerの人間principalからのみ供給できる', async () => {
        const client = { query: vi.fn(async (sql, params = []) => {
            if (sql.includes('SELECT id, code, organization_id FROM projects')) return { rows: [{ id: 'project_brainbase', code: 'brainbase', organization_id: 'org_1' }] };
            if (sql.includes('SELECT ge.id, ge.entity_type, p.code AS project_code')) return { rows: [{
                id: 'product_aitle', entity_type: 'product', project_code: 'aitle', organization_id: 'org_2',
                role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 4
            }] };
            if (sql.includes("entity_type='decision'")) return { rows: [{ id: 'decision_1' }] };
            if (sql.includes('INSERT INTO graph_maintenance_human_gate_receipts')) return { rows: [{
                receipt_id: params[0], organization_id: 'org_1', project_id: 'project_brainbase', decision_id: params[3],
                status: 'approved', approved_by: 'person_1', approved_at: '2026-08-21T00:00:00.000Z', evidence: JSON.parse(params[5])
            }] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const withAccessContext = vi.fn(async (_access, callback) => callback(client));
        const humanGateService = new GraphMaintenanceService({ infoSSOTService: { withAccessContext } });
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'service-token', personId: 'svc_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_1', evidence: {} })).rejects
            .toMatchObject({ code: 'GRAPH_HUMAN_PRINCIPAL_REQUIRED', status: 403 });
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_invalid', evidence: null }))
            .rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_EVIDENCE_INVALID', status: 400 });
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_secret', evidence: { token: 'raw-secret' } }))
            .rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_EVIDENCE_SECRET', status: 400 });
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_bearer', evidence: { reason: 'Bearer abcdefghijklmnopqrstuvwxyz' } }))
            .rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_EVIDENCE_SECRET', status: 400 });
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_large', evidence: { reason: 'x'.repeat(8200) } }))
            .rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_EVIDENCE_INVALID', status: 400 });
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_oversized_scope', evidence: { operation_scope: {
            operation: 'link_decision_subject', decision_id: 'x'.repeat(8200), decision_expected_version: 1,
            subject_entity_id: 'product_1', subject_expected_version: 1, target_project_code: 'target', expected_version: 0
        } } })).rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_EVIDENCE_TOO_LARGE', status: 413 });
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_unbound', evidence: { source: 'human-review' } }))
            .rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_EVIDENCE_INVALID', status: 400 });
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_forbidden', evidence: { operation_scope: {
            operation: 'link_decision_subject', decision_id: 'decision_1', decision_expected_version: 2,
            subject_entity_id: 'product_aitle', subject_expected_version: 4,
            target_project_code: 'aitle', expected_version: 0
        } } })).rejects.toThrow('Cross-tenant Decision subject link requires ceo role');
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'ceo', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_source_only', evidence: { operation_scope: {
            operation: 'link_decision_subject', decision_id: 'decision_1', decision_expected_version: 2,
            subject_entity_id: 'product_aitle', subject_expected_version: 4,
            target_project_code: 'aitle', expected_version: 0
        } } })).rejects.toThrow('Access denied for target project scope');
        const receipt = await humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase', 'aitle'], role: 'ceo', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_1', evidence: { operation_scope: {
            operation: 'link_decision_subject', decision_id: 'decision_1', decision_expected_version: 2,
            subject_entity_id: 'product_aitle', subject_expected_version: 4,
            target_project_code: 'aitle', expected_version: 0
        }, source: 'human-review' } });
        expect(receipt).toMatchObject({ receipt_id: 'gate_1', status: 'approved', decision_id: 'decision_1' });
        const retireReceipt = await humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_retire', evidence: { operation_scope: {
            operation: 'retire_entity', decision_id: 'decision_1', decision_expected_version: 2
        } } });
        expect(retireReceipt).toMatchObject({ receipt_id: 'gate_retire', status: 'approved', decision_id: 'decision_1' });
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_other', receiptId: 'gate_mismatch', evidence: { operation_scope: {
            operation: 'retire_entity', decision_id: 'decision_1', decision_expected_version: 2
        } } })).rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_SCOPE_MISMATCH', status: 409 });
        expect(withAccessContext).toHaveBeenCalledTimes(4);
    });

    it('Human Gate receipt IDの再利用は同一operation_scopeだけを許可する', async () => {
        const existingScope = {
            operation: 'link_decision_subject', decision_id: 'decision_1', decision_expected_version: 2,
            subject_entity_id: 'product_aitle', subject_expected_version: 4,
            target_project_code: 'aitle', expected_version: 0
        };
        const requestedScope = { ...existingScope, subject_expected_version: 5 };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('SELECT id, code, organization_id FROM projects')) return { rows: [{ id: 'project_brainbase', code: 'brainbase', organization_id: 'org_1' }] };
            if (sql.includes('SELECT ge.id, ge.entity_type, p.code AS project_code')) return { rows: [{
                id: 'product_aitle', entity_type: 'product', project_code: 'aitle', organization_id: 'org_2',
                role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 5
            }] };
            if (sql.includes("entity_type='decision'")) return { rows: [{ id: 'decision_1' }] };
            if (sql.includes('INSERT INTO graph_maintenance_human_gate_receipts')) return { rows: [] };
            if (sql.includes('FROM graph_maintenance_human_gate_receipts WHERE id=')) return { rows: [{
                receipt_id: 'gate_1', organization_id: 'org_1', project_id: 'project_brainbase',
                decision_id: 'decision_1', status: 'approved', evidence: { operation_scope: existingScope }
            }] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const receiptService = new GraphMaintenanceService({ infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) } });
        await expect(receiptService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase', 'aitle'], role: 'ceo',
            authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_1', evidence: { operation_scope: requestedScope } }))
            .rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_SCOPE_MISMATCH', status: 409 });
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
            if (sql.includes('SELECT ge.id FROM graph_entities ge WHERE ge.id=ANY')) return { rows: [{ id: 'entity_a' }, { id: 'entity_b' }] };
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
