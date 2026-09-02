const PROJECT_GRAPH_IDENTITY_LOCK_PREFIX = 'brainbase:project-graph-identity:';
const PROJECT_GRAPH_IDENTITY_COORDINATOR_LOCK = `${PROJECT_GRAPH_IDENTITY_LOCK_PREFIX}coordinator`;

/**
 * Serialize the project provisioning Registry/Graph identity boundary.
 *
 * Project entity ids are globally unique, so the lock deliberately does not
 * include organization_id. Callers still perform their normal tenant checks;
 * this lock only closes the read-then-write race for the same id.
 */
export async function lockProjectGraphIdentity(client, entityId) {
    const normalizedEntityId = String(entityId || '').trim();
    if (!normalizedEntityId) throw new Error('Project Graph identity lock requires entity id');
    // Every Graph entity writer takes the same coordinator first. This keeps
    // mixed writers from acquiring entity ids in opposite orders while still
    // retaining the per-id lock used by provisioning/readback races.
    await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0::bigint))',
        [PROJECT_GRAPH_IDENTITY_COORDINATOR_LOCK]
    );
    await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0::bigint))',
        [`${PROJECT_GRAPH_IDENTITY_LOCK_PREFIX}${normalizedEntityId}`]
    );
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

export { PROJECT_GRAPH_IDENTITY_COORDINATOR_LOCK, PROJECT_GRAPH_IDENTITY_LOCK_PREFIX };
