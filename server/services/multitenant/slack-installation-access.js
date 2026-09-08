import { isCanonicalId } from './ids.js';
import { PostgresCompanyAuthorityRepository } from './postgres-company-authority-repository.js';

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
    graphResolver,
    companyAuthorityRepository,
    trustedAppId
} = {}) {
    const explicitResolver = typeof resolveCanonicalAccess === 'function'
        ? resolveCanonicalAccess
        : typeof graphResolver === 'function'
            ? graphResolver
            : typeof authService?.resolveCanonicalSlackInstallationAccess === 'function'
                ? authService.resolveCanonicalSlackInstallationAccess.bind(authService)
                : null;

    const repository = companyAuthorityRepository
        ?? (authService?.pool ? new PostgresCompanyAuthorityRepository({ pool: authService.pool }) : null);

    return async ({ req, access = {}, auth = {} } = {}) => {
        const current = canonicalAccess(access, { fallbackIdentity: tokenIdentity({ access, auth }) });
        const identity = tokenIdentity({ access, auth });

        if (explicitResolver) {
            if (!identity.slackUserId || !identity.slackWorkspaceId) return null;
            const resolved = await explicitResolver({
                req,
                auth,
                access,
                slack_user_id: identity.slackUserId,
                slack_workspace_id: identity.slackWorkspaceId
            });
            return canonicalAccess(resolved?.access ?? resolved, { fallbackIdentity: identity });
        }

        if (repository) {
            if (!identity.slackUserId || !identity.slackWorkspaceId || !firstString(trustedAppId)) return null;
            const route = await repository.resolveObservedRoute({
                provider_identity: {
                    provider: 'slack',
                    authenticated_subject_id: identity.slackUserId,
                    workspace_id: identity.slackWorkspaceId,
                    app_id: trustedAppId.trim(),
                    enterprise_id: null
                },
                requested_action: { project_hint: null }
            });
            const resolved = await repository.resolveCanonicalIdentity({
                tenant_id: route.tenant_id,
                provider: 'slack',
                authenticated_subject_id: identity.slackUserId,
                workspace_id: identity.slackWorkspaceId,
                app_id: trustedAppId.trim(),
                project_hint: null,
                include_membership_access: true
            });
            const membershipAccess = resolved.membership_access ?? {};
            return canonicalAccess({
                tenant_id: resolved.tenant_id,
                principal_id: resolved.canonical_person_id,
                role: payloadField(membershipAccess, ROLE_FIELDS) ?? 'member',
                projectCodes: payloadList(membershipAccess, ['project_codes', 'projectCodes']),
                clearance: payloadList(membershipAccess, ['clearance']),
                slackUserId: identity.slackUserId,
                slackWorkspaceId: identity.slackWorkspaceId
            }, { fallbackIdentity: identity });
        }

        return current;
    };
}
