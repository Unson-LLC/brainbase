const PROJECT_GRAPH_IDENTITY_LOCK_PREFIX = 'brainbase:project-graph-identity:';

function identityBusyError(entityId) {
    const error = new Error(`Project Graph identity is busy: ${entityId}`);
    error.code = 'GRAPH_PROJECT_IDENTITY_BUSY';
    error.status = 409;
    error.statusCode = 409;
    error.details = { entity_id: entityId, retryable: true };
    return error;
}

/**
 * Serialize the project provisioning Registry/Graph identity boundary.
 *
 * Project entity ids are globally unique, so the lock deliberately does not
 * include organization_id. Callers still perform their normal tenant checks;
 * this lock only closes the read-then-write race for the same id.
 */
export async function lockProjectGraphIdentities(client, entityIds) {
    const normalizedEntityIds = [...new Set((entityIds || [])
        .map((entityId) => String(entityId || '').trim())
        .filter(Boolean))].sort();
    if (!normalizedEntityIds.length) return [];
    for (const entityId of normalizedEntityIds) {
        // Fail fast instead of waiting while holding another identity lock.
        // This preserves concurrency for unrelated ids and makes opposite-order
        // multi-id callers retryable rather than deadlock-prone.
        const result = await client.query(
            'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0::bigint)) AS acquired',
            [`${PROJECT_GRAPH_IDENTITY_LOCK_PREFIX}${entityId}`]
        );
        if (result?.rows?.[0]?.acquired === false) throw identityBusyError(entityId);
    }
    return normalizedEntityIds;
}

export async function lockProjectGraphIdentity(client, entityId) {
    if (!String(entityId || '').trim()) throw new Error('Project Graph identity lock requires entity id');
    return lockProjectGraphIdentities(client, [entityId]);
}

function catalogSubjectError(entityId, reason) {
    const error = new Error(`Project Catalog subject is protected: ${entityId}`);
    error.code = 'GRAPH_PROJECT_CATALOG_SUBJECT_PROTECTED';
    error.status = 409;
    error.statusCode = 409;
    error.details = { entity_id: entityId, reason };
    return error;
}

/**
 * Protect a registered Project's canonical Graph subject from generic writers.
 *
 * The Project Catalog is optional in deployments that only install Info SSOT,
 * so the relation check intentionally precedes the catalog query. When the
 * catalog exists, callers must either reject the mutation outright or prove
 * that a Graph Maintenance snapshot preserves the exact catalog projection.
 */
export async function assertCatalogProjectSubjectMutation(client, {
    id,
    entityType,
    projectId,
    payload = {},
    lifecycleStatus = 'active',
    allowCompatible = false,
    identityLocked = false
}) {
    if (!identityLocked) await lockProjectGraphIdentity(client, id);
    const relation = await client.query(
        "SELECT to_regclass('public.project_registry') AS project_registry"
    );
    if (!relation.rows[0]?.project_registry) return { protected: false };

    const catalog = await client.query(
        `SELECT pr.project_code, pr.display_name, pr.catalog_version,
                EXISTS (
                    SELECT 1 FROM projects scope
                    WHERE scope.id=$2 AND scope.organization_id=pr.organization_id
                ) AS project_scope_compatible
         FROM project_registry pr
         JOIN projects p
           ON p.code=pr.project_code AND p.organization_id=pr.organization_id
         WHERE pr.project_code=$1
         FOR UPDATE OF pr, p`,
        [id, projectId]
    );
    const project = catalog.rows[0];
    if (!project) return { protected: false };
    if (!allowCompatible) throw catalogSubjectError(id, 'generic_writer_forbidden');

    const expectedSourceRef = `project-catalog:${project.project_code}@${project.catalog_version}`;
    const compatible = entityType === 'project'
        && project.project_scope_compatible === true
        && lifecycleStatus === 'active'
        && payload?.catalog_project_id === project.project_code
        && payload?.catalog_version === project.catalog_version
        && payload?.source_ref === expectedSourceRef
        && String(payload?.name || '').trim() === String(project.display_name || '').trim();
    if (!compatible) throw catalogSubjectError(id, 'catalog_projection_mismatch');
    return { protected: true, compatible: true };
}

export { PROJECT_GRAPH_IDENTITY_LOCK_PREFIX };
