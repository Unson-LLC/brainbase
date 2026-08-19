import { isCanonicalId } from './ids.js';

const ROLE_FIELDS = ['role', 'role_code'];

function firstString(...values) {
    return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? null;
}

function canonicalAccess(value, { fallbackIdentity = {} } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const tenantId = firstString(value.tenantId, value.tenant_id);
    const personId = firstString(value.personId, value.person_id, value.principal_id);
    if (!isCanonicalId(tenantId, 'ten') || !isCanonicalId(personId, 'per')) return null;

    if (isCanonicalId(value.organizationId, 'ten') && value.organizationId !== tenantId) return null;
    const organizationId = tenantId;
    const slackUserId = firstString(value.slackUserId, value.slack_user_id, fallbackIdentity.slackUserId);
    const slackWorkspaceId = firstString(
        value.slackWorkspaceId,
        value.slack_workspace_id,
        fallbackIdentity.slackWorkspaceId
    );
    return {
        ...value,
        tenantId,
        organizationId,
        personId,
        ...(slackUserId ? { slackUserId } : {}),
        ...(slackWorkspaceId ? { slackWorkspaceId } : {})
    };
}

function tokenIdentity({ access = {}, auth = {} } = {}) {
    return {
        slackUserId: firstString(
            access.slackUserId,
            access.slack_user_id,
            auth.slackUserId,
            auth.slack_user_id,
            auth.user_id
        ),
        slackWorkspaceId: firstString(
            access.slackWorkspaceId,
            access.slack_workspace_id,
            auth.slackWorkspaceId,
            auth.slack_workspace_id,
            auth.team_id,
            auth.workspace_id
        )
    };
}

function payloadField(payload, fields) {
    for (const field of fields) {
        if (typeof payload?.[field] === 'string' && payload[field].trim().length > 0) {
            return payload[field].trim();
        }
    }
    return null;
}

function payloadList(payload, fields) {
    for (const field of fields) {
        if (Array.isArray(payload?.[field])) return payload[field];
    }
    return [];
}

/**
 * Resolve Slack user identity to the canonical tenant/person access record.
 *
 * A signed user JWT may contain historical organization/person claims. Those
 * claims are never converted into canonical IDs. Legacy identities must be
 * resolved by the injected Graph/DB resolver or by the canonical membership
 * tables; no mapping means no access.
 */
export function createSlackInstallationAccessResolver({
    authService,
    resolveCanonicalAccess,
    graphResolver
} = {}) {
    const explicitResolver = typeof resolveCanonicalAccess === 'function'
        ? resolveCanonicalAccess
        : typeof graphResolver === 'function'
            ? graphResolver
            : typeof authService?.resolveCanonicalSlackInstallationAccess === 'function'
                ? authService.resolveCanonicalSlackInstallationAccess.bind(authService)
                : null;

    return async ({ req, access = {}, auth = {} } = {}) => {
        const current = canonicalAccess(access, { fallbackIdentity: tokenIdentity({ access, auth }) });
        if (current) return current;

        const identity = tokenIdentity({ access, auth });
        if (!identity.slackUserId || !identity.slackWorkspaceId) return null;

        if (explicitResolver) {
            const resolved = await explicitResolver({
                req,
                auth,
                access,
                slack_user_id: identity.slackUserId,
                slack_workspace_id: identity.slackWorkspaceId
            });
            return canonicalAccess(resolved?.access ?? resolved, { fallbackIdentity: identity });
        }

        const pool = authService?.pool;
        if (!pool || typeof pool.connect !== 'function') return null;
        const client = await pool.connect();
        try {
            const { rows } = await client.query(
                `SELECT tm.tenant_id,
                        tm.principal_id,
                        tm.membership_payload
                   FROM tenant_memberships tm
                   JOIN brainbase_tenants bt ON bt.tenant_id = tm.tenant_id
                  WHERE bt.status = 'active'
                    AND tm.membership_payload ->> 'slack_user_id' = $1
                    AND tm.membership_payload ->> 'slack_workspace_id' = $2`,
                [identity.slackUserId, identity.slackWorkspaceId]
            );
            if (rows.length !== 1) return null;
            const row = rows[0];
            const payload = row.membership_payload && typeof row.membership_payload === 'object'
                ? row.membership_payload
                : {};
            return canonicalAccess({
                tenant_id: row.tenant_id,
                principal_id: row.principal_id,
                role: payloadField(payload, ROLE_FIELDS) ?? 'member',
                projectCodes: payloadList(payload, ['project_codes', 'projectCodes']),
                clearance: payloadList(payload, ['clearance']),
                slackUserId: identity.slackUserId,
                slackWorkspaceId: identity.slackWorkspaceId
            }, { fallbackIdentity: identity });
        } finally {
            client.release();
        }
    };
}
