import { createHash } from 'node:crypto';

export const GRAPH_MAINTENANCE_OPERATIONS = Object.freeze([
    'patch_entity', 'merge_entities', 'retire_entity', 'move_scope',
    'upsert_edge', 'retire_edge', 'normalize_alias'
]);
export const GRAPH_MAINTENANCE_MAX_OPERATIONS = 100;

const SENSITIVITY_RANK = { internal: 0, restricted: 1, finance: 2, hr: 2, contract: 2 };
const ROLE_RANK = { member: 1, gm: 2, ceo: 3 };
const LIFECYCLE_STATUSES = new Set(['active', 'retired', 'superseded']);

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function withoutHash(snapshot) {
    const copy = structuredClone(snapshot);
    delete copy.hash;
    delete copy.snapshot_hash;
    delete copy.snapshot_id;
    delete copy.exported_at;
    copy.entities = [...(copy.entities || [])].sort((a, b) => a.id.localeCompare(b.id));
    copy.edges = [...(copy.edges || [])].sort((a, b) => a.id.localeCompare(b.id));
    return copy;
}

export function hashGraphSnapshot(snapshot) {
    return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(withoutHash(snapshot)))).digest('hex')}`;
}

function requireVersion(record, operation) {
    if (!Number.isInteger(operation.expected_version)) throw new Error('expected_version is required');
    if (record.version !== operation.expected_version) throw new Error('expected_version conflict');
}

function assertSensitivity(current, next) {
    if (!(current in SENSITIVITY_RANK)) throw new Error('Invalid sensitivity');
    if (next === undefined) return;
    if (!(next in SENSITIVITY_RANK)) throw new Error('Invalid sensitivity');
    if (SENSITIVITY_RANK[next] < SENSITIVITY_RANK[current]) throw new Error('sensitivity cannot be lowered');
}

function assertRoleMinimum(current, next) {
    if (!(current in ROLE_RANK)) throw new Error('Invalid role_min');
    if (next === undefined) return;
    if (!(next in ROLE_RANK)) throw new Error('Invalid role_min');
    if (ROLE_RANK[next] < ROLE_RANK[current]) throw new Error('role_min cannot be lowered');
}

function assertAccessMetadata(roleMin, sensitivity) {
    if (!(roleMin in ROLE_RANK)) throw new Error('Invalid role_min');
    if (!(sensitivity in SENSITIVITY_RANK)) throw new Error('Invalid sensitivity');
    if (SENSITIVITY_RANK[sensitivity] >= SENSITIVITY_RANK.finance && roleMin === 'member') {
        throw new Error('Sensitive data requires role_min gm or ceo');
    }
}

function validationError(validation, prefix = 'Graph snapshot is invalid') {
    return new Error(`${prefix}: ${validation.issues.map((item) => item.category).join(',')}`);
}

function validationIssueKey(issue) {
    return JSON.stringify(canonicalize(issue));
}

function introducedValidationIssues(before, after) {
    const remaining = new Map();
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

function findEntity(state, id) {
    const entity = state.entities.find((item) => item.id === id);
    if (!entity) throw new Error(`Unknown entity: ${id}`);
    return entity;
}

function findEdge(state, operation) {
    const edge = operation.edge_id
        ? state.edges.find((item) => item.id === operation.edge_id)
        : state.edges.find((item) => item.from_id === operation.from_id && item.to_id === operation.to_id && item.rel_type === operation.rel_type);
    if (!edge) throw new Error('Unknown edge');
    return edge;
}

export function applyGraphOperations(snapshot, operations, { projectCode, humanGateReceipt } = {}) {
    const initialValidation = validateGraphSnapshot(snapshot);
    const state = withoutHash(snapshot);
    if (state.project_code !== projectCode) throw new Error('project scope mismatch');
    for (const operation of operations) {
        if (!GRAPH_MAINTENANCE_OPERATIONS.includes(operation.operation)) throw new Error(`Unknown graph operation: ${operation.operation}`);
        if (operation.operation === 'patch_entity') {
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
            const activeDecision = entity.entity_type === 'decision'
                && entity.lifecycle_status === 'active'
                && !['retired', 'superseded'].includes(String(entity.payload?.status || '').toLowerCase());
            if (activeDecision && !(operation.human_gate_receipt || humanGateReceipt)) throw new Error('human_gate_receipt is required for Active Decision');
            entity.lifecycle_status = 'retired';
            entity.version += 1;
        } else if (operation.operation === 'move_scope') {
            const entity = findEntity(state, operation.entity_id);
            requireVersion(entity, operation);
            if (!operation.target_project_code) throw new Error('target_project_code is required');
            entity.project_code = operation.target_project_code;
            entity.version += 1;
            for (const edge of state.edges.filter((item) => item.from_id === entity.id || item.to_id === entity.id)) {
                edge.project_code = operation.target_project_code;
                edge.version += 1;
            }
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
        } else if (operation.operation === 'upsert_edge') {
            const fromEntity = findEntity(state, operation.from_id);
            const toEntity = findEntity(state, operation.to_id);
            if (fromEntity.project_code !== toEntity.project_code) throw new Error('edge endpoint project scope mismatch');
            if (!String(operation.rel_type || '').trim()) throw new Error('rel_type is required');
            const existing = state.edges.find((item) => item.from_id === operation.from_id && item.to_id === operation.to_id && item.rel_type === operation.rel_type);
            const edgeById = operation.edge_id ? state.edges.find((item) => item.id === operation.edge_id) : null;
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
                    project_code: fromEntity.project_code, payload: operation.payload || {}, role_min: roleMin,
                    sensitivity, lifecycle_status: 'active', version: 1
                });
            }
        } else if (operation.operation === 'retire_edge') {
            const edge = findEdge(state, operation);
            requireVersion(edge, operation);
            edge.lifecycle_status = 'retired';
            edge.version += 1;
        } else if (operation.operation === 'normalize_alias') {
            const entity = findEntity(state, operation.entity_id);
            requireVersion(entity, operation);
            const aliases = Array.isArray(operation.aliases) ? operation.aliases : entity.payload?.aliases || [];
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

export function buildGraphPlan(snapshot, input = {}) {
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

export function validateGraphSnapshot(snapshot) {
    const issues = [];
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        return { valid: false, counts: { entities: 0, edges: 0, issues: 1, duplicates: 0, orphans: 0 }, issues: [{ category: 'snapshot' }] };
    }
    if (!String(snapshot.project_code || '').trim()) issues.push({ category: 'project_scope' });
    if (!Array.isArray(snapshot.entities)) issues.push({ category: 'entities' });
    if (!Array.isArray(snapshot.edges)) issues.push({ category: 'edges' });
    const entityIds = new Set();
    for (const entity of Array.isArray(snapshot.entities) ? snapshot.entities : []) {
        if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
            issues.push({ category: 'entity' });
            continue;
        }
        if (!String(entity.id || '').trim()) issues.push({ category: 'entity_id', id: entity.id });
        if (entityIds.has(entity.id)) issues.push({ category: 'duplicate_entity', id: entity.id });
        entityIds.add(entity.id);
        if (!Number.isInteger(entity.version) || entity.version < 1) issues.push({ category: 'version', id: entity.id });
        if (!String(entity.entity_type || '').trim()) issues.push({ category: 'entity_type', id: entity.id });
        if (!String(entity.project_code || '').trim()) issues.push({ category: 'project_scope', id: entity.id });
        if (!(entity.role_min in ROLE_RANK)) issues.push({ category: 'role_min', id: entity.id });
        if (!(entity.sensitivity in SENSITIVITY_RANK)) issues.push({ category: 'sensitivity', id: entity.id });
        if (!LIFECYCLE_STATUSES.has(entity.lifecycle_status)) issues.push({ category: 'lifecycle', id: entity.id });
        if (!entity.payload || typeof entity.payload !== 'object' || Array.isArray(entity.payload)) issues.push({ category: 'payload', id: entity.id });
        if (SENSITIVITY_RANK[entity.sensitivity] >= SENSITIVITY_RANK.finance && entity.role_min === 'member') {
            issues.push({ category: 'sensitivity_role', id: entity.id });
        }
    }
    const edgeKeys = new Set();
    const edgeIds = new Set();
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
