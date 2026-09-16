const PROFILE_FIELDS = ['name', 'affiliation', 'role'];
const GRAPH_ROLES = new Set(['member', 'gm', 'ceo']);
const GRAPH_ROLE_RANK = Object.freeze({ member: 1, gm: 2, ceo: 3 });
const SLACK_USER_ID = /^U[A-Z0-9]+$/u;
const REVISION = /^(0|[1-9][0-9]*)$/u;
const MAX_STRING_LENGTH = 300;
const MAX_LIST_LENGTH = 256;

function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function string(value, { max = MAX_STRING_LENGTH } = {}) {
    return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

function revision(value) {
    const normalized = value == null ? null : String(value);
    return normalized && REVISION.test(normalized) ? normalized : null;
}

function contextParts(context, targetSlackUserId) {
    const tenant = context?.tenant_context;
    const actor = context?.actor;
    const scope = context?.scope;
    const connection = tenant?.workspace_connection;
    const nestedActor = tenant?.actor;
    const authorization = tenant?.authorization;
    const slack = tenant?.slack;
    const values = {
        tenantId: string(tenant?.tenant?.tenant_id),
        tenantRevision: revision(tenant?.tenant?.tenant_revision),
        organizationId: string(scope?.organization_id),
        projectId: string(scope?.project_id),
        connectionId: string(connection?.connection_id),
        connectionRevision: revision(connection?.connection_revision),
        provider: connection?.provider,
        workspaceId: string(connection?.workspace_id),
        appId: string(connection?.app_id),
        connectionStatus: connection?.status,
        actorPersonId: string(actor?.canonical_person_id),
        actorExternalSubject: string(actor?.external_subject_id),
        actorMembershipId: string(actor?.membership_id),
        actorMembershipRevision: revision(actor?.membership_revision),
        nestedActorPrincipalId: string(nestedActor?.principal_id),
        nestedActorType: nestedActor?.principal_type,
        nestedActorSubject: string(nestedActor?.authenticated_subject_id),
        targetSlackUserId: string(targetSlackUserId),
        channelId: string(slack?.channel_id),
        eventId: string(slack?.event_id)
    };
    if (Object.values(values).some((value) => value === null)) return null;
    if (values.provider !== 'slack' || values.connectionStatus !== 'active'
        || values.nestedActorType !== 'person'
        || values.nestedActorPrincipalId !== values.actorPersonId
        || values.nestedActorSubject !== values.actorExternalSubject
        || !SLACK_USER_ID.test(values.targetSlackUserId)
        || !Array.isArray(authorization?.organization_ids)
        || !authorization.organization_ids.includes(values.organizationId)
        || !Array.isArray(authorization?.project_ids)
        || !authorization.project_ids.includes(values.projectId)
        || values.channelId.length > MAX_STRING_LENGTH || values.eventId.length > MAX_STRING_LENGTH) return null;
    return { ...values, authorization };
}

function accessFromMembership(payload, projectCode) {
    if (!object(payload) || payload.status !== 'active') return null;
    const membershipRevision = revision(payload.revision);
    const role = typeof payload.role === 'string'
        ? payload.role
        : typeof payload.role_code === 'string' ? payload.role_code : null;
    const projectCodes = payload.project_codes;
    const clearance = payload.clearance;
    if (!membershipRevision || !GRAPH_ROLES.has(role)
        || !Array.isArray(projectCodes) || !projectCodes.includes(projectCode)
        || !Array.isArray(clearance)
        || projectCodes.some((value) => typeof value !== 'string' || value.length === 0 || value.length > MAX_STRING_LENGTH)
        || clearance.some((value) => typeof value !== 'string' || value.length === 0 || value.length > MAX_STRING_LENGTH)) return null;
    return { membershipRevision, role, projectCodes: [...new Set(projectCodes)], clearance: [...new Set(clearance)] };
}

function projectProfile(value) {
    if (!object(value)) return null;
    const profile = {};
    if (Object.prototype.hasOwnProperty.call(value, 'version')) profile.version = value.version;
    if (Object.prototype.hasOwnProperty.call(value, 'revision')) profile.revision = value.revision;
    if (object(value.fields)) {
        profile.fields = {};
        for (const fieldName of PROFILE_FIELDS) {
            const source = value.fields[fieldName];
            if (!object(source)) continue;
            const field = {};
            if (Object.prototype.hasOwnProperty.call(source, 'value')) field.value = source.value;
            if (Array.isArray(source.reader_person_ids) && source.reader_person_ids.length <= MAX_LIST_LENGTH) {
                field.reader_person_ids = source.reader_person_ids.slice(0, MAX_LIST_LENGTH);
            }
            if (Array.isArray(source.audiences) && source.audiences.length <= MAX_LIST_LENGTH) {
                field.audiences = source.audiences.slice(0, MAX_LIST_LENGTH).map((audience) => {
                    if (!object(audience)) return audience;
                    return {
                        ...(Object.prototype.hasOwnProperty.call(audience, 'workspace_id')
                            ? { workspace_id: audience.workspace_id } : {}),
                        ...(Object.prototype.hasOwnProperty.call(audience, 'channel_id')
                            ? { channel_id: audience.channel_id } : {})
                    };
                });
            }
            profile.fields[fieldName] = field;
        }
    }
    return profile;
}

async function rows(client, sql, values = []) {
    const result = await client.query(sql, values);
    return Array.isArray(result?.rows) ? result.rows : [];
}

export class ShareablePersonProfileRepository {
    constructor({ pool, now = () => new Date() } = {}) {
        if (!pool) throw new Error('ShareablePersonProfileRepository requires pool');
        this.pool = pool;
        this.now = now;
    }

    async readProfile({ context, targetSlackUserId } = {}) {
        const parts = contextParts(context, targetSlackUserId);
        if (!parts) return null;
        const client = await this.pool.connect();
        let began = false;
        const complete = async (value) => {
            await client.query('COMMIT');
            began = false;
            return value;
        };
        try {
            await client.query('BEGIN');
            began = true;
            await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [parts.tenantId]);

            const requesterRows = await rows(client, `
                SELECT requester.membership_id,
                       requester.tenant_id,
                       requester.organization_id,
                       requester.principal_id,
                       requester.membership_payload,
                       tenant.tenant_revision,
                       tenant.status AS tenant_status,
                       organization.organization_payload,
                       project.project_id,
                       project.project_code,
                       project.project_payload,
                       connection.connection_id,
                       connection.connection_revision,
                       connection.provider,
                       connection.workspace_id,
                       connection.app_id,
                       connection.status AS connection_status
                  FROM tenant_memberships AS requester
                  JOIN brainbase_tenants AS tenant
                    ON tenant.tenant_id = requester.tenant_id
                  JOIN tenant_organizations AS organization
                    ON organization.tenant_id = requester.tenant_id
                   AND organization.organization_id = requester.organization_id
                  JOIN tenant_projects AS project
                    ON project.tenant_id = requester.tenant_id
                   AND project.project_id = $5
                  JOIN workspace_connections AS connection
                    ON connection.tenant_id = requester.tenant_id
                   AND connection.connection_id = $6
                 WHERE requester.tenant_id = $1
                   AND requester.membership_id = $2
                   AND requester.principal_id = $3
                   AND requester.organization_id = $4
                   AND tenant.tenant_revision = $7::bigint
                   AND tenant.status = 'active'
                   AND requester.tenant_revision_at_write = tenant.tenant_revision
                   AND organization.tenant_revision_at_write = tenant.tenant_revision
                   AND project.tenant_revision_at_write = tenant.tenant_revision
                   AND connection.tenant_revision_at_write = tenant.tenant_revision
                   AND requester.membership_payload->>'status' = 'active'
                   AND requester.membership_payload->>'revision' = $8
                   AND project.project_id = ANY($9::text[])
                   AND (project.project_payload->>'status' IS NULL
                        OR project.project_payload->>'status' = 'active')
                   AND connection.connection_revision = $10::bigint
                   AND connection.provider = 'slack'
                   AND connection.workspace_id = $11
                   AND connection.app_id = $12
                   AND connection.status = 'active'
                 LIMIT 2
                 FOR SHARE OF requester, tenant, organization, project, connection`, [
                parts.tenantId, parts.actorMembershipId, parts.actorPersonId, parts.organizationId,
                parts.projectId, parts.connectionId, parts.tenantRevision, parts.actorMembershipRevision,
                parts.authorization.project_ids, parts.connectionRevision, parts.workspaceId, parts.appId
            ]);
            if (requesterRows.length !== 1) return complete(null);
            const requester = requesterRows[0];
            if (requester.project_code === undefined || requester.project_code === null
                || (requester.project_payload?.status !== undefined
                    && requester.project_payload.status !== 'active')
                || (requester.organization_payload?.status !== undefined
                    && requester.organization_payload.status !== 'active')) return complete(null);
            const access = accessFromMembership(requester.membership_payload, requester.project_code);
            if (!access
                || access.membershipRevision !== parts.actorMembershipRevision) return complete(null);

            const targetRows = await rows(client, `
                SELECT target_identity.identity_id,
                       target_identity.identity_revision,
                       target_identity.tenant_id,
                       target_identity.authenticated_subject_id,
                       target_identity.workspace_id,
                       target_identity.app_id,
                       target_identity.membership_id,
                       target_identity.project_id,
                       target_identity.principal_type,
                       target_identity.status AS identity_status,
                       target_membership.principal_id AS person_id,
                       target_membership.organization_id AS target_organization_id,
                       target_membership.membership_payload,
                       target_project.project_code,
                       target_connection.connection_id,
                       target_connection.connection_revision,
                       target_connection.status AS target_connection_status,
                       target_tenant.tenant_revision AS target_tenant_revision,
                       target_tenant.status AS target_tenant_status
                  FROM company_external_identities AS target_identity
                  JOIN tenant_memberships AS target_membership
                    ON target_membership.tenant_id = target_identity.tenant_id
                   AND target_membership.membership_id = target_identity.membership_id
                  JOIN tenant_projects AS target_project
                    ON target_project.tenant_id = target_identity.tenant_id
                   AND target_project.project_id = target_identity.project_id
                  JOIN workspace_connections AS target_connection
                    ON target_connection.tenant_id = target_identity.tenant_id
                   AND target_connection.connection_id = $6
                  JOIN brainbase_tenants AS target_tenant
                    ON target_tenant.tenant_id = target_identity.tenant_id
                 WHERE target_identity.tenant_id = $1
                   AND target_identity.provider = 'slack'
                   AND target_identity.authenticated_subject_id = $7
                   AND target_identity.workspace_id = $8
                   AND target_identity.app_id = $9
                   AND target_identity.project_id = $5
                   AND target_identity.status = 'active'
                   AND target_identity.principal_type = 'person'
                   AND target_identity.tenant_revision_at_write = target_tenant.tenant_revision
                   AND target_tenant.tenant_revision = $2::bigint
                   AND target_tenant.status = 'active'
                   AND target_membership.tenant_revision_at_write = target_tenant.tenant_revision
                   AND target_membership.organization_id = $4
                   AND target_membership.membership_payload->>'status' = 'active'
                   AND target_membership.membership_payload->>'revision' IS NOT NULL
                   AND target_project.tenant_revision_at_write = target_tenant.tenant_revision
                   AND target_project.project_code = $10
                   AND (target_project.project_payload->>'status' IS NULL
                        OR target_project.project_payload->>'status' = 'active')
                   AND target_connection.tenant_revision_at_write = target_tenant.tenant_revision
                   AND target_connection.connection_revision = $3::bigint
                   AND target_connection.provider = 'slack'
                   AND target_connection.workspace_id = $8
                   AND target_connection.app_id = $9
                   AND target_connection.status = 'active'
                 ORDER BY target_identity.identity_revision DESC
                 LIMIT 2
                 FOR SHARE OF target_identity, target_membership, target_project, target_connection, target_tenant`, [
                parts.tenantId, parts.tenantRevision, parts.connectionRevision, parts.organizationId,
                parts.projectId, parts.connectionId, parts.targetSlackUserId, parts.workspaceId,
                parts.appId, requester.project_code
            ]);
            if (targetRows.length !== 1) return complete(null);
            const target = targetRows[0];
            if (target.authenticated_subject_id !== parts.targetSlackUserId
                || target.target_organization_id !== parts.organizationId
                || target.identity_status !== 'active'
                || target.principal_type !== 'person'
                || target.target_connection_status !== 'active'
                || !string(target.person_id)
                || !revision(target.membership_payload?.revision)) return complete(null);

            // Graph SSOT RLS uses these settings for the current requester. The
            // query below deliberately projects only the approved subdocument.
            for (const [setting, value] of [
                ['app.role', access.role],
                ['app.project_codes', requester.project_code],
                ['app.clearance', access.clearance.join(',')]
            ]) await client.query('SELECT set_config($1, $2, true)', [setting, value]);
            const graphRows = await rows(client, `
                SELECT graph_entity.id,
                       graph_entity.version,
                       graph_entity.payload->'shareable_profile' AS shareable_profile
                  FROM graph_entities AS graph_entity
                 WHERE graph_entity.id = $1
                   AND graph_entity.entity_type = 'person'
                   AND graph_entity.lifecycle_status = 'active'
                   AND graph_entity.sensitivity = ANY($3::text[])
                   AND (CASE graph_entity.role_min
                       WHEN 'member' THEN 1
                       WHEN 'gm' THEN 2
                       WHEN 'ceo' THEN 3
                       ELSE NULL
                   END) <= $4
                   AND CASE
                     WHEN graph_entity.project_id IS NOT NULL THEN EXISTS (
                       SELECT 1
                         FROM projects AS graph_project
                        WHERE graph_project.id = graph_entity.project_id
                          AND graph_project.code = $2
                     )
                     WHEN graph_entity.entity_type = 'person' THEN EXISTS (
                       SELECT 1
                         FROM graph_edges AS membership_edge
                         JOIN projects AS membership_project
                           ON membership_project.id = membership_edge.project_id
                        WHERE membership_edge.from_id = graph_entity.id
                          AND membership_edge.rel_type = 'member_of'
                          AND membership_edge.lifecycle_status = 'active'
                          AND membership_edge.sensitivity = ANY($3::text[])
                          AND (CASE membership_edge.role_min
                              WHEN 'member' THEN 1
                              WHEN 'gm' THEN 2
                              WHEN 'ceo' THEN 3
                              ELSE NULL
                          END) <= $4
                          AND membership_project.code = $2
                     )
                     ELSE FALSE
                   END
                 LIMIT 1`, [target.person_id, requester.project_code, access.clearance, GRAPH_ROLE_RANK[access.role]]);
            if (graphRows.length !== 1) return complete(null);
            return complete({
                person_id: target.person_id,
                profile: projectProfile(graphRows[0].shareable_profile)
            });
        } catch (error) {
            if (began) {
                try { await client.query('ROLLBACK'); } catch { /* preserve query failure */ }
            }
            throw error;
        } finally {
            client.release();
        }
    }
}
