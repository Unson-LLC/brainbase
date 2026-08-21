import { createHash, randomUUID } from 'node:crypto';
import {
    buildGraphPlan,
    findIntroducedGraphValidationIssues,
    hashGraphSnapshot,
    validateGraphSnapshot
} from './graph-maintenance-engine.js';

function fingerprint(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function plannedEdgeId(organizationId, projectCode, idempotencyKey, index) {
    return `edg_maint_${createHash('sha256').update(`${organizationId}\u0000${projectCode}\u0000${idempotencyKey}\u0000${index}`).digest('hex').slice(0, 32)}`;
}

function actor(access) {
    return access.personId || access.serviceId || 'authenticated-service';
}

function uniqueIds(records) {
    return [...new Set(records.map((record) => record.id))];
}

function assertValidSnapshot(snapshot, prefix = 'Graph snapshot is invalid', baseline = null) {
    const validation = validateGraphSnapshot(snapshot);
    const issues = baseline
        ? findIntroducedGraphValidationIssues(baseline, snapshot)
        : validation.issues;
    if (issues.length) {
        throw new Error(`${prefix}: ${issues.map((item) => item.category).join(',')}`);
    }
}

export class GraphMaintenanceService {
    constructor({ infoSSOTService }) {
        this.infoSSOTService = infoSSOTService;
    }

    assertMaintenanceAccess(access, projectCode) {
        if (!access?.organizationId && !access?.tenantId) throw new Error('Signed tenant authorization with organization is required');
        if (!access?.projectCodes?.includes(projectCode)) throw new Error(`Access denied for project: ${projectCode}`);
        if (!['gm', 'ceo'].includes(access.role)) throw new Error('Graph maintenance requires gm or ceo role');
    }

    async resolveProject(client, access, projectCode, { lock = false } = {}) {
        this.assertMaintenanceAccess(access, projectCode);
        const organizationId = access.organizationId || access.tenantId;
        const { rows } = await client.query(
            `SELECT id, code, organization_id FROM projects
             WHERE code = $1 AND organization_id = $2${lock ? ' FOR UPDATE' : ''}`,
            [projectCode, organizationId]
        );
        if (!rows[0]) throw new Error(`Access denied for tenant project: ${projectCode}`);
        return rows[0];
    }

    async loadSnapshot(client, access, projectCode, { lock = false } = {}) {
        const project = await this.resolveProject(client, access, projectCode, { lock });
        const suffix = lock ? ' FOR UPDATE' : '';
        const [entityResult, edgeResult] = await Promise.all([
            client.query(
                `SELECT ge.id, ge.entity_type, p.code AS project_code, ge.payload, ge.role_min,
                        ge.sensitivity, ge.lifecycle_status, ge.version
                 FROM graph_entities ge JOIN projects p ON p.id = ge.project_id
                 WHERE ge.project_id = $1 ORDER BY ge.id${suffix}`,
                [project.id]
            ),
            client.query(
                `SELECT gx.id, gx.from_id, gx.to_id, gx.rel_type, p.code AS project_code, gx.payload,
                        gx.role_min, gx.sensitivity, gx.lifecycle_status, gx.version
                 FROM graph_edges gx JOIN projects p ON p.id = gx.project_id
                 WHERE gx.project_id = $1 ORDER BY gx.id${suffix}`,
                [project.id]
            )
        ]);
        const snapshot = { project_code: projectCode, entities: entityResult.rows, edges: edgeResult.rows };
        snapshot.hash = hashGraphSnapshot(snapshot);
        return { project, snapshot };
    }

    async loadSnapshotImage(client, access, image, { lock = false, baseline = null } = {}) {
        assertValidSnapshot(image, 'Graph snapshot image is invalid', baseline);
        const organizationId = access.organizationId || access.tenantId;
        const codes = [...new Set([image.project_code, ...image.entities.map((item) => item.project_code), ...image.edges.map((item) => item.project_code)])];
        if (!codes.every((code) => access.projectCodes.includes(code))) throw new Error('Access denied for target project scope');
        const projectRows = await client.query(
            `SELECT id, code FROM projects WHERE code=ANY($1::text[]) AND organization_id=$2`, [codes, organizationId]
        );
        if (projectRows.rows.length !== codes.length) throw new Error('Access denied for tenant project');
        const suffix = lock ? ' FOR UPDATE' : '';
        const entityIds = uniqueIds(image.entities);
        const edgeIds = uniqueIds(image.edges);
        const entities = entityIds.length ? await client.query(
            `SELECT ge.id, ge.entity_type, p.code AS project_code, ge.payload, ge.role_min,
                    ge.sensitivity, ge.lifecycle_status, ge.version
             FROM graph_entities ge JOIN projects p ON p.id=ge.project_id
             WHERE ge.id=ANY($1::text[]) AND p.organization_id=$2 AND p.code=ANY($3::text[])
             ORDER BY ge.id${suffix}`, [entityIds, organizationId, codes]
        ) : { rows: [] };
        const edges = edgeIds.length ? await client.query(
            `SELECT gx.id, gx.from_id, gx.to_id, gx.rel_type, p.code AS project_code, gx.payload,
                    gx.role_min, gx.sensitivity, gx.lifecycle_status, gx.version
             FROM graph_edges gx JOIN projects p ON p.id=gx.project_id
             WHERE gx.id=ANY($1::text[]) AND p.organization_id=$2 AND p.code=ANY($3::text[])
             ORDER BY gx.id${suffix}`, [edgeIds, organizationId, codes]
        ) : { rows: [] };
        if (entities.rows.length !== entityIds.length || edges.rows.length !== edgeIds.length) {
            throw new Error('Graph snapshot image contains missing or inaccessible records');
        }
        const endpointIds = [...new Set(edges.rows.flatMap((edge) => [edge.from_id, edge.to_id]))];
        if (endpointIds.length) {
            const endpointRows = await client.query(
                `SELECT ge.id
                 FROM graph_entities ge JOIN projects p ON p.id=ge.project_id
                 WHERE ge.id=ANY($1::text[]) AND p.organization_id=$2`,
                [endpointIds, organizationId]
            );
            if (endpointRows.rows.length !== endpointIds.length) {
                const accessibleEndpointIds = new Set(endpointRows.rows.map((row) => row.id));
                const baselineOrphanIds = new Set((baseline ? validateGraphSnapshot(baseline).issues : [])
                    .filter((issue) => issue.category === 'orphan')
                    .map((issue) => issue.id));
                const inaccessibleEdges = edges.rows.filter((edge) => !accessibleEndpointIds.has(edge.from_id) || !accessibleEndpointIds.has(edge.to_id));
                if (!inaccessibleEdges.every((edge) => baselineOrphanIds.has(edge.id))) {
                    throw new Error('Graph edge endpoint tenant conflict');
                }
            }
        }
        const snapshot = { project_code: image.project_code, entities: entities.rows, edges: edges.rows };
        snapshot.hash = hashGraphSnapshot(snapshot);
        return snapshot;
    }

    async exportSnapshot(access, { projectCode }) {
        return this.infoSSOTService.withAccessContext(access, async (client) => {
            const { project, snapshot } = await this.loadSnapshot(client, access, projectCode);
            const snapshotId = `gms_${randomUUID()}`;
            await client.query(
                `INSERT INTO graph_maintenance_snapshots
                 (id, organization_id, project_id, snapshot_hash, snapshot, created_by)
                 VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
                [snapshotId, access.organizationId || access.tenantId, project.id, snapshot.hash, JSON.stringify(snapshot), actor(access)]
            );
            return { snapshot_id: snapshotId, snapshot_hash: snapshot.hash, ...snapshot };
        });
    }

    async planMutations(access, input) {
        this.assertMaintenanceAccess(access, input.projectCode);
        return this.infoSSOTService.withAccessContext(access, async (client) => {
            const organizationId = access.organizationId || access.tenantId;
            const { rows: snapshotRows } = await client.query(
                `SELECT s.*, p.code AS project_code FROM graph_maintenance_snapshots s
                 JOIN projects p ON p.id = s.project_id
                 WHERE s.id = $1 AND s.organization_id = $2 AND p.code = $3`,
                [input.snapshotId, organizationId, input.projectCode]
            );
            const stored = snapshotRows[0];
            if (!stored) throw new Error('Unknown snapshot');
            const normalizedOperations = (input.operations || []).map((operation, index) => (
                operation.operation === 'upsert_edge' && operation.expected_version === 0
                    ? { ...operation, edge_id: plannedEdgeId(organizationId, input.projectCode, input.idempotencyKey, index) }
                    : operation
            ));
            const targetProjectCodes = [...new Set(normalizedOperations
                .filter((operation) => operation.operation === 'move_scope')
                .map((operation) => operation.target_project_code)
                .filter(Boolean))];
            for (const targetProjectCode of targetProjectCodes) {
                await this.resolveProject(client, access, targetProjectCode);
            }
            const newEdgeOperations = normalizedOperations.filter((operation) => operation.operation === 'upsert_edge' && operation.expected_version === 0);
            if (newEdgeOperations.length) {
                const collision = await client.query(
                    `SELECT id FROM graph_edges WHERE id=ANY($1::text[]) FOR UPDATE`,
                    [newEdgeOperations.map((operation) => operation.edge_id)]
                );
                if (collision.rows.length) throw new Error('planned edge id conflict');
            }
            const activeDecisionRetires = normalizedOperations.filter((operation) => operation.operation === 'retire_entity')
                .map((operation) => stored.snapshot.entities.find((entity) => entity.id === operation.entity_id))
                .filter((entity) => entity?.entity_type === 'decision'
                    && entity.lifecycle_status === 'active'
                    && !['retired', 'superseded'].includes(String(entity.payload?.status || '').toLowerCase()));
            for (const decision of activeDecisionRetires) {
                const operation = normalizedOperations.find((candidate) => candidate.operation === 'retire_entity' && candidate.entity_id === decision.id);
                const receiptId = operation.human_gate_receipt || input.humanGateReceipt;
                const gate = await client.query(
                    `SELECT id, approved_by, approved_at FROM graph_maintenance_human_gate_receipts
                     WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND decision_id=$4
                       AND status='approved' AND approved_by <> '' AND approved_at IS NOT NULL`,
                    [receiptId, organizationId, stored.project_id, decision.id]
                );
                if (!gate.rows[0]) throw new Error('Valid Human Gate receipt is required for Active Decision');
            }
            const plan = buildGraphPlan(stored.snapshot, {
                project_code: input.projectCode,
                idempotency_key: input.idempotencyKey,
                reason: input.reason,
                operations: normalizedOperations,
                human_gate_receipt: input.humanGateReceipt
            });
            if (plan.before_hash !== stored.snapshot_hash) throw new Error('snapshot hash mismatch');
            const inputFingerprint = fingerprint({ reason: plan.reason, operations: plan.operations, snapshot_hash: plan.before_hash });
            const existing = await client.query(
                `SELECT * FROM graph_maintenance_plans
                 WHERE organization_id = $1 AND project_id = $2 AND idempotency_key = $3`,
                [organizationId, stored.project_id, input.idempotencyKey]
            );
            if (existing.rows[0]) {
                if (existing.rows[0].input_fingerprint !== inputFingerprint) throw new Error('idempotency key payload conflict');
                return this.formatPlan(existing.rows[0]);
            }
            const planId = `gmp_${randomUUID()}`;
            const { rows } = await client.query(
                `INSERT INTO graph_maintenance_plans
                 (id, organization_id, project_id, snapshot_id, base_snapshot_hash, after_snapshot_hash,
                  idempotency_key, input_fingerprint, reason, operations, before_snapshot, after_snapshot, created_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13)
                 ON CONFLICT (organization_id, project_id, idempotency_key) DO NOTHING
                 RETURNING *`,
                [planId, organizationId, stored.project_id, input.snapshotId, plan.before_hash, plan.after_hash,
                    input.idempotencyKey, inputFingerprint, plan.reason, JSON.stringify(plan.operations),
                    JSON.stringify(plan.before), JSON.stringify(plan.after), actor(access)]
            );
            if (rows[0]) return this.formatPlan(rows[0]);
            const concurrent = await client.query(
                `SELECT * FROM graph_maintenance_plans
                 WHERE organization_id=$1 AND project_id=$2 AND idempotency_key=$3`,
                [organizationId, stored.project_id, input.idempotencyKey]
            );
            if (!concurrent.rows[0] || concurrent.rows[0].input_fingerprint !== inputFingerprint) {
                throw new Error('idempotency key payload conflict');
            }
            return this.formatPlan(concurrent.rows[0]);
        });
    }

    async recordHumanGateReceipt(access, { projectCode, decisionId, receiptId, evidence = {} }) {
        this.assertMaintenanceAccess(access, projectCode);
        if (access.authSource !== 'bearer' || !String(access.personId || '').trim() || access.personId === 'internal_api') {
            throw new Error('Human Gate approval requires a signed human Bearer principal');
        }
        if (!String(decisionId || '').trim() || !String(receiptId || '').trim()) {
            throw new Error('decision_id and receipt_id are required');
        }
        if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
            throw new Error('evidence must be an object');
        }
        return this.infoSSOTService.withAccessContext(access, async (client) => {
            const organizationId = access.organizationId || access.tenantId;
            const project = await this.resolveProject(client, access, projectCode, { lock: true });
            const decision = await client.query(
                `SELECT id FROM graph_entities
                 WHERE id=$1 AND project_id=$2 AND entity_type='decision'
                   AND lifecycle_status='active'
                 FOR UPDATE`,
                [decisionId, project.id]
            );
            if (!decision.rows[0]) throw new Error('Active Decision is not accessible in target project');
            const inserted = await client.query(
                `INSERT INTO graph_maintenance_human_gate_receipts
                 (id, organization_id, project_id, decision_id, status, approved_by, approved_at, evidence)
                 VALUES ($1,$2,$3,$4,'approved',$5,NOW(),$6::jsonb)
                 ON CONFLICT (id) DO NOTHING
                 RETURNING id AS receipt_id, organization_id, project_id, decision_id, status, approved_by, approved_at, evidence`,
                [receiptId, organizationId, project.id, decisionId, actor(access), JSON.stringify(evidence)]
            );
            if (inserted.rows[0]) return inserted.rows[0];
            const existing = await client.query(
                `SELECT id AS receipt_id, organization_id, project_id, decision_id, status, approved_by, approved_at, evidence
                 FROM graph_maintenance_human_gate_receipts WHERE id=$1`, [receiptId]
            );
            const row = existing.rows[0];
            if (!row || row.organization_id !== organizationId || row.project_id !== project.id
                || row.decision_id !== decisionId || row.status !== 'approved') {
                throw new Error('Human Gate receipt id conflict');
            }
            return row;
        });
    }

    formatPlan(row) {
        return {
            plan_id: row.id, status: row.status, dry_run: row.status === 'planned',
            snapshot_id: row.snapshot_id, snapshot_hash: row.base_snapshot_hash,
            after_snapshot_hash: row.after_snapshot_hash, reason: row.reason,
            idempotency_key: row.idempotency_key, operations: row.operations,
            operation_count: row.operations.length, before: row.before_snapshot, after: row.after_snapshot
        };
    }

    async replaceSnapshot(client, access, snapshot, { baseline = null } = {}) {
        assertValidSnapshot(snapshot, 'Graph snapshot is invalid', baseline);
        const organizationId = access.organizationId || access.tenantId;
        const codes = [...new Set([snapshot.project_code, ...snapshot.entities.map((item) => item.project_code), ...snapshot.edges.map((item) => item.project_code)])];
        const projects = await client.query(
            `SELECT id, code FROM projects WHERE code = ANY($1::text[]) AND organization_id = $2 FOR UPDATE`,
            [codes, organizationId]
        );
        if (projects.rows.length !== codes.length || !codes.every((code) => access.projectCodes.includes(code))) throw new Error('Access denied for target project scope');
        const projectIds = new Map(projects.rows.map((row) => [row.code, row.id]));
        const authorizedProjectIds = [...projectIds.values()];
        const entityIds = uniqueIds(snapshot.entities);
        const edgeIds = uniqueIds(snapshot.edges);
        if (entityIds.length) {
            const conflicts = await client.query(
                `SELECT id FROM graph_entities
                 WHERE id=ANY($1::text[])
                   AND (project_id IS NULL OR NOT (project_id=ANY($2::text[])))
                 FOR UPDATE`,
                [entityIds, authorizedProjectIds]
            );
            if (conflicts.rows.length) throw new Error('entity id tenant conflict');
        }
        if (edgeIds.length) {
            const conflicts = await client.query(
                `SELECT id FROM graph_edges
                 WHERE id=ANY($1::text[])
                   AND NOT (project_id=ANY($2::text[]))
                 FOR UPDATE`,
                [edgeIds, authorizedProjectIds]
            );
            if (conflicts.rows.length) throw new Error('edge id tenant conflict');
        }
        for (const entity of snapshot.entities) {
            const result = await client.query(
                `INSERT INTO graph_entities
                 (id, entity_type, project_id, payload, role_min, sensitivity, lifecycle_status, version, updated_at)
                 VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,NOW())
                 ON CONFLICT (id) DO UPDATE SET entity_type=EXCLUDED.entity_type, project_id=EXCLUDED.project_id,
                   payload=EXCLUDED.payload, role_min=EXCLUDED.role_min, sensitivity=EXCLUDED.sensitivity,
                   lifecycle_status=EXCLUDED.lifecycle_status, version=EXCLUDED.version, updated_at=NOW()
                 WHERE graph_entities.project_id=ANY($9::text[])`,
                [entity.id, entity.entity_type, projectIds.get(entity.project_code), JSON.stringify(entity.payload || {}),
                    entity.role_min, entity.sensitivity, entity.lifecycle_status, entity.version, authorizedProjectIds]
            );
            if (!result.rowCount) throw new Error('entity id tenant conflict');
        }
        for (const edge of snapshot.edges) {
            const result = await client.query(
                `INSERT INTO graph_edges
                 (id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity, lifecycle_status, version, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,NOW())
                 ON CONFLICT (id) DO UPDATE SET from_id=EXCLUDED.from_id, to_id=EXCLUDED.to_id,
                   rel_type=EXCLUDED.rel_type, project_id=EXCLUDED.project_id, payload=EXCLUDED.payload,
                   role_min=EXCLUDED.role_min, sensitivity=EXCLUDED.sensitivity,
                   lifecycle_status=EXCLUDED.lifecycle_status, version=EXCLUDED.version, updated_at=NOW()
                 WHERE graph_edges.project_id=ANY($11::text[])`,
                [edge.id, edge.from_id, edge.to_id, edge.rel_type, projectIds.get(edge.project_code), JSON.stringify(edge.payload || {}),
                    edge.role_min, edge.sensitivity, edge.lifecycle_status, edge.version, authorizedProjectIds]
            );
            if (!result.rowCount) throw new Error('edge id tenant conflict');
        }
    }

    async applyPlan(access, { projectCode, planId, snapshotHash }) {
        this.assertMaintenanceAccess(access, projectCode);
        return this.infoSSOTService.withAccessContext(access, async (client) => {
            const organizationId = access.organizationId || access.tenantId;
            const { rows } = await client.query(
                `SELECT p.*, pr.code AS project_code FROM graph_maintenance_plans p
                 JOIN projects pr ON pr.id=p.project_id
                 WHERE p.id=$1 AND p.organization_id=$2 AND pr.code=$3 FOR UPDATE`,
                [planId, organizationId, projectCode]
            );
            const plan = rows[0];
            if (!plan) throw new Error('Unknown plan');
            const existing = await this.findReceipt(client, planId, 'apply');
            if (existing) return existing;
            if (plan.status !== 'planned') throw new Error(`Plan is not applicable: ${plan.status}`);
            if (snapshotHash !== plan.base_snapshot_hash) throw new Error('snapshot hash mismatch');
            if (hashGraphSnapshot(plan.before_snapshot) !== plan.base_snapshot_hash
                || hashGraphSnapshot(plan.after_snapshot) !== plan.after_snapshot_hash) {
                throw new Error('stored plan snapshot hash mismatch');
            }
            assertValidSnapshot(plan.after_snapshot, 'Stored Graph plan introduced invalid state', plan.before_snapshot);
            const { snapshot: current } = await this.loadSnapshot(client, access, projectCode, { lock: true });
            if (current.hash !== plan.base_snapshot_hash) throw new Error('snapshot hash conflict');
            await this.replaceSnapshot(client, access, plan.after_snapshot, { baseline: plan.before_snapshot });
            const readback = await this.loadSnapshotImage(client, access, plan.after_snapshot, { lock: true, baseline: plan.before_snapshot });
            if (readback.hash !== plan.after_snapshot_hash) throw new Error('Graph apply readback hash mismatch');
            const receipt = await this.createReceipt(client, access, plan, 'apply', plan.base_snapshot_hash, readback.hash);
            await client.query(`UPDATE graph_maintenance_plans SET status='applied', applied_at=NOW() WHERE id=$1`, [planId]);
            return receipt;
        });
    }

    async findReceipt(client, planId, type) {
        const { rows } = await client.query(
            `SELECT id AS receipt_id, plan_id, receipt_type, status, before_hash, after_hash, result, created_at
             FROM graph_maintenance_receipts WHERE plan_id=$1 AND receipt_type=$2`, [planId, type]
        );
        return rows[0] || null;
    }

    async createReceipt(client, access, plan, type, beforeHash, afterHash) {
        const receiptId = `gmr_${randomUUID()}`;
        const result = { operation_count: plan.operations.length, reason: plan.reason, idempotency_key: plan.idempotency_key };
        const { rows } = await client.query(
            `INSERT INTO graph_maintenance_receipts
             (id, plan_id, organization_id, project_id, receipt_type, status, before_hash, after_hash, result, actor_id)
             VALUES ($1,$2,$3,$4,$5,'completed',$6,$7,$8::jsonb,$9)
             RETURNING id AS receipt_id, plan_id, receipt_type, status, before_hash, after_hash, result, created_at`,
            [receiptId, plan.id, access.organizationId || access.tenantId, plan.project_id, type, beforeHash, afterHash, JSON.stringify(result), actor(access)]
        );
        return rows[0];
    }

    async getPlanReceipt(access, { projectCode, planId }) {
        this.assertMaintenanceAccess(access, projectCode);
        return this.infoSSOTService.withAccessContext(access, async (client) => {
            const { rows } = await client.query(
                `SELECT r.id AS receipt_id, r.plan_id, r.receipt_type, r.status, r.before_hash, r.after_hash, r.result, r.created_at
                 FROM graph_maintenance_receipts r JOIN projects p ON p.id=r.project_id
                 WHERE r.plan_id=$1 AND r.organization_id=$2 AND p.code=$3 ORDER BY r.created_at`,
                [planId, access.organizationId || access.tenantId, projectCode]
            );
            if (!rows.length) throw new Error('Plan receipt is required');
            return { plan_id: planId, receipts: rows };
        });
    }

    async rollbackPlan(access, { projectCode, planId, applyReceiptId }) {
        this.assertMaintenanceAccess(access, projectCode);
        return this.infoSSOTService.withAccessContext(access, async (client) => {
            const organizationId = access.organizationId || access.tenantId;
            const { rows } = await client.query(
                `SELECT p.*, pr.code AS project_code FROM graph_maintenance_plans p JOIN projects pr ON pr.id=p.project_id
                 WHERE p.id=$1 AND p.organization_id=$2 AND pr.code=$3 FOR UPDATE`, [planId, organizationId, projectCode]
            );
            const plan = rows[0];
            if (!plan) throw new Error('Unknown plan');
            const previousRollback = await this.findReceipt(client, planId, 'rollback');
            if (previousRollback) return previousRollback;
            const applyReceipt = await this.findReceipt(client, planId, 'apply');
            if (!applyReceipt || applyReceipt.receipt_id !== applyReceiptId) throw new Error('Valid apply receipt is required for rollback');
            if (hashGraphSnapshot(plan.before_snapshot) !== plan.base_snapshot_hash
                || hashGraphSnapshot(plan.after_snapshot) !== plan.after_snapshot_hash) {
                throw new Error('stored plan snapshot hash mismatch');
            }
            const current = await this.loadSnapshotImage(client, access, plan.after_snapshot, { lock: true, baseline: plan.before_snapshot });
            if (current.hash !== plan.after_snapshot_hash) throw new Error('rollback snapshot hash conflict');
            const beforeEdgeIds = new Set(plan.before_snapshot.edges.map((edge) => edge.id));
            const createdEdgeIds = [...new Set(plan.after_snapshot.edges.map((edge) => edge.id).filter((id) => !beforeEdgeIds.has(id)))];
            if (createdEdgeIds.length) {
                const edgeProjectCodes = [...new Set(plan.after_snapshot.edges
                    .filter((edge) => createdEdgeIds.includes(edge.id))
                    .map((edge) => edge.project_code))];
                const projects = await client.query(
                    `SELECT id FROM projects WHERE code=ANY($1::text[]) AND organization_id=$2`,
                    [edgeProjectCodes, organizationId]
                );
                if (projects.rows.length !== edgeProjectCodes.length) throw new Error('Access denied for rollback edge scope');
                await client.query(
                    `DELETE FROM graph_edges gx USING projects p
                     WHERE gx.id=ANY($1::text[]) AND gx.project_id=p.id
                       AND p.organization_id=$2 AND p.code=ANY($3::text[])`,
                    [createdEdgeIds, organizationId, edgeProjectCodes]
                );
                const remains = await client.query(`SELECT id FROM graph_edges WHERE id=ANY($1::text[])`, [createdEdgeIds]);
                if (remains.rows.length) throw new Error('Graph rollback created-edge cleanup failed');
            }
            await this.replaceSnapshot(client, access, plan.before_snapshot, { baseline: plan.before_snapshot });
            const readback = await this.loadSnapshotImage(client, access, plan.before_snapshot, { lock: true, baseline: plan.before_snapshot });
            if (readback.hash !== plan.base_snapshot_hash) throw new Error('Graph rollback readback hash mismatch');
            const receipt = await this.createReceipt(client, access, plan, 'rollback', current.hash, readback.hash);
            await client.query(`UPDATE graph_maintenance_plans SET status='rolled_back', rolled_back_at=NOW() WHERE id=$1`, [planId]);
            return receipt;
        });
    }

    async validate(access, { projectCode }) {
        return this.infoSSOTService.withAccessContext(access, async (client) => {
            const { snapshot } = await this.loadSnapshot(client, access, projectCode);
            const structural = validateGraphSnapshot(snapshot);
            const ontology = this.infoSSOTService.validateOntology({ snapshot: {
                entities: snapshot.entities.map((item) => ({ id: item.id, type: item.entity_type, payload: item.payload })),
                edges: snapshot.edges.filter((item) => item.lifecycle_status === 'active').map((item) => ({ from_id: item.from_id, to_id: item.to_id, relation: item.rel_type }))
            } });
            return {
                ...structural,
                valid: structural.valid === true && ontology?.valid === true,
                ontology,
                snapshot_hash: snapshot.hash
            };
        });
    }
}
