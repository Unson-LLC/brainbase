// Moved from brainbase-unson server/services/graph-maintenance-engine.js without changing behavior.
// Only type annotations were added; graph records stay open JSON objects as in the original.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';

export type GraphRecord = Record<string, any>;
export type GraphEntity = GraphRecord;
export type GraphEdge = GraphRecord;
export type GraphSnapshot = GraphRecord;
export type GraphOperation = GraphRecord;
export type GraphValidationIssue = { category: string; id?: unknown };
export type GraphValidation = {
    valid: boolean;
    counts: { entities: number; edges: number; issues: number; duplicates: number; orphans: number };
    issues: GraphValidationIssue[];
};
export type GraphPlanInput = GraphRecord;
export type GraphPlan = {
    dry_run: true;
    project_code: any;
    idempotency_key: any;
    reason: string;
    operations: GraphOperation[];
    operation_count: number;
    before_hash: string;
    after_hash: string;
    validation: GraphValidation;
    before: GraphSnapshot;
    after: GraphSnapshot;
};

export const GRAPH_MAINTENANCE_OPERATIONS: readonly string[] = Object.freeze([
    'patch_entity', 'merge_entities', 'retire_entity', 'reactivate_project', 'move_scope', 'rehome_entity',
    'upsert_edge', 'link_decision_subject', 'materialize_project_subject',
    'link_decision_project_subject', 'retire_edge', 'normalize_alias',
    'normalize_merged_lifecycle', 'create_entity', 'delete_entity', 'delete_edge',
    'add_shared_membership'
]);
export const GRAPH_MAINTENANCE_MAX_OPERATIONS = 100;

const SENSITIVITY_RANK: Record<string, number> = { internal: 0, restricted: 1, finance: 2, hr: 2, contract: 2 };
const ROLE_RANK: Record<string, number> = { member: 1, gm: 2, ceo: 3 };
const LIFECYCLE_STATUSES = new Set(['active', 'retired', 'superseded']);

