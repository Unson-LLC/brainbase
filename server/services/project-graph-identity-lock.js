const PROJECT_GRAPH_IDENTITY_LOCK_PREFIX = 'brainbase:project-graph-identity:';

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
    await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0::bigint))',
        [`${PROJECT_GRAPH_IDENTITY_LOCK_PREFIX}${normalizedEntityId}`]
    );
}

export { PROJECT_GRAPH_IDENTITY_LOCK_PREFIX };
