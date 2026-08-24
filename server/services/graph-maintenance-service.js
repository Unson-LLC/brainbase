import { createHash, randomUUID } from 'node:crypto';
import {
    buildGraphPlan,
    findIntroducedGraphValidationIssues,
    hashGraphSnapshot,
    validateGraphSnapshot
} from './graph-maintenance-engine.js';

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function fingerprint(value) {
    return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function plannedEdgeId(organizationId, projectCode, idempotencyKey, index) {
    return `edg_maint_${createHash('sha256').update(`${organizationId}\u0000${projectCode}\u0000${idempotencyKey}\u0000${index}`).digest('hex').slice(0, 32)}`;
}

function humanGateOperationScope(operation) {
    if (operation.operation === 'retire_entity') {
        return {
            operation: operation.operation,
            decision_id: operation.entity_id,
            decision_expected_version: operation.expected_version
        };
    }
    return {
        operation: operation.operation,
        decision_id: operation.decision_id,
        decision_expected_version: operation.decision_expected_version,
        subject_entity_id: operation.subject_entity_id,
        subject_expected_version: operation.subject_expected_version,
        target_project_code: operation.target_project_code,
        expected_version: operation.expected_version
    };
}

const HUMAN_GATE_EVIDENCE_KEYS = new Set(['operation_scope', 'source', 'review_ref', 'reason']);
const HUMAN_GATE_LINK_SCOPE_KEYS = new Set([
    'operation', 'decision_id', 'decision_expected_version', 'subject_entity_id',
    'subject_expected_version', 'target_project_code', 'expected_version'
]);
const HUMAN_GATE_RETIRE_SCOPE_KEYS = new Set(['operation', 'decision_id', 'decision_expected_version']);
const HUMAN_GATE_APPLY_SCOPE_KEYS = new Set([
    'operation', 'decision_id', 'plan_id', 'base_snapshot_hash', 'after_snapshot_hash',
    'operations_fingerprint', 'diff_fingerprint'
]);
const HUMAN_GATE_SCOPE_KEYS = new Set([
    ...HUMAN_GATE_LINK_SCOPE_KEYS, ...HUMAN_GATE_RETIRE_SCOPE_KEYS, ...HUMAN_GATE_APPLY_SCOPE_KEYS
]);
const SECRET_KEY_PATTERN = /(?:authorization|bearer|cookie|credential|password|secret|token|api[_-]?key)/i;
const SECRET_VALUE_PATTERN = /(?:\bBearer\s+[A-Za-z0-9._~+\/-]+=*|-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/;

function validateNoSecrets(value, path = 'evidence') {
    if (Array.isArray(value)) {
        value.forEach((item, index) => validateNoSecrets(item, `${path}[${index}]`));
        return;
    }
    if (value && typeof value === 'object') {
        for (const [key, nested] of Object.entries(value)) {
            if (SECRET_KEY_PATTERN.test(key)) {
                const error = new Error(`Human Gate evidence contains a forbidden secret field: ${path}.${key}`);
                error.code = 'GRAPH_HUMAN_GATE_EVIDENCE_SECRET';
                error.status = 400;
                throw error;
            }
            validateNoSecrets(nested, `${path}.${key}`);
        }
        return;
    }
    if (typeof value === 'string' && SECRET_VALUE_PATTERN.test(value)) {
        const error = new Error(`Human Gate evidence contains secret-like content: ${path}`);
        error.code = 'GRAPH_HUMAN_GATE_EVIDENCE_SECRET';
        error.status = 400;
        throw error;
    }
}

function validateHumanGateEvidence(evidence) {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
        const error = new Error('evidence must be an object');
        error.code = 'GRAPH_HUMAN_GATE_EVIDENCE_INVALID';
        error.status = 400;
        throw error;
    }
    validateNoSecrets(evidence);
    const unknownKeys = Object.keys(evidence).filter((key) => !HUMAN_GATE_EVIDENCE_KEYS.has(key));
    if (unknownKeys.length) {
        const error = new Error(`Unsupported Human Gate evidence field: ${unknownKeys[0]}`);
        error.code = 'GRAPH_HUMAN_GATE_EVIDENCE_INVALID';
        error.status = 400;
        throw error;
    }
    if (!evidence.operation_scope || typeof evidence.operation_scope !== 'object' || Array.isArray(evidence.operation_scope)) {
        const error = new Error('evidence.operation_scope is required and must be an object');
        error.code = 'GRAPH_HUMAN_GATE_EVIDENCE_INVALID';
        error.status = 400;
        throw error;
    }
    {
        const unknownScopeKeys = Object.keys(evidence.operation_scope).filter((key) => !HUMAN_GATE_SCOPE_KEYS.has(key));
        if (unknownScopeKeys.length) {
            const error = new Error(`Unsupported Human Gate operation_scope field: ${unknownScopeKeys[0]}`);
            error.code = 'GRAPH_HUMAN_GATE_EVIDENCE_INVALID';
            error.status = 400;
            throw error;
        }
        const scope = evidence.operation_scope;
        const linkShape = ['link_decision_subject', 'link_decision_project_subject'].includes(scope.operation)
            && ['decision_id', 'subject_entity_id', 'target_project_code'].every((key) => typeof scope[key] === 'string' && scope[key].length > 0)
            && ['decision_expected_version', 'subject_expected_version', 'expected_version']
                .every((key) => Number.isInteger(scope[key]) && scope[key] >= (key === 'expected_version' ? 0 : 1))
            && Object.keys(scope).length === HUMAN_GATE_LINK_SCOPE_KEYS.size;
        const retireShape = scope.operation === 'retire_entity'
            && typeof scope.decision_id === 'string' && scope.decision_id.length > 0
            && Number.isInteger(scope.decision_expected_version) && scope.decision_expected_version >= 1
            && Object.keys(scope).length === HUMAN_GATE_RETIRE_SCOPE_KEYS.size;
        const hashPattern = /^sha256:[a-f0-9]{64}$/;
        const applyShape = scope.operation === 'apply_plan'
            && ['decision_id', 'plan_id'].every((key) => typeof scope[key] === 'string' && scope[key].length > 0)
            && ['base_snapshot_hash', 'after_snapshot_hash', 'operations_fingerprint', 'diff_fingerprint']
                .every((key) => typeof scope[key] === 'string' && hashPattern.test(scope[key]))
            && Object.keys(scope).length === HUMAN_GATE_APPLY_SCOPE_KEYS.size;
        if (!linkShape && !retireShape && !applyShape) {
            const error = new Error('Human Gate operation_scope does not match the supported Decision subject contract');
            error.code = 'GRAPH_HUMAN_GATE_EVIDENCE_INVALID';
            error.status = 400;
            throw error;
        }
    }
    for (const [key, maxLength] of [['source', 200], ['review_ref', 500], ['reason', 1000]]) {
        if (evidence[key] !== undefined && (typeof evidence[key] !== 'string' || evidence[key].length > maxLength)) {
            const error = new Error(`Human Gate evidence.${key} must be a string of at most ${maxLength} characters`);
            error.code = 'GRAPH_HUMAN_GATE_EVIDENCE_INVALID';
            error.status = 400;
            throw error;
        }
    }
    if (Buffer.byteLength(JSON.stringify(evidence), 'utf8') > 8192) {
        const error = new Error('Human Gate evidence exceeds 8192 bytes');
        error.code = 'GRAPH_HUMAN_GATE_EVIDENCE_TOO_LARGE';
        error.status = 413;
        throw error;
    }
}

function applyHumanGateScope(plan, decisionId) {
    return {
        operation: 'apply_plan',
        decision_id: decisionId,
        plan_id: plan.id,
        base_snapshot_hash: plan.base_snapshot_hash,
        after_snapshot_hash: plan.after_snapshot_hash,
        operations_fingerprint: fingerprint(plan.operations),
        diff_fingerprint: fingerprint(planDiffSummary(plan.before_snapshot, plan.after_snapshot))
    };
}

function planDecisionIds(plan) {
    const decisionEntityIds = new Set([
        ...(plan.before_snapshot?.entities || []),
        ...(plan.after_snapshot?.entities || [])
    ].filter((entity) => entity.entity_type === 'decision').map((entity) => entity.id));
    return [...new Set((plan.operations || []).flatMap((operation) => [
        operation.decision_id,
        decisionEntityIds.has(operation.entity_id) ? operation.entity_id : null
    ]).filter(Boolean))];
}

function signedHumanPrincipalError(message) {
    const error = new Error(message);
    error.code = 'GRAPH_HUMAN_PRINCIPAL_REQUIRED';
    error.status = 403;
    return error;
}

function actor(access) {
    return access.personId || access.serviceId || 'authenticated-service';
}

function uniqueIds(records) {
    return [...new Set(records.map((record) => record.id))];
}

function snapshotProjectCodes(snapshot) {
    return [...new Set([
        snapshot.project_code,
        ...snapshot.entities.map((item) => item.project_code),
        ...snapshot.edges.map((item) => item.project_code)
    ].filter(Boolean))];
}

function externalEntityIds(snapshot) {
    return uniqueIds(snapshot.external_entities || []);
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

function changedRecords(before = [], after = [], limit = 100) {
    const beforeById = new Map(before.map((record) => [record.id, record]));
    const afterById = new Map(after.map((record) => [record.id, record]));
    const added = after.filter((record) => !beforeById.has(record.id));
    const removed = before.filter((record) => !afterById.has(record.id));
    const modified = after.filter((record) => beforeById.has(record.id)
        && JSON.stringify(beforeById.get(record.id)) !== JSON.stringify(record));
    const describe = (record) => ({ id: record.id, ...(record.from_id ? {
        from_id: record.from_id, to_id: record.to_id, rel_type: record.rel_type,
        project_code: record.project_code
    } : {}) });
    return {
        added_count: added.length, removed_count: removed.length, modified_count: modified.length,
        added: added.slice(0, limit).map(describe), removed: removed.slice(0, limit).map(describe),
        modified: modified.slice(0, limit).map(describe),
        truncated: added.length > limit || removed.length > limit || modified.length > limit
    };
}

function planDiffSummary(before, after) {
    const beforeValidation = validateGraphSnapshot(before);
    const afterValidation = validateGraphSnapshot(after);
    const count = (validation, category) => validation.issues.filter((issue) => issue.category === category).length;
    return {
        entities: changedRecords(before.entities, after.entities),
        edges: changedRecords(before.edges, after.edges),
        validation: {
            before_valid: beforeValidation.valid, after_valid: afterValidation.valid,
            issue_count_before: beforeValidation.issues.length, issue_count_after: afterValidation.issues.length,
            issue_count_delta: afterValidation.issues.length - beforeValidation.issues.length,
            orphan_count_before: count(beforeValidation, 'orphan_entity'),
            orphan_count_after: count(afterValidation, 'orphan_entity'),
            orphan_count_delta: count(afterValidation, 'orphan_entity') - count(beforeValidation, 'orphan_entity')
        }
    };
}

export class GraphMaintenanceService {
    constructor({ infoSSOTService, configParser = null }) {
        this.infoSSOTService = infoSSOTService;
        this.configParser = configParser;
    }

    async bindProjectCatalogOperations(access, operations) {
        const materializations = operations.filter((operation) => operation.operation === 'materialize_project_subject');
        if (!materializations.length) return operations;
        if (!this.configParser) {
            const error = new Error('Project Catalog resolver is unavailable');
            error.code = 'GRAPH_PROJECT_CATALOG_UNAVAILABLE';
            error.status = 503;
            throw error;
        }
        const integrity = await this.configParser.checkIntegrity();
        if (integrity.applicability !== 'applicable' || integrity.summary?.errors > 0) {
            const error = new Error('Project Catalog source is unavailable or invalid');
            error.code = 'GRAPH_PROJECT_CATALOG_UNAVAILABLE';
            error.status = 503;
            error.details = { source_status: integrity.source?.status || 'unknown' };
            throw error;
        }
        const catalog = await this.configParser.getProjects();
        const byId = new Map((catalog.projects || []).filter((project) => !project.archived).map((project) => [project.id, project]));
        return operations.map((operation) => {
            if (operation.operation !== 'materialize_project_subject') return operation;
            const project = byId.get(operation.catalog_project_id);
            if (!project || !access.projectCodes.includes(project.id)) {
                const error = new Error(`Project Catalog subject is missing or inaccessible: ${operation.catalog_project_id}`);
                error.code = 'GRAPH_PROJECT_CATALOG_SUBJECT_INACCESSIBLE';
                error.status = 403;
                throw error;
            }
            const catalogVersion = project.catalog_version;
            if (!Number.isInteger(catalogVersion) || catalogVersion < 1 || !String(project.name || '').trim()) {
                const error = new Error(`Project Catalog subject metadata is incomplete: ${project.id}`);
                error.code = 'GRAPH_PROJECT_CATALOG_SUBJECT_INVALID';
                error.status = 409;
                throw error;
            }
            return {
                ...operation,
                entity_id: project.id,
                catalog_project_id: project.id,
                catalog_version: catalogVersion,
                name: project.name,
                source_ref: `project-catalog:${project.id}@${catalogVersion}`
            };
        });
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

    async loadExternalEntities(client, access, operations, { lock = false } = {}) {
        const links = operations.filter((operation) => operation.operation === 'link_decision_subject');
        if (!links.length) return [];
        if (access.role !== 'ceo') throw new Error('Cross-tenant Decision subject link requires ceo role');
        const requestedCodes = [...new Set(links.map((operation) => operation.target_project_code))];
        if (requestedCodes.some((code) => !access.projectCodes.includes(code))) throw new Error('Access denied for target project scope');
        const ids = [...new Set(links.map((operation) => operation.subject_entity_id))];
        const suffix = lock ? ' FOR UPDATE' : '';
        const { rows } = await client.query(
            `SELECT ge.id, ge.entity_type, p.code AS project_code, p.organization_id,
                    ge.role_min,
                    ge.sensitivity, ge.lifecycle_status, ge.version
             FROM graph_entities ge JOIN projects p ON p.id=ge.project_id
             WHERE ge.id=ANY($1::text[]) AND p.code=ANY($2::text[])
               AND p.organization_id IS NOT NULL
             ORDER BY ge.id${suffix}`,
            [ids, requestedCodes]
        );
        if (rows.length !== ids.length) throw new Error('Decision subject target is missing or inaccessible');
        for (const link of links) {
            const target = rows.find((row) => row.id === link.subject_entity_id);
            if (!target || target.project_code !== link.target_project_code) throw new Error('Product target scope mismatch');
        }
        const sourceOrganizationId = access.organizationId || access.tenantId;
        if (rows.some((row) => row.organization_id === sourceOrganizationId)) {
            throw new Error('Decision subject target must belong to a different tenant organization');
        }
        return rows;
    }

    async loadExternalEntitiesFromImage(client, access, image, { lock = false } = {}) {
        const expected = image.external_entities || [];
        if (!expected.length) return [];
        if (access.role !== 'ceo') throw new Error('Cross-tenant Decision subject link requires ceo role');
        const codes = [...new Set(expected.map((entity) => entity.project_code))];
        if (codes.some((code) => !access.projectCodes.includes(code))) throw new Error('Access denied for target project scope');
        const suffix = lock ? ' FOR UPDATE' : '';
        const { rows } = await client.query(
            `SELECT ge.id, ge.entity_type, p.code AS project_code, p.organization_id,
                    ge.role_min,
                    ge.sensitivity, ge.lifecycle_status, ge.version
             FROM graph_entities ge JOIN projects p ON p.id=ge.project_id
             WHERE ge.id=ANY($1::text[]) AND p.code=ANY($2::text[])
               AND p.organization_id IS NOT NULL
             ORDER BY ge.id${suffix}`,
            [externalEntityIds(image), codes]
        );
        if (rows.length !== expected.length) throw new Error('Decision subject target is missing or inaccessible');
        const sourceOrganizationId = access.organizationId || access.tenantId;
        if (rows.some((row) => row.organization_id === sourceOrganizationId)) {
            throw new Error('Decision subject target must belong to a different tenant organization');
        }
        return rows;
    }

    async loadSnapshot(client, access, projectCode, { lock = false, includeProjectCodes = [] } = {}) {
        const projectCodes = [...new Set([projectCode, ...includeProjectCodes].filter(Boolean))].sort();
        const projects = [];
        for (const code of projectCodes) projects.push(await this.resolveProject(client, access, code, { lock }));
        const project = projects.find((item) => item.code === projectCode);
        const projectIds = projects.map((item) => item.id);
        const suffix = lock ? ' FOR UPDATE' : '';
        const [entityResult, edgeResult] = await Promise.all([
            client.query(
                `SELECT ge.id, ge.entity_type, p.code AS project_code, ge.payload, ge.role_min,
                        ge.sensitivity, ge.lifecycle_status, ge.version
                 FROM graph_entities ge JOIN projects p ON p.id = ge.project_id
                 WHERE ge.project_id=ANY($1::text[]) ORDER BY ge.id${suffix}`,
                [projectIds]
            ),
            client.query(
                `SELECT gx.id, gx.from_id, gx.to_id, gx.rel_type, p.code AS project_code, gx.payload,
                        gx.role_min, gx.sensitivity, gx.lifecycle_status, gx.version
                 FROM graph_edges gx JOIN projects p ON p.id = gx.project_id
                 WHERE gx.project_id=ANY($1::text[])
                   AND (
                     NOT (gx.payload ? 'target_project_code' OR gx.payload ? 'cross_tenant')
                     OR (
                       $2::text='ceo'
                       AND gx.rel_type='governs'
                       AND gx.payload->>'cross_tenant'='true'
                       AND gx.role_min='ceo'
                       AND gx.sensitivity='restricted'
                       AND gx.payload->>'target_project_code'=ANY($3::text[])
                     )
                   )
                 ORDER BY gx.id${suffix}`,
                [projectIds, access.role, access.projectCodes]
            )
        ]);
        const endpointIds = [...new Set(edgeResult.rows.flatMap((edge) => [edge.from_id, edge.to_id]))];
        const endpointResult = endpointIds.length ? await client.query(
            `SELECT ge.id FROM graph_entities ge WHERE ge.id=ANY($1::text[])`,
            [endpointIds]
        ) : { rows: [] };
        const visibleEndpointIds = new Set(endpointResult.rows.map((row) => row.id));
        // Legacy rows with an unresolved or inaccessible endpoint stay in the
        // database for forensic repair, but must never disclose that endpoint
        // through a maintenance snapshot. Canonical rows require both endpoints.
        const visibleEdges = edgeResult.rows.filter((edge) => (
            visibleEndpointIds.has(edge.from_id) && visibleEndpointIds.has(edge.to_id)
        ));
        const snapshot = { project_code: projectCode, entities: entityResult.rows, edges: visibleEdges };
        const crossTenantLinks = visibleEdges
            .filter((edge) => edge.rel_type === 'governs' && edge.payload?.cross_tenant === true)
            .map((edge) => ({
                operation: 'link_decision_subject',
                subject_entity_id: edge.to_id,
                target_project_code: edge.payload.target_project_code
            }));
        if (crossTenantLinks.length) {
            snapshot.external_entities = await this.loadExternalEntities(client, access, crossTenantLinks, { lock });
        }
        snapshot.hash = hashGraphSnapshot(snapshot);
        return { project, snapshot };
    }

    async loadSnapshotImage(client, access, image, { lock = false, baseline = null } = {}) {
        assertValidSnapshot(image, 'Graph snapshot image is invalid', baseline);
        const organizationId = access.organizationId || access.tenantId;
        const codes = snapshotProjectCodes(image);
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

    async exportSnapshot(access, { projectCode, includeProjectCodes = [] }) {
        return this.infoSSOTService.withAccessContext({ ...access, graphMaintenanceMode: true }, async (client) => {
            const { project, snapshot } = await this.loadSnapshot(client, access, projectCode, { includeProjectCodes });
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
        return this.infoSSOTService.withAccessContext({ ...access, graphMaintenanceMode: true }, async (client) => {
            const organizationId = access.organizationId || access.tenantId;
            const { rows: snapshotRows } = await client.query(
                `SELECT s.*, p.code AS project_code FROM graph_maintenance_snapshots s
                 JOIN projects p ON p.id = s.project_id
                 WHERE s.id = $1 AND s.organization_id = $2 AND p.code = $3`,
                [input.snapshotId, organizationId, input.projectCode]
            );
            const stored = snapshotRows[0];
            if (!stored) throw new Error('Unknown snapshot');
            const catalogBoundOperations = await this.bindProjectCatalogOperations(access, input.operations || []);
            const normalizedOperations = catalogBoundOperations.map((operation, index) => {
                const deterministicEdgeId = plannedEdgeId(organizationId, input.projectCode, input.idempotencyKey, index);
                if (['upsert_edge', 'link_decision_subject', 'link_decision_project_subject'].includes(operation.operation)
                    && operation.expected_version === 0) {
                    return {
                        ...operation,
                        ...(operation.operation === 'link_decision_project_subject' ? { target_project_code: input.projectCode } : {}),
                        edge_id: deterministicEdgeId
                    };
                }
                if (operation.operation === 'rehome_entity' && operation.new_membership_expected_version === 0) {
                    return { ...operation, new_membership_edge_id: deterministicEdgeId };
                }
                return operation;
            });
            if (normalizedOperations.some((operation) => operation.operation === 'link_decision_subject')) {
                const includesForeignProjectRows = stored.snapshot.entities.some((entity) => entity.project_code !== input.projectCode)
                    || stored.snapshot.edges.some((edge) => edge.project_code !== input.projectCode);
                if (includesForeignProjectRows) {
                    const error = new Error('Decision subject link requires a source-only snapshot');
                    error.code = 'GRAPH_CROSS_TENANT_SNAPSHOT_SCOPE_MISMATCH';
                    error.status = 409;
                    throw error;
                }
            }
            const targetProjectCodes = [...new Set(normalizedOperations
                .filter((operation) => ['move_scope', 'rehome_entity'].includes(operation.operation))
                .map((operation) => operation.target_project_code)
                .filter(Boolean))];
            for (const targetProjectCode of targetProjectCodes) {
                await this.resolveProject(client, access, targetProjectCode);
            }
            const newEdgeOperations = normalizedOperations.filter((operation) => [
                'upsert_edge', 'link_decision_subject', 'link_decision_project_subject'
            ].includes(operation.operation) && operation.expected_version === 0);
            const plannedEdgeIds = [
                ...newEdgeOperations.map((operation) => operation.edge_id),
                ...normalizedOperations
                    .filter((operation) => operation.operation === 'rehome_entity' && operation.new_membership_expected_version === 0)
                    .map((operation) => operation.new_membership_edge_id)
            ];
            if (plannedEdgeIds.length) {
                const collision = await client.query(
                    `SELECT id FROM graph_edges WHERE id=ANY($1::text[]) FOR UPDATE`,
                    [plannedEdgeIds]
                );
                if (collision.rows.length) throw new Error('planned edge id conflict');
            }
            const externalEntities = await this.loadExternalEntities(client, access, normalizedOperations, { lock: true });
            const planningSnapshot = structuredClone(stored.snapshot);
            const localEntityIds = new Set(planningSnapshot.entities.map((entity) => entity.id));
            const externalOnlyEntities = externalEntities.filter((entity) => !localEntityIds.has(entity.id));
            if (externalOnlyEntities.length) {
                planningSnapshot.external_entities = [...new Map([
                    ...(planningSnapshot.external_entities || []),
                    ...externalOnlyEntities
                ].map((entity) => [entity.id, entity])).values()]
                    .sort((left, right) => left.id.localeCompare(right.id));
                planningSnapshot.hash = hashGraphSnapshot(planningSnapshot);
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
                    `SELECT id, approved_by, approved_at, evidence FROM graph_maintenance_human_gate_receipts
                     WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND decision_id=$4
                       AND status='approved' AND approved_by <> '' AND approved_at IS NOT NULL`,
                    [receiptId, organizationId, stored.project_id, decision.id]
                );
                const expectedScope = humanGateOperationScope(operation);
                if (!gate.rows[0] || fingerprint(gate.rows[0].evidence?.operation_scope) !== fingerprint(expectedScope)) {
                    throw new Error('Valid Human Gate receipt is required for Active Decision');
                }
            }
            for (const operation of normalizedOperations.filter((candidate) => [
                'link_decision_subject', 'link_decision_project_subject'
            ].includes(candidate.operation))) {
                const decision = stored.snapshot.entities.find((entity) => entity.id === operation.decision_id);
                const receiptId = operation.human_gate_receipt || input.humanGateReceipt;
                const gate = await client.query(
                    `SELECT id, evidence FROM graph_maintenance_human_gate_receipts
                     WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND decision_id=$4
                       AND status='approved' AND approved_by <> '' AND approved_at IS NOT NULL`,
                    [receiptId, organizationId, stored.project_id, decision?.id]
                );
                const approvedScope = gate.rows[0]?.evidence?.operation_scope;
                const expectedScope = humanGateOperationScope(operation);
                const hasApprovedScope = approvedScope && typeof approvedScope === 'object' && !Array.isArray(approvedScope);
                if (!decision || !gate.rows[0] || !hasApprovedScope || fingerprint(approvedScope) !== fingerprint(expectedScope)) {
                    const error = new Error('Human Gate receipt does not approve this Decision subject operation');
                    error.code = 'GRAPH_HUMAN_GATE_SCOPE_MISMATCH';
                    error.status = 409;
                    error.details = { expected_operation_scope: expectedScope };
                    throw error;
                }
            }
            if (hashGraphSnapshot(stored.snapshot) !== stored.snapshot_hash) throw new Error('snapshot hash mismatch');
            const plan = buildGraphPlan(planningSnapshot, {
                project_code: input.projectCode,
                idempotency_key: input.idempotencyKey,
                reason: input.reason,
                operations: normalizedOperations,
                human_gate_receipt: input.humanGateReceipt
            });
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
            throw signedHumanPrincipalError('Human Gate approval requires a signed human Bearer principal');
        }
        if (!String(decisionId || '').trim() || !String(receiptId || '').trim()) {
            throw new Error('decision_id and receipt_id are required');
        }
        validateHumanGateEvidence(evidence);
        if (evidence.operation_scope.decision_id !== decisionId) {
            const error = new Error('Human Gate operation_scope decision_id must match decision_id');
            error.code = 'GRAPH_HUMAN_GATE_SCOPE_MISMATCH';
            error.status = 409;
            throw error;
        }
        return this.infoSSOTService.withAccessContext({ ...access, graphMaintenanceMode: true }, async (client) => {
            const organizationId = access.organizationId || access.tenantId;
            const project = await this.resolveProject(client, access, projectCode, { lock: true });
            if (evidence.operation_scope.operation === 'link_decision_subject') {
                await this.loadExternalEntities(client, access, [evidence.operation_scope], { lock: true });
            }
            if (evidence.operation_scope.operation === 'apply_plan') {
                const { rows } = await client.query(
                    `SELECT * FROM graph_maintenance_plans
                     WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND status='planned' FOR UPDATE`,
                    [evidence.operation_scope.plan_id, organizationId, project.id]
                );
                const plan = rows[0];
                const includesDecision = planDecisionIds(plan || {}).includes(decisionId);
                const expectedScope = plan && includesDecision ? applyHumanGateScope(plan, decisionId) : null;
                if (!expectedScope || fingerprint(expectedScope) !== fingerprint(evidence.operation_scope)) {
                    const error = new Error('Human Gate receipt does not approve this exact dry-run plan');
                    error.code = 'GRAPH_HUMAN_GATE_SCOPE_MISMATCH';
                    error.status = 409;
                    error.details = expectedScope ? { expected_operation_scope: expectedScope } : undefined;
                    throw error;
                }
                if (plan.before_snapshot?.external_entities?.length) {
                    await this.loadExternalEntitiesFromImage(client, access, plan.before_snapshot, { lock: true });
                }
            }
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
            if (fingerprint(row.evidence?.operation_scope) !== fingerprint(evidence.operation_scope)) {
                const error = new Error('Human Gate receipt id is already bound to a different operation scope');
                error.code = 'GRAPH_HUMAN_GATE_SCOPE_MISMATCH';
                error.status = 409;
                error.details = { expected_operation_scope: evidence.operation_scope };
                throw error;
            }
            return row;
        });
    }

    formatPlan(row) {
        const decisionIds = planDecisionIds(row);
        return {
            plan_id: row.id, status: row.status, dry_run: row.status === 'planned',
            snapshot_id: row.snapshot_id, snapshot_hash: row.base_snapshot_hash,
            after_snapshot_hash: row.after_snapshot_hash, reason: row.reason,
            idempotency_key: row.idempotency_key, operations: row.operations,
            operation_count: row.operations.length,
            apply_human_gate_scope: decisionIds.length === 1 ? applyHumanGateScope(row, decisionIds[0]) : null,
            diff_summary: planDiffSummary(row.before_snapshot, row.after_snapshot),
            before: row.before_snapshot, after: row.after_snapshot
        };
    }

    async replaceSnapshot(client, access, snapshot, { baseline = null } = {}) {
        assertValidSnapshot(snapshot, 'Graph snapshot is invalid', baseline);
        const organizationId = access.organizationId || access.tenantId;
        const codes = snapshotProjectCodes(snapshot);
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

    async applyPlan(access, { projectCode, planId, snapshotHash, humanGateReceipt }) {
        this.assertMaintenanceAccess(access, projectCode);
        return this.infoSSOTService.withAccessContext({ ...access, graphMaintenanceMode: true }, async (client) => {
            const organizationId = access.organizationId || access.tenantId;
            const { rows } = await client.query(
                `SELECT p.*, pr.code AS project_code FROM graph_maintenance_plans p
                 JOIN projects pr ON pr.id=p.project_id
                 WHERE p.id=$1 AND p.organization_id=$2 AND pr.code=$3 FOR UPDATE`,
                [planId, organizationId, projectCode]
            );
            const plan = rows[0];
            if (!plan) throw new Error('Unknown plan');
            if (snapshotHash !== plan.base_snapshot_hash) throw new Error('snapshot hash mismatch');
            const existing = await this.findReceipt(client, planId, 'apply', { organizationId, projectCode });
            if (existing) return existing;
            const decisionIds = planDecisionIds(plan);
            if (decisionIds.length > 1) {
                const error = new Error('Apply-specific Human Gate currently requires a single Decision plan');
                error.code = 'GRAPH_APPLY_HUMAN_GATE_SCOPE_UNSUPPORTED';
                error.status = 409;
                throw error;
            }
            if (decisionIds.length === 1) {
                if (access.authSource !== 'bearer' || !String(access.personId || '').trim() || access.personId === 'internal_api') {
                    throw signedHumanPrincipalError('Graph Apply requires a signed human Bearer principal');
                }
                if (!String(humanGateReceipt || '').trim()) {
                    const error = new Error('Apply-specific Human Gate receipt is required');
                    error.code = 'GRAPH_APPLY_HUMAN_GATE_REQUIRED';
                    error.status = 403;
                    throw error;
                }
                const gate = await client.query(
                    `SELECT id, evidence FROM graph_maintenance_human_gate_receipts
                     WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND decision_id=$4
                       AND status='approved' AND approved_by <> '' AND approved_at IS NOT NULL`,
                    [humanGateReceipt, organizationId, plan.project_id, decisionIds[0]]
                );
                const expectedApplyScope = applyHumanGateScope(plan, decisionIds[0]);
                if (!gate.rows[0] || fingerprint(gate.rows[0].evidence?.operation_scope) !== fingerprint(expectedApplyScope)) {
                    const error = new Error('Human Gate receipt does not approve this exact dry-run plan');
                    error.code = 'GRAPH_HUMAN_GATE_SCOPE_MISMATCH';
                    error.status = 409;
                    error.details = { expected_operation_scope: expectedApplyScope };
                    throw error;
                }
            }
            if (plan.status !== 'planned') throw new Error(`Plan is not applicable: ${plan.status}`);
            if (hashGraphSnapshot(plan.before_snapshot) !== plan.base_snapshot_hash
                || hashGraphSnapshot(plan.after_snapshot) !== plan.after_snapshot_hash) {
                throw new Error('stored plan snapshot hash mismatch');
            }
            assertValidSnapshot(plan.after_snapshot, 'Stored Graph plan introduced invalid state', plan.before_snapshot);
            const { snapshot: current } = await this.loadSnapshot(client, access, projectCode, {
                lock: true,
                includeProjectCodes: snapshotProjectCodes(plan.before_snapshot).filter((code) => code !== projectCode)
            });
            if (plan.before_snapshot.external_entities?.length) {
                current.external_entities = await this.loadExternalEntitiesFromImage(client, access, plan.before_snapshot, { lock: true });
                current.hash = hashGraphSnapshot(current);
            }
            if (current.hash !== plan.base_snapshot_hash) throw new Error('snapshot hash conflict');
            await this.replaceSnapshot(client, access, plan.after_snapshot, { baseline: plan.before_snapshot });
            const { snapshot: readback } = await this.loadSnapshot(client, access, projectCode, {
                lock: true,
                includeProjectCodes: snapshotProjectCodes(plan.after_snapshot).filter((code) => code !== projectCode)
            });
            if (plan.after_snapshot.external_entities?.length) {
                readback.external_entities = await this.loadExternalEntitiesFromImage(client, access, plan.after_snapshot, { lock: true });
                readback.hash = hashGraphSnapshot(readback);
            }
            if (readback.hash !== plan.after_snapshot_hash) throw new Error('Graph apply readback hash mismatch');
            const receipt = await this.createReceipt(client, access, plan, 'apply', plan.base_snapshot_hash, readback.hash);
            await client.query(`UPDATE graph_maintenance_plans SET status='applied', applied_at=NOW() WHERE id=$1`, [planId]);
            return receipt;
        });
    }

    async findReceipt(client, planId, type, { organizationId, projectCode } = {}) {
        if (!String(organizationId || '').trim() || !String(projectCode || '').trim()) {
            throw new Error('Receipt lookup requires tenant and project scope');
        }
        const { rows } = await client.query(
            `SELECT r.id AS receipt_id, r.plan_id, r.receipt_type, r.status, r.before_hash, r.after_hash, r.result, r.created_at
             FROM graph_maintenance_receipts r
             JOIN graph_maintenance_plans p ON p.id=r.plan_id
             JOIN projects project_scope ON project_scope.id=p.project_id
             WHERE r.plan_id=$1 AND r.receipt_type=$2
               AND r.organization_id=$3 AND r.project_id=p.project_id
               AND p.organization_id=$3 AND project_scope.organization_id=$3
               AND project_scope.code=$4`, [planId, type, organizationId, projectCode]
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
        return this.infoSSOTService.withAccessContext({ ...access, graphMaintenanceMode: true }, async (client) => {
            const { rows } = await client.query(
                `SELECT r.id AS receipt_id, r.plan_id, r.receipt_type, r.status, r.before_hash, r.after_hash, r.result, r.created_at
                 FROM graph_maintenance_receipts r
                 JOIN graph_maintenance_plans plan_scope ON plan_scope.id=r.plan_id
                 JOIN projects project_scope ON project_scope.id=plan_scope.project_id
                 WHERE r.plan_id=$1 AND r.organization_id=$2
                   AND r.project_id=plan_scope.project_id
                   AND plan_scope.organization_id=$2
                   AND project_scope.organization_id=$2
                   AND project_scope.code=$3
                 ORDER BY r.created_at`,
                [planId, access.organizationId || access.tenantId, projectCode]
            );
            if (!rows.length) throw new Error('Plan receipt is required');
            return { plan_id: planId, receipts: rows };
        });
    }

    async rollbackPlan(access, { projectCode, planId, applyReceiptId }) {
        this.assertMaintenanceAccess(access, projectCode);
        return this.infoSSOTService.withAccessContext({ ...access, graphMaintenanceMode: true }, async (client) => {
            const organizationId = access.organizationId || access.tenantId;
            const { rows } = await client.query(
                `SELECT p.*, pr.code AS project_code FROM graph_maintenance_plans p JOIN projects pr ON pr.id=p.project_id
                 WHERE p.id=$1 AND p.organization_id=$2 AND pr.code=$3 FOR UPDATE`, [planId, organizationId, projectCode]
            );
            const plan = rows[0];
            if (!plan) throw new Error('Unknown plan');
            const previousRollback = await this.findReceipt(client, planId, 'rollback', { organizationId, projectCode });
            if (previousRollback) return previousRollback;
            const applyReceipt = await this.findReceipt(client, planId, 'apply', { organizationId, projectCode });
            if (!applyReceipt || applyReceipt.receipt_id !== applyReceiptId) throw new Error('Valid apply receipt is required for rollback');
            if (hashGraphSnapshot(plan.before_snapshot) !== plan.base_snapshot_hash
                || hashGraphSnapshot(plan.after_snapshot) !== plan.after_snapshot_hash) {
                throw new Error('stored plan snapshot hash mismatch');
            }
            const { snapshot: current } = await this.loadSnapshot(client, access, projectCode, {
                lock: true,
                includeProjectCodes: snapshotProjectCodes(plan.after_snapshot).filter((code) => code !== projectCode)
            });
            if (plan.after_snapshot.external_entities?.length) {
                current.external_entities = await this.loadExternalEntitiesFromImage(client, access, plan.after_snapshot, { lock: true });
                current.hash = hashGraphSnapshot(current);
            }
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
            const beforeEntityIds = new Set(plan.before_snapshot.entities.map((entity) => entity.id));
            const createdEntityIds = [...new Set(plan.after_snapshot.entities
                .map((entity) => entity.id)
                .filter((id) => !beforeEntityIds.has(id)))];
            if (createdEntityIds.length) {
                const entityProjectCodes = [...new Set(plan.after_snapshot.entities
                    .filter((entity) => createdEntityIds.includes(entity.id))
                    .map((entity) => entity.project_code))];
                const projects = await client.query(
                    `SELECT id FROM projects WHERE code=ANY($1::text[]) AND organization_id=$2`,
                    [entityProjectCodes, organizationId]
                );
                if (projects.rows.length !== entityProjectCodes.length) throw new Error('Access denied for rollback entity scope');
                await client.query(
                    `DELETE FROM graph_entities ge USING projects p
                     WHERE ge.id=ANY($1::text[]) AND ge.project_id=p.id
                       AND p.organization_id=$2 AND p.code=ANY($3::text[])`,
                    [createdEntityIds, organizationId, entityProjectCodes]
                );
                const remains = await client.query(`SELECT id FROM graph_entities WHERE id=ANY($1::text[])`, [createdEntityIds]);
                if (remains.rows.length) throw new Error('Graph rollback created-entity cleanup failed');
            }
            await this.replaceSnapshot(client, access, plan.before_snapshot, { baseline: plan.before_snapshot });
            const { snapshot: readback } = await this.loadSnapshot(client, access, projectCode, {
                lock: true,
                includeProjectCodes: snapshotProjectCodes(plan.before_snapshot).filter((code) => code !== projectCode)
            });
            if (plan.before_snapshot.external_entities?.length) {
                readback.external_entities = await this.loadExternalEntitiesFromImage(client, access, plan.before_snapshot, { lock: true });
                readback.hash = hashGraphSnapshot(readback);
            }
            if (readback.hash !== plan.base_snapshot_hash) throw new Error('Graph rollback readback hash mismatch');
            const receipt = await this.createReceipt(client, access, plan, 'rollback', current.hash, readback.hash);
            await client.query(`UPDATE graph_maintenance_plans SET status='rolled_back', rolled_back_at=NOW() WHERE id=$1`, [planId]);
            return receipt;
        });
    }

    async validate(access, { projectCode, includeProjectCodes = [] }) {
        return this.infoSSOTService.withAccessContext({ ...access, graphMaintenanceMode: true }, async (client) => {
            const { snapshot } = await this.loadSnapshot(client, access, projectCode, { includeProjectCodes });
            const structural = validateGraphSnapshot(snapshot);
            const ontology = this.infoSSOTService.validateOntology({ snapshot: {
                entities: [...snapshot.entities, ...(snapshot.external_entities || [])]
                    .map((item) => ({ id: item.id, type: item.entity_type, payload: item.payload || {} })),
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