function canonicalize(value: any): any {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function withoutHash(snapshot: GraphSnapshot): GraphSnapshot {
    const copy = structuredClone(snapshot);
    delete copy.hash;
    delete copy.snapshot_hash;
    delete copy.snapshot_id;
    delete copy.exported_at;
    copy.entities = [...(copy.entities || [])].sort((a: GraphEntity, b: GraphEntity) => a.id.localeCompare(b.id));
    if (Object.hasOwn(copy, 'external_entities')) {
        copy.external_entities = [...(copy.external_entities || [])].sort((a: GraphEntity, b: GraphEntity) => a.id.localeCompare(b.id));
    }
    copy.edges = [...(copy.edges || [])].sort((a: GraphEdge, b: GraphEdge) => a.id.localeCompare(b.id));
    return copy;
}

export function hashGraphSnapshot(snapshot: GraphSnapshot): string {
    return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(withoutHash(snapshot)))).digest('hex')}`;
}

function requireVersion(record: GraphRecord, operation: GraphRecord): void {
    if (!Number.isInteger(operation.expected_version)) throw new Error('expected_version is required');
    if (record.version !== operation.expected_version) throw new Error('expected_version conflict');
}

function assertSensitivity(current: any, next: any): void {
    if (!(current in SENSITIVITY_RANK)) throw new Error('Invalid sensitivity');
    if (next === undefined) return;
    if (!(next in SENSITIVITY_RANK)) throw new Error('Invalid sensitivity');
    if (SENSITIVITY_RANK[next] < SENSITIVITY_RANK[current]) throw new Error('sensitivity cannot be lowered');
}

function assertRoleMinimum(current: any, next: any): void {
    if (!(current in ROLE_RANK)) throw new Error('Invalid role_min');
    if (next === undefined) return;
    if (!(next in ROLE_RANK)) throw new Error('Invalid role_min');
    if (ROLE_RANK[next] < ROLE_RANK[current]) throw new Error('role_min cannot be lowered');
}

function assertAccessMetadata(roleMin: any, sensitivity: any): void {
    if (!(roleMin in ROLE_RANK)) throw new Error('Invalid role_min');
    if (!(sensitivity in SENSITIVITY_RANK)) throw new Error('Invalid sensitivity');
    if (SENSITIVITY_RANK[sensitivity] >= SENSITIVITY_RANK.finance && roleMin === 'member') {
        throw new Error('Sensitive data requires role_min gm or ceo');
    }
}

function validationError(validation: { issues: GraphValidationIssue[] }, prefix = 'Graph snapshot is invalid'): Error {
    return new Error(`${prefix}: ${validation.issues.map((item) => item.category).join(',')}`);
}

function validationIssueKey(issue: GraphValidationIssue): string {
    return JSON.stringify(canonicalize(issue));
}

function introducedValidationIssues(before: GraphValidation, after: GraphValidation): GraphValidationIssue[] {
    const remaining = new Map<string, number>();
    for (const issue of before.issues) {
        const key = validationIssueKey(issue);
        remaining.set(key, (remaining.get(key) || 0) + 1);
    }
    return after.issues.filter((issue) => {
        const key = validationIssueKey(issue);
        const count = remaining.get(key) || 0;
        if (count === 0) return true;
        remaining.set(key, count - 1);
        return false;
    });
}

export function findIntroducedGraphValidationIssues(beforeSnapshot: GraphSnapshot, afterSnapshot: GraphSnapshot): GraphValidationIssue[] {
    return introducedValidationIssues(validateGraphSnapshot(beforeSnapshot), validateGraphSnapshot(afterSnapshot));
}

function findEntity(state: GraphSnapshot, id: any): GraphEntity {
    const entity = (state.entities || []).find((item: GraphEntity) => item.id === id);
    if (!entity) throw new Error(`Unknown entity: ${id}`);
    return entity;
}

function findAnyEntity(state: GraphSnapshot, id: any): GraphEntity {
    const entity = [...(state.entities || []), ...(state.external_entities || [])].find((item: GraphEntity) => item.id === id);
    if (!entity) throw new Error(`Unknown entity: ${id}`);
    return entity;
}

function findAnyEntityOrNull(state: GraphSnapshot, id: any): GraphEntity | null {
    return [...(state.entities || []), ...(state.external_entities || [])].find((item: GraphEntity) => item.id === id) || null;
}

function assertProjectCatalogProvenance(project: GraphEntity): void {
    const catalogProjectId = project.payload?.catalog_project_id;
    if (catalogProjectId !== project.id) {
        throw new Error('Project subject catalog_project_id must match Graph Entity ID');
    }
    const catalogVersion = project.payload?.catalog_version;
    if (!Number.isInteger(catalogVersion) || catalogVersion < 1) {
        throw new Error('Project subject catalog_version must be a positive integer');
    }
    const expectedSourceRef = `project-catalog:${catalogProjectId}@${catalogVersion}`;
    if (project.payload?.source_ref !== expectedSourceRef) {
        throw new Error('Project subject source_ref must match Catalog Project identity and version');
    }
    if (!String(project.payload?.name || '').trim()) {
        throw new Error('Project subject Catalog name is required');
    }
}

function isActiveDecision(entity: GraphEntity): boolean {
    return entity.entity_type === 'decision'
        && entity.lifecycle_status === 'active'
        && !['retired', 'superseded'].includes(String(entity.payload?.status || '').toLowerCase());
}

function findEdge(state: GraphSnapshot, operation: GraphRecord): GraphEdge {
    const edge = operation.edge_id
        ? state.edges.find((item: GraphEdge) => item.id === operation.edge_id)
        : state.edges.find((item: GraphEdge) => item.from_id === operation.from_id && item.to_id === operation.to_id && item.rel_type === operation.rel_type);
    if (!edge) throw new Error('Unknown edge');
    return edge;
}

const SHARED_MEMBERSHIP_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Add one person -> project member_of edge for a shared Person that lives
 * outside this project. The Person and every existing edge stay unchanged;
 * an existing active membership makes the operation a no-op.
 */
function addSharedMembership(state: GraphSnapshot, operation: GraphOperation, humanGateReceipt: unknown): void {
    const decision = findEntity(state, operation.decision_id);
    const project = findEntity(state, operation.target_project_entity_id);
    const person = (state.external_entities || []).find((item: GraphEntity) => item.id === operation.subject_entity_id);
    if (!person) throw new Error('Shared person endpoint is required');
    requireVersion(decision, { expected_version: operation.decision_expected_version });
    requireVersion(person, { expected_version: operation.subject_expected_version });
    requireVersion(project, { expected_version: operation.target_project_expected_version });
    if (!isActiveDecision(decision) || decision.project_code !== state.project_code) {
        throw new Error('active Decision in the target project is required');
    }
    if (person.entity_type !== 'person' || person.lifecycle_status !== 'active'
        || !['shared_person', 'same_organization'].includes(person.reference_scope)) {
        throw new Error('active shared Person is required');
    }
    if (project.entity_type !== 'project' || project.lifecycle_status !== 'active'
        || project.project_code !== state.project_code) {
        throw new Error('active Project entity in the target project is required');
    }
    if (operation.target_project_code !== state.project_code) throw new Error('target_project_code must be the plan project');
    const receipt = operation.human_gate_receipt || humanGateReceipt;
    if (!String(receipt || '').trim()) throw new Error('human_gate_receipt is required for shared membership');
    const basis = String(operation.basis || '').trim();
    if (!basis || basis.length > 1000) throw new Error('basis is required (at most 1000 characters)');
    const confirmedAt = String(operation.confirmed_at || '');
    if (!SHARED_MEMBERSHIP_DATE.test(confirmedAt) || Number.isNaN(Date.parse(`${confirmedAt}T00:00:00Z`))) {
        throw new Error('confirmed_at must be a YYYY-MM-DD date');
    }
    const existing = state.edges.find((edge: GraphEdge) => edge.from_id === person.id && edge.to_id === project.id
        && edge.rel_type === 'member_of');
    if (existing?.lifecycle_status === 'active') return;
    if (existing) throw new Error('A retired membership exists; reactivate it with upsert_edge');
    if (operation.expected_version !== 0) throw new Error('expected_version conflict');
    if (!String(operation.edge_id || '').trim()) throw new Error('edge_id is required');
    if (state.edges.some((edge: GraphEdge) => edge.id === operation.edge_id)) throw new Error('edge id conflict');
    state.edges.push({
        id: operation.edge_id,
        from_id: person.id,
        to_id: project.id,
        rel_type: 'member_of',
        project_code: state.project_code,
        payload: {
            source: 'graph_maintenance:add_shared_membership',
            source_graph_scope: 'shared_person',
            basis,
            confirmed_at: confirmedAt,
            decision_id: decision.id,
            human_gate_receipt: receipt
        },
        role_min: 'member',
        sensitivity: 'internal',
        lifecycle_status: 'active',
        version: 1
    });
}

export function applyGraphOperations(
    snapshot: GraphSnapshot,
    operations: GraphOperation[],
    { projectCode, humanGateReceipt }: { projectCode?: unknown; humanGateReceipt?: unknown } = {}
): GraphSnapshot {
    const initialValidation = validateGraphSnapshot(snapshot);
    const state = withoutHash(snapshot);
    if (state.project_code !== projectCode) throw new Error('project scope mismatch');
    for (const operation of operations) {
        if (!GRAPH_MAINTENANCE_OPERATIONS.includes(operation.operation)) throw new Error(`Unknown graph operation: ${operation.operation}`);
        if (operation.operation === 'create_entity') {
            if (operation.expected_version !== 0) throw new Error('expected_version conflict');
            const entityId = String(operation.entity_id || '').trim();
            const entityType = String(operation.entity_type || '').trim();
            if (!entityId) throw new Error('entity_id is required');
            if (!entityType) throw new Error('entity_type is required');
            // Project subjects carry Project Catalog provenance and are created
            // only through materialize_project_subject.
            if (entityType === 'project') throw new Error('Project entities must use materialize_project_subject');
            if (operation.payload !== undefined
                && (!operation.payload || typeof operation.payload !== 'object' || Array.isArray(operation.payload))) {
                throw new Error('payload must be an object');
            }
            if (findAnyEntityOrNull(state, entityId)) throw new Error('entity id conflict');
            const roleMin = operation.role_min || 'member';
            const sensitivity = operation.sensitivity || 'internal';
            assertAccessMetadata(roleMin, sensitivity);
            state.entities.push({
                id: entityId,
                entity_type: entityType,
                project_code: state.project_code,
                payload: structuredClone(operation.payload || {}),
                role_min: roleMin,
                sensitivity,
                lifecycle_status: 'active',
                version: 1
            });
        } else if (operation.operation === 'delete_entity') {
            // Physical removal. retire_entity remains the logical lifecycle change.
            const entity = findEntity(state, operation.entity_id);
            if (entity.entity_type === 'project') throw new Error('Project entities cannot be physically deleted; use retire_entity');
            requireVersion(entity, operation);
            if (isActiveDecision(entity) && !(operation.human_gate_receipt || humanGateReceipt)) {
                throw new Error('human_gate_receipt is required for Active Decision');
            }
            if (state.edges.some((edge: GraphEdge) => edge.from_id === entity.id || edge.to_id === entity.id)) {
                throw new Error('entity still has edges; delete them in the same plan first');
            }
            state.entities = state.entities.filter((item: GraphEntity) => item.id !== entity.id);
        } else if (operation.operation === 'delete_edge') {
            const edge = findEdge(state, operation);
            requireVersion(edge, operation);
            state.edges = state.edges.filter((item: GraphEdge) => item.id !== edge.id);
        } else if (operation.operation === 'patch_entity') {
            const entity = findEntity(state, operation.entity_id);
            requireVersion(entity, operation);
            assertSensitivity(entity.sensitivity, operation.sensitivity);
            assertRoleMinimum(entity.role_min, operation.role_min);
            entity.payload = { ...entity.payload, ...(operation.patch || {}) };
            if (operation.role_min !== undefined) entity.role_min = operation.role_min;
            if (operation.sensitivity !== undefined) entity.sensitivity = operation.sensitivity;
            assertAccessMetadata(entity.role_min, entity.sensitivity);
            entity.version += 1;
        } else if (operation.operation === 'retire_entity') {
            const entity = findEntity(state, operation.entity_id);
            requireVersion(entity, operation);
            if (isActiveDecision(entity) && !(operation.human_gate_receipt || humanGateReceipt)) throw new Error('human_gate_receipt is required for Active Decision');
            entity.lifecycle_status = 'retired';
            entity.version += 1;
        } else if (operation.operation === 'reactivate_project') {
            const entity = findEntity(state, operation.entity_id);
            requireVersion(entity, operation);
            if (entity.entity_type !== 'project') throw new Error('reactivate_project requires a Project entity');
            if (entity.lifecycle_status !== 'retired') throw new Error('reactivate_project requires a retired Project');
            entity.lifecycle_status = 'active';
            entity.version += 1;
        } else if (operation.operation === 'move_scope') {
            const entity = findEntity(state, operation.entity_id);
            requireVersion(entity, operation);
            if (!operation.target_project_code) throw new Error('target_project_code is required');
            entity.project_code = operation.target_project_code;
            entity.version += 1;
            for (const edge of state.edges.filter((item: GraphEdge) => item.from_id === entity.id || item.to_id === entity.id)) {
                edge.project_code = operation.target_project_code;
                edge.version += 1;
            }
        } else if (operation.operation === 'rehome_entity') {
            const entity = findEntity(state, operation.entity_id);
            requireVersion(entity, operation);
            if (!String(operation.target_project_code || '').trim()) throw new Error('target_project_code is required');
            if (!String(operation.target_project_entity_id || '').trim()) throw new Error('target_project_entity_id is required');
            const targetProject = findEntity(state, operation.target_project_entity_id);
            requireVersion(targetProject, { expected_version: operation.target_project_expected_version });
            if (targetProject.entity_type !== 'project') throw new Error('target Project entity_type is required');
            if (targetProject.lifecycle_status !== 'active') throw new Error('target Project must be active');
            if (targetProject.project_code !== operation.target_project_code) throw new Error('target Project scope mismatch');

            if (!String(operation.membership_edge_id || '').trim()) throw new Error('membership_edge_id is required');
            const membership = findEdge(state, { edge_id: operation.membership_edge_id });
            requireVersion(membership, { expected_version: operation.membership_expected_version });
            if (membership.rel_type !== 'belongs_to_project'
                || membership.from_id !== entity.id
                || membership.lifecycle_status !== 'active') {
                throw new Error('active belongs_to_project membership is required');
            }
            if (membership.project_code !== entity.project_code) throw new Error('membership source scope mismatch');

            if (operation.new_membership_expected_version !== 0) throw new Error('expected_version conflict');
            if (!String(operation.new_membership_edge_id || '').trim()) throw new Error('new_membership_edge_id is required');
            if (state.edges.some((edge: GraphEdge) => edge.id === operation.new_membership_edge_id)) throw new Error('edge id conflict');

            membership.lifecycle_status = 'retired';
            membership.version += 1;
            entity.project_code = operation.target_project_code;
            entity.version += 1;
            state.edges.push({
                ...structuredClone(membership),
                id: operation.new_membership_edge_id,
                from_id: entity.id,
                to_id: targetProject.id,
                project_code: operation.target_project_code,
                lifecycle_status: 'active',
                version: 1
            });
        } else if (operation.operation === 'merge_entities') {
            const source = findEntity(state, operation.source_entity_id);
            const target = findEntity(state, operation.target_entity_id);
            requireVersion(source, { expected_version: operation.source_expected_version });
            requireVersion(target, { expected_version: operation.target_expected_version });
            if (source.project_code !== target.project_code) throw new Error('project scope mismatch');
            assertSensitivity(source.sensitivity, target.sensitivity);
            assertRoleMinimum(source.role_min, target.role_min);
            target.payload = { ...source.payload, ...target.payload, aliases: [...new Set([...(target.payload?.aliases || []), source.id, ...(source.payload?.aliases || [])])] };
            target.version += 1;
            source.lifecycle_status = 'superseded';
            source.payload = { ...source.payload, canonical_entity_id: target.id };
            source.version += 1;
            for (const edge of state.edges) {
                let changed = false;
                if (edge.from_id === source.id) { edge.from_id = target.id; changed = true; }
                if (edge.to_id === source.id) { edge.to_id = target.id; changed = true; }
                if (changed) edge.version += 1;
            }
        } else if (operation.operation === 'normalize_merged_lifecycle') {
            const source = findEntity(state, operation.entity_id);
            const target = findEntity(state, operation.target_entity_id);
            requireVersion(source, operation);
            requireVersion(target, { expected_version: operation.target_expected_version });
            if (source.id === target.id) throw new Error('source and target must differ');
            if (source.project_code !== target.project_code) throw new Error('project scope mismatch');
            if (source.entity_type !== target.entity_type) throw new Error('entity_type mismatch');
            if (source.lifecycle_status !== 'merged') throw new Error('source lifecycle_status must be merged');
            if (source.payload?.canonical_entity_id !== target.id) throw new Error('canonical_entity_id mismatch');
            if (target.lifecycle_status !== 'active') throw new Error('target must be active');
            if (state.edges.some((edge: GraphEdge) => edge.lifecycle_status === 'active'
                && (edge.from_id === source.id || edge.to_id === source.id))) {
                throw new Error('source still has active edges');
            }
            source.lifecycle_status = 'superseded';
            source.version += 1;
        } else if (operation.operation === 'upsert_edge') {
            const externalIds = new Set((state.external_entities || []).map((entity: GraphEntity) => entity.id));
            const toEntity = findAnyEntity(state, operation.to_id);
            const localFrom = (state.entities || []).find((item: GraphEntity) => item.id === operation.from_id) || null;
            const externalFrom = localFrom ? null : findAnyEntityOrNull(state, operation.from_id);
            // The accountable person of a tool: a same-organization person outside this project.
            const sameOrganizationToolAccountable = operation.rel_type === 'accountable_for'
                && externalFrom?.entity_type === 'person'
                && externalFrom.lifecycle_status === 'active'
                && externalFrom.reference_scope === 'same_organization'
                && externalIds.has(externalFrom.id)
                && !externalIds.has(toEntity.id)
                && toEntity.entity_type === 'app'
                && toEntity.lifecycle_status === 'active';
            if (!localFrom && !sameOrganizationToolAccountable) throw new Error(`Unknown entity: ${operation.from_id}`);
            const fromEntity = (localFrom || externalFrom) as GraphEntity;
            // A project of this scope using a same-organization tool of another project.
            const sameOrganizationProjectUsesApp = operation.rel_type === 'uses_app'
                && Boolean(localFrom)
                && fromEntity.entity_type === 'project'
                && fromEntity.lifecycle_status === 'active'
                && toEntity.entity_type === 'app'
                && toEntity.lifecycle_status === 'active'
                && toEntity.reference_scope === 'same_organization'
                && externalIds.has(toEntity.id);
            const sameOrganizationAppOwner = operation.rel_type === 'owned_by'
                && fromEntity.entity_type === 'app'
                && fromEntity.lifecycle_status === 'active'
                && toEntity.entity_type === 'org'
                && toEntity.lifecycle_status === 'active'
                && toEntity.reference_scope === 'same_organization'
                && (state.external_entities || []).some((entity: GraphEntity) => entity.id === toEntity.id);
            const sameOrganizationDecisionOwner = operation.rel_type === 'owned_by'
                && isActiveDecision(fromEntity)
                && toEntity.entity_type === 'person'
                && toEntity.lifecycle_status === 'active'
                && toEntity.reference_scope === 'same_organization'
                && (state.external_entities || []).some((entity: GraphEntity) => entity.id === toEntity.id);
            if (sameOrganizationDecisionOwner && operation.decision_id !== fromEntity.id) {
                // Bind this relationship mutation to the existing plan-level Human Gate.
                throw new Error('decision_id must match the Decision owner source');
            }
            if (fromEntity.project_code !== toEntity.project_code && !sameOrganizationAppOwner && !sameOrganizationDecisionOwner
                && !sameOrganizationToolAccountable && !sameOrganizationProjectUsesApp) {
                throw new Error('edge endpoint project scope mismatch');
            }
            if (!String(operation.rel_type || '').trim()) throw new Error('rel_type is required');
            const existing = state.edges.find((item: GraphEdge) => item.from_id === operation.from_id && item.to_id === operation.to_id && item.rel_type === operation.rel_type);
            const edgeById = operation.edge_id ? state.edges.find((item: GraphEdge) => item.id === operation.edge_id) : null;
            if (existing && operation.edge_id && existing.id !== operation.edge_id) throw new Error('edge_id does not match existing edge');
            if (!existing && edgeById) throw new Error('edge id conflict');
            if (existing) {
                requireVersion(existing, operation);
                assertSensitivity(existing.sensitivity, operation.sensitivity);
                assertRoleMinimum(existing.role_min, operation.role_min);
                existing.payload = { ...existing.payload, ...(operation.payload || {}) };
                if (operation.role_min !== undefined) existing.role_min = operation.role_min;
                if (operation.sensitivity !== undefined) existing.sensitivity = operation.sensitivity;
                assertAccessMetadata(existing.role_min, existing.sensitivity);
                existing.lifecycle_status = 'active';
                existing.version += 1;
            } else {
                if (operation.expected_version !== 0) throw new Error('expected_version conflict');
                if (!operation.edge_id) throw new Error('edge_id is required');
                const roleMin = operation.role_min || 'member';
                const sensitivity = operation.sensitivity || 'internal';
                assertAccessMetadata(roleMin, sensitivity);
                state.edges.push({
                    id: operation.edge_id,
                    from_id: operation.from_id, to_id: operation.to_id, rel_type: operation.rel_type,
                    // The accountable person lives in another project; the edge belongs to the tool's project.
                    project_code: sameOrganizationToolAccountable ? toEntity.project_code : fromEntity.project_code,
                    payload: operation.payload || {}, role_min: roleMin,
                    sensitivity, lifecycle_status: 'active', version: 1
                });
            }
        } else if (operation.operation === 'materialize_project_subject') {
            if (operation.expected_version !== 0) throw new Error('expected_version conflict');
            if (!String(operation.entity_id || '').trim()) throw new Error('entity_id is required');
            if (operation.catalog_project_id !== operation.entity_id) {
                throw new Error('Catalog Project ID must match Graph Entity ID');
            }
            if (!Number.isInteger(operation.catalog_version) || operation.catalog_version < 1) {
                throw new Error('catalog_version must be a positive integer');
            }
            if (!String(operation.name || '').trim()) throw new Error('name is required');
            const expectedSourceRef = `project-catalog:${operation.catalog_project_id}@${operation.catalog_version}`;
            if (operation.source_ref !== expectedSourceRef) throw new Error('source_ref must match Catalog Project identity and version');
            if (findAnyEntityOrNull(state, operation.entity_id)) throw new Error('entity id conflict');
            state.entities.push({
                id: operation.entity_id,
                entity_type: 'project',
                project_code: state.project_code,
                payload: {
                    name: operation.name,
                    catalog_project_id: operation.catalog_project_id,
                    catalog_version: operation.catalog_version,
                    source_ref: operation.source_ref,
                    ...(operation.kind ? { kind: operation.kind } : {}),
                    ...(operation.organization_entity_id
                        ? { organization_entity_id: operation.organization_entity_id } : {}),
                    ...(operation.owner_person_id ? { owner_person_id: operation.owner_person_id } : {})
                },
                role_min: 'member',
                sensitivity: 'internal',
                lifecycle_status: 'active',
                version: 1
            });
        } else if (operation.operation === 'link_decision_project_subject') {
            const decision = findEntity(state, operation.decision_id);
            const subject = findEntity(state, operation.subject_entity_id);
            requireVersion(decision, { expected_version: operation.decision_expected_version });
            requireVersion(subject, { expected_version: operation.subject_expected_version });
            if (decision.entity_type !== 'decision' || decision.lifecycle_status !== 'active') throw new Error('active Decision source is required');
            if (subject.entity_type !== 'project' || subject.lifecycle_status !== 'active') throw new Error('active Project subject is required');
            assertProjectCatalogProvenance(subject);
            if (decision.project_code !== state.project_code || subject.project_code !== state.project_code) {
                throw new Error('Decision project subject scope mismatch');
            }
            if (!(operation.human_gate_receipt || humanGateReceipt)) {
                throw new Error('human_gate_receipt is required for Decision project subject link');
            }
            if (operation.expected_version !== 0) throw new Error('expected_version conflict');
            if (!String(operation.edge_id || '').trim()) throw new Error('edge_id is required');
            if (state.edges.some((edge: GraphEdge) => edge.id === operation.edge_id)) throw new Error('edge id conflict');
            if (state.edges.some((edge: GraphEdge) => edge.from_id === decision.id && edge.to_id === subject.id && edge.rel_type === 'governs')) {
                throw new Error('Decision project subject edge already exists');
            }
            state.edges.push({
                id: operation.edge_id,
                from_id: decision.id,
                to_id: subject.id,
                rel_type: 'governs',
                project_code: decision.project_code,
                payload: { catalog_project_id: subject.payload.catalog_project_id },
                role_min: 'ceo',
                sensitivity: 'restricted',
                lifecycle_status: 'active',
                version: 1
            });
        } else if (operation.operation === 'link_decision_subject') {
            const decision = findEntity(state, operation.decision_id);
            const subject = findAnyEntity(state, operation.subject_entity_id);
            requireVersion(decision, { expected_version: operation.decision_expected_version });
            requireVersion(subject, { expected_version: operation.subject_expected_version });
            if (decision.entity_type !== 'decision' || decision.lifecycle_status !== 'active') throw new Error('active Decision source is required');
            if (subject.entity_type !== 'product' || subject.lifecycle_status !== 'active') throw new Error('active Product subject is required');
            if (decision.project_code !== state.project_code) throw new Error('Decision source scope mismatch');
            if (!String(operation.target_project_code || '').trim() || subject.project_code !== operation.target_project_code) {
                throw new Error('Product target scope mismatch');
            }
            if (decision.project_code === subject.project_code) throw new Error('link_decision_subject requires cross-project endpoints');
            if (!(operation.human_gate_receipt || humanGateReceipt)) throw new Error('human_gate_receipt is required for Decision subject link');
            if (operation.expected_version !== 0) throw new Error('expected_version conflict');
            if (!String(operation.edge_id || '').trim()) throw new Error('edge_id is required');
            if (state.edges.some((edge: GraphEdge) => edge.id === operation.edge_id)) throw new Error('edge id conflict');
            if (state.edges.some((edge: GraphEdge) => edge.from_id === decision.id && edge.to_id === subject.id && edge.rel_type === 'governs')) {
                throw new Error('Decision subject edge already exists');
            }
            state.edges.push({
                id: operation.edge_id,
                from_id: decision.id,
                to_id: subject.id,
                rel_type: 'governs',
                project_code: decision.project_code,
                payload: { ...(operation.payload || {}), target_project_code: subject.project_code, cross_tenant: true },
                role_min: 'ceo',
                sensitivity: 'restricted',
                lifecycle_status: 'active',
                version: 1
            });
        } else if (operation.operation === 'add_shared_membership') {
            addSharedMembership(state, operation, humanGateReceipt);
        } else if (operation.operation === 'retire_edge') {
            const edge = findEdge(state, operation);
            requireVersion(edge, operation);
            edge.lifecycle_status = 'retired';
            edge.version += 1;
        } else if (operation.operation === 'normalize_alias') {
            const entity = findEntity(state, operation.entity_id);
            requireVersion(entity, operation);
            const aliases: unknown[] = Array.isArray(operation.aliases) ? operation.aliases : entity.payload?.aliases || [];
            entity.payload = { ...entity.payload, aliases: [...new Set(aliases.map((item) => String(item).trim()).filter(Boolean))].sort() };
            entity.version += 1;
        }
    }
    const finalValidation = validateGraphSnapshot(state);
    const introducedIssues = introducedValidationIssues(initialValidation, finalValidation);
    if (introducedIssues.length) {
        throw validationError({ issues: introducedIssues }, 'Graph operations introduced invalid state');
    }
    state.hash = hashGraphSnapshot(state);
    return state;
}

export function buildGraphPlan(snapshot: GraphSnapshot, input: GraphPlanInput = {}): GraphPlan {
    if (!String(input.reason || '').trim()) throw new Error('reason is required');
    if (!String(input.idempotency_key || '').trim()) throw new Error('idempotency_key is required');
    if (snapshot.project_code !== input.project_code) throw new Error('project scope mismatch');
    if (snapshot.hash && snapshot.hash !== hashGraphSnapshot(snapshot)) throw new Error('snapshot hash mismatch');
    const operations = Array.isArray(input.operations) ? input.operations : [];
    const max = Math.min(Number(input.max_operations) || GRAPH_MAINTENANCE_MAX_OPERATIONS, GRAPH_MAINTENANCE_MAX_OPERATIONS);
    if (operations.length > max) throw new Error('bulk operation limit exceeded');
    const before = structuredClone(snapshot);
    before.hash = hashGraphSnapshot(before);
    const after = applyGraphOperations(before, operations, { projectCode: input.project_code, humanGateReceipt: input.human_gate_receipt });
    const validation = validateGraphSnapshot(after);
    return {
        dry_run: true,
        project_code: input.project_code,
        idempotency_key: input.idempotency_key,
        reason: input.reason.trim(),
        operations,
        operation_count: operations.length,
        before_hash: before.hash,
        after_hash: after.hash,
        validation,
        before,
        after
    };
}

export function validateGraphSnapshot(snapshot: any): GraphValidation {
    const issues: GraphValidationIssue[] = [];
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        return { valid: false, counts: { entities: 0, edges: 0, issues: 1, duplicates: 0, orphans: 0 }, issues: [{ category: 'snapshot' }] };
    }
    if (!String(snapshot.project_code || '').trim()) issues.push({ category: 'project_scope' });
    if (!Array.isArray(snapshot.entities)) issues.push({ category: 'entities' });
    if (!Array.isArray(snapshot.edges)) issues.push({ category: 'edges' });
    const entityIds = new Set<any>();
    const entitiesById = new Map<any, GraphEntity>();
    const externalEntityIds = new Set((Array.isArray(snapshot.external_entities) ? snapshot.external_entities : [])
        .map((entity: GraphEntity) => entity?.id)
        .filter(Boolean));
    const allEntities = [
        ...(Array.isArray(snapshot.entities) ? snapshot.entities : []),
        ...(Array.isArray(snapshot.external_entities) ? snapshot.external_entities : [])
    ];
    for (const entity of allEntities) {
        if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
            issues.push({ category: 'entity' });
            continue;
        }
        if (!String(entity.id || '').trim()) issues.push({ category: 'entity_id', id: entity.id });
        if (entityIds.has(entity.id)) issues.push({ category: 'duplicate_entity', id: entity.id });
        entityIds.add(entity.id);
        entitiesById.set(entity.id, entity);
        if (!Number.isInteger(entity.version) || entity.version < 1) issues.push({ category: 'version', id: entity.id });
        if (!String(entity.entity_type || '').trim()) issues.push({ category: 'entity_type', id: entity.id });
        if (!String(entity.project_code || '').trim()) issues.push({ category: 'project_scope', id: entity.id });
        if (!(entity.role_min in ROLE_RANK)) issues.push({ category: 'role_min', id: entity.id });
        if (!(entity.sensitivity in SENSITIVITY_RANK)) issues.push({ category: 'sensitivity', id: entity.id });
        if (!LIFECYCLE_STATUSES.has(entity.lifecycle_status)) issues.push({ category: 'lifecycle', id: entity.id });
        // Cross-tenant endpoints are deliberately represented by metadata only.
        // Requiring payload here would either invalidate every safe plan or copy
        // target-tenant business data into the source-tenant receipt.
        if (!externalEntityIds.has(entity.id)
            && (!entity.payload || typeof entity.payload !== 'object' || Array.isArray(entity.payload))) {
            issues.push({ category: 'payload', id: entity.id });
        }
        if (SENSITIVITY_RANK[entity.sensitivity] >= SENSITIVITY_RANK.finance && entity.role_min === 'member') {
            issues.push({ category: 'sensitivity_role', id: entity.id });
        }
    }
    const edgeKeys = new Set<string>();
    const edgeIds = new Set<any>();
    for (const edge of Array.isArray(snapshot.edges) ? snapshot.edges : []) {
        if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
            issues.push({ category: 'edge' });
            continue;
        }
        if (!String(edge.id || '').trim()) issues.push({ category: 'edge_id', id: edge.id });
        if (edgeIds.has(edge.id)) issues.push({ category: 'duplicate_edge_id', id: edge.id });
        edgeIds.add(edge.id);
        if (!Number.isInteger(edge.version) || edge.version < 1) issues.push({ category: 'edge_version', id: edge.id });
        if (!String(edge.rel_type || '').trim()) issues.push({ category: 'rel_type', id: edge.id });
        if (!String(edge.project_code || '').trim()) issues.push({ category: 'project_scope', id: edge.id });
        if (!(edge.role_min in ROLE_RANK)) issues.push({ category: 'role_min', id: edge.id });
        if (!(edge.sensitivity in SENSITIVITY_RANK)) issues.push({ category: 'sensitivity', id: edge.id });
        if (!LIFECYCLE_STATUSES.has(edge.lifecycle_status)) issues.push({ category: 'lifecycle', id: edge.id });
        if (!edge.payload || typeof edge.payload !== 'object' || Array.isArray(edge.payload)) issues.push({ category: 'payload', id: edge.id });
        if (SENSITIVITY_RANK[edge.sensitivity] >= SENSITIVITY_RANK.finance && edge.role_min === 'member') {
            issues.push({ category: 'sensitivity_role', id: edge.id });
        }
        if (!entityIds.has(edge.from_id) || !entityIds.has(edge.to_id)) issues.push({ category: 'orphan', id: edge.id });
        if (edge.rel_type === 'belongs_to_project' && edge.lifecycle_status === 'active') {
            const source = entitiesById.get(edge.from_id);
            const target = entitiesById.get(edge.to_id);
            if (source && target && (target.entity_type !== 'project'
                || source.project_code !== edge.project_code
                || target.project_code !== edge.project_code)) {
                issues.push({ category: 'membership_scope', id: edge.id });
            }
        }
        const source = entitiesById.get(edge.from_id);
        const target = entitiesById.get(edge.to_id);
        const targetIsCrossTenant = externalEntityIds.has(target?.id)
            && target!.reference_scope !== 'same_organization';
        if (source && target
            && (targetIsCrossTenant || edge.payload?.cross_tenant === true)
            && source.project_code !== target.project_code) {
            const canonicalCrossTenant = edge.rel_type === 'governs'
                && edge.project_code === source.project_code
                && edge.payload?.cross_tenant === true
                && edge.payload?.target_project_code === target.project_code
                && edge.role_min === 'ceo'
                && edge.sensitivity === 'restricted';
            if (!canonicalCrossTenant
                || source.entity_type !== 'decision'
                || source.lifecycle_status !== 'active'
                || target.entity_type !== 'product'
                || target.reference_scope === 'same_organization'
                || target.lifecycle_status !== 'active') {
                issues.push({ category: 'cross_tenant_edge', id: edge.id });
            }
        }
        const key = `${edge.from_id}\u0000${edge.to_id}\u0000${edge.rel_type}`;
        if (edgeKeys.has(key)) issues.push({ category: 'duplicate_edge', id: edge.id });
        edgeKeys.add(key);
    }
    return {
        valid: issues.length === 0,
        counts: {
            entities: Array.isArray(snapshot.entities) ? snapshot.entities.length : 0,
            edges: Array.isArray(snapshot.edges) ? snapshot.edges.length : 0,
            issues: issues.length,
            duplicates: issues.filter((item) => item.category.startsWith('duplicate')).length,
            orphans: issues.filter((item) => item.category === 'orphan').length
        },
        issues
    };
}
