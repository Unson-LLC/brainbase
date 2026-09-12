import { createHash } from 'node:crypto';

import { canonicalJson, deepFreeze } from './canonical-json.js';
import { ContractError } from './errors.js';
import { PostgresCompanyAuthorityRepository } from './postgres-company-authority-repository.js';

const EFFECTS = new Set(['read', 'write', 'external_side_effect']);
const DECISIONS = new Set(['auto', 'approval', 'human_action', 'deny']);
const CHANNEL_ID = /^[CG][A-Za-z0-9_-]+$/u;
const REVISION = /^(0|[1-9][0-9]*)$/u;
const BARE_PROJECT = /^project:([^#\s]+)$/u;
const PAYLOAD_PROJECT = /^project:([^#\s]+)#payload_sha256=sha256:([0-9a-f]{64})$/u;
const ENCODED_FRAGMENT = /%23/iu;

function fail(code, { status = 403, retryable = false, fault_domain = 'protocol', details } = {}) {
    throw new ContractError(code, {
        status,
        retryable,
        fault_domain,
        ...(details ? { details } : {})
    });
}

function requiredString(value, field, { status = 400 } = {}) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        fail('COMPANY_AUTHORITY_REQUEST_INVALID', { status, details: { field } });
    }
    return value.trim();
}

function requiredConfigString(value, field) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`Invalid Slack channel authority policy: ${field}`);
    }
    return value.trim();
}

function configRevision(value, field) {
    const revision = requiredConfigString(value, field);
    if (!REVISION.test(revision)) {
        throw new Error(`Invalid Slack channel authority policy: ${field}`);
    }
    return revision;
}

function configEffects(value, field) {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`Invalid Slack channel authority policy: ${field}`);
    }
    const effects = [...new Set(value.map((effect) => requiredConfigString(effect, field)))];
    if (effects.some((effect) => !EFFECTS.has(effect))) {
        throw new Error(`Invalid Slack channel authority policy: ${field}`);
    }
    return effects;
}

function policyProject(project, index, policyRevision) {
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
        throw new Error(`Invalid Slack channel authority policy: projects[${index}]`);
    }
    const resourceRevision = project.resource_revision === undefined
        ? policyRevision
        : configRevision(project.resource_revision, `projects[${index}].resource_revision`);
    return {
        project_id: requiredConfigString(project.project_id, `projects[${index}].project_id`),
        project_code: requiredConfigString(project.project_code, `projects[${index}].project_code`),
        placement_id: requiredConfigString(project.placement_id, `projects[${index}].placement_id`),
        resource_revision: resourceRevision
    };
}

function normalizePolicy(policy, index) {
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
        throw new Error(`Invalid Slack channel authority policy: policies[${index}]`);
    }
    const policyRevision = configRevision(policy.policy_revision, `policies[${index}].policy_revision`);
    if (policy.provider !== 'slack') {
        throw new Error(`Invalid Slack channel authority policy: policies[${index}].provider`);
    }
    if (policy.status !== 'active') {
        throw new Error(`Invalid Slack channel authority policy: policies[${index}].status`);
    }
    const channelId = requiredConfigString(policy.channel_id, `policies[${index}].channel_id`);
    if (!CHANNEL_ID.test(channelId)) {
        throw new Error(`Invalid Slack channel authority policy: policies[${index}].channel_id`);
    }
    if (policy.capability_id !== 'runtime.execute') {
        throw new Error(`Invalid Slack channel authority policy: policies[${index}].capability_id`);
    }
    if (!Array.isArray(policy.projects) || policy.projects.length === 0) {
        throw new Error(`Invalid Slack channel authority policy: policies[${index}].projects`);
    }
    const projects = policy.projects.map((project, projectIndex) =>
        policyProject(project, projectIndex, policyRevision));
    if (new Set(projects.map(({ project_id }) => project_id)).size !== projects.length
        || new Set(projects.map(({ project_code }) => project_code)).size !== projects.length) {
        throw new Error(`Invalid Slack channel authority policy: policies[${index}].projects`);
    }
    return {
        provider: 'slack',
        workspace_id: requiredConfigString(policy.workspace_id, `policies[${index}].workspace_id`),
        app_id: requiredConfigString(policy.app_id, `policies[${index}].app_id`),
        tenant_id: requiredConfigString(policy.tenant_id, `policies[${index}].tenant_id`),
        organization_id: requiredConfigString(policy.organization_id, `policies[${index}].organization_id`),
        graph_organization_id: requiredConfigString(
            policy.graph_organization_id,
            `policies[${index}].graph_organization_id`
        ),
        capability_id: 'runtime.execute',
        allowed_effects: configEffects(policy.allowed_effects, `policies[${index}].allowed_effects`),
        policy_revision: policyRevision,
        raci_revision: policy.raci_revision === undefined
            ? policyRevision
            : configRevision(policy.raci_revision, `policies[${index}].raci_revision`),
        status: 'active',
        channel_id: channelId,
        projects
    };
}

/**
 * Normalize the administrator-owned policy manifest once at startup.  The
 * returned value is deeply frozen so request data cannot mutate authority.
 */
export function normalizeSlackChannelAuthorityPolicies(policies) {
    if (!Array.isArray(policies)) throw new Error('Invalid Slack channel authority manifest: policies');
    const normalized = policies.map(normalizePolicy);
    const keys = normalized.map(({ workspace_id, app_id, channel_id }) =>
        `${workspace_id}\u0000${app_id}\u0000${channel_id}`);
    if (new Set(keys).size !== keys.length) {
        throw new Error('Invalid Slack channel authority policy: duplicate workspace/app/channel');
    }
    return deepFreeze(normalized);
}

function receipt(prefix, value) {
    return `${prefix}_${createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 32)}`;
}

function channelIdFor(request) {
    const slackChannelId = request?.slack?.channel_id;
    const deliveryChannelId = request?.delivery?.channel_id;
    if (slackChannelId !== undefined && deliveryChannelId !== undefined
        && slackChannelId !== deliveryChannelId) {
        fail('AUTHORITY_SCOPE_MISMATCH', { details: { field: 'channel_id' } });
    }
    return slackChannelId ?? deliveryChannelId ?? null;
}

function resourceBinding(resourceRef) {
    if (typeof resourceRef !== 'string' || resourceRef.trim().length === 0) {
        fail('COMPANY_AUTHORITY_REQUEST_INVALID', {
            status: 400,
            details: { field: 'requested_action.resource_ref' }
        });
    }
    if (resourceRef.startsWith('personal://')) {
        return { personal: true, projectResource: false, projectRef: null };
    }
    if (ENCODED_FRAGMENT.test(resourceRef)) {
        fail('COMPANY_AUTHORITY_REQUEST_INVALID', {
            status: 400,
            details: { field: 'requested_action.resource_ref', reason: 'encoded_fragment_separator' }
        });
    }
    if (!resourceRef.includes('#')) {
        const match = BARE_PROJECT.exec(resourceRef);
        if (!match) return { personal: false, projectResource: false, projectRef: null };
        return { personal: false, projectResource: true, projectRef: match[1] };
    }
    const match = PAYLOAD_PROJECT.exec(resourceRef);
    if (!match || match[0] !== resourceRef) {
        fail('COMPANY_AUTHORITY_REQUEST_INVALID', {
            status: 400,
            details: { field: 'requested_action.resource_ref', reason: 'invalid_payload_binding' }
        });
    }
    return { personal: false, projectResource: true, projectRef: match[1] };
}

function requestWorkspace(request) {
    return request?.workspace_id ?? request?.provider_identity?.workspace_id ?? null;
}

function requestApp(request) {
    return request?.app_id ?? request?.provider_identity?.app_id ?? null;
}

function requestProvider(request) {
    return request?.provider_identity?.provider ?? null;
}

function requestSubject(request) {
    return request?.provider_identity?.authenticated_subject_id ?? null;
}

function policyForChannel(policies, channelId) {
    if (!channelId) return null;
    return policies.find((policy) => policy.channel_id === channelId) ?? null;
}

function assertSelectedScope(policy, request) {
    if (requestProvider(request) !== 'slack'
        || requestWorkspace(request) !== policy.workspace_id
        || requestApp(request) !== policy.app_id
        || (request.tenant_id !== undefined && request.tenant_id !== policy.tenant_id)) {
        fail('AUTHORITY_SCOPE_MISMATCH');
    }
    if ((request.provider_identity?.workspace_id !== undefined
            && request.provider_identity.workspace_id !== policy.workspace_id)
        || (request.provider_identity?.app_id !== undefined
            && request.provider_identity.app_id !== policy.app_id)
        || (request.slack?.requester_id !== undefined
            && request.slack.requester_id !== requestSubject(request))) {
        fail('AUTHORITY_SCOPE_MISMATCH');
    }
    if (request.provider_identity?.enterprise_id !== undefined
        && request.provider_identity.enterprise_id !== null
        && typeof policy.enterprise_id === 'string'
        && request.provider_identity.enterprise_id !== policy.enterprise_id) {
        fail('AUTHORITY_SCOPE_MISMATCH');
    }
}

function selectedProject(policy, request) {
    const action = request?.requested_action;
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
        fail('COMPANY_AUTHORITY_REQUEST_INVALID', { status: 400, details: { field: 'requested_action' } });
    }
    if (action.capability_id !== policy.capability_id) {
        fail('CAPABILITY_SCOPE_MISMATCH');
    }
    if (!EFFECTS.has(action.desired_effect) || !policy.allowed_effects.includes(action.desired_effect)) {
        fail('COMPANY_EFFECT_NOT_ALLOWED');
    }
    const binding = resourceBinding(action.resource_ref);
    if (binding.personal) return null;
    if (!binding.projectResource) fail('PROJECT_SCOPE_MISMATCH');
    const projectHint = action.project_hint ?? null;
    if (binding.projectRef === null && projectHint === null) {
        if (policy.projects.length !== 1) fail('PROJECT_SCOPE_MISMATCH');
        return policy.projects[0];
    }
    const refs = [binding.projectRef, projectHint].filter((value) => value !== null && value !== undefined);
    const matches = policy.projects.filter((project) => refs.every((ref) =>
        project.project_id === ref || project.project_code === ref));
    if (matches.length !== 1) fail('PROJECT_SCOPE_MISMATCH');
    return matches[0];
}

function rowStatus(payload) {
    return payload && typeof payload === 'object' && payload.status !== undefined
        ? payload.status : null;
}

function membershipRevision(payload) {
    if (!payload || typeof payload !== 'object' || payload.revision === undefined
        || payload.revision === null || String(payload.revision).trim().length === 0) return null;
    return String(payload.revision);
}

function rowsOrEmpty(result) {
    return Array.isArray(result?.rows) ? result.rows : [];
}

function oneOrError(rows, unresolved = 'COMPANY_IDENTITY_UNRESOLVED', ambiguous = 'COMPANY_IDENTITY_AMBIGUOUS') {
    if (rows.length === 0) fail(unresolved);
    if (rows.length !== 1) fail(ambiguous, { status: 409 });
    return rows[0];
}

function effectiveEffects(policy, bindings) {
    let effects = [...policy.allowed_effects];
    for (const binding of bindings) {
        const bindingEffects = Array.isArray(binding.allowed_effects) ? binding.allowed_effects : [];
        effects = effects.filter((effect) => bindingEffects.includes(effect));
    }
    return effects;
}

function authorityFromBinding(binding, policy, identity, allowedEffects) {
    const authority = {
        binding_id: binding.binding_id,
        binding_revision: String(binding.binding_revision),
        capability_id: binding.capability_id,
        decision: binding.decision,
        allowed_effects: allowedEffects,
        responsible_person_id: binding.responsible_person_id ?? null,
        accountable_person_id: binding.accountable_person_id ?? null,
        approver_person_id: binding.approver_person_id ?? null,
        delegated_by_person_id: binding.delegated_by_person_id ?? null,
        policy_revision: String(binding.policy_revision),
        raci_revision: String(binding.raci_revision),
        resource_revision: String(binding.resource_revision),
        stop_conditions: [...(binding.stop_conditions ?? [])]
    };
    return {
        ...authority,
        authority_resolution_receipt_id: receipt('authres', {
            authority,
            channel_id: policy.channel_id,
            canonical_person_id: identity.canonical_person_id,
            membership_id: identity.membership_id
        })
    };
}

function syntheticAuthority(policy, project, identity) {
    const authority = {
        binding_id: `channel_policy:${policy.channel_id}:${project.project_id}`,
        binding_revision: policy.policy_revision,
        capability_id: policy.capability_id,
        decision: 'auto',
        allowed_effects: [...policy.allowed_effects],
        responsible_person_id: identity.canonical_person_id,
        accountable_person_id: null,
        approver_person_id: null,
        delegated_by_person_id: null,
        policy_revision: policy.policy_revision,
        raci_revision: policy.raci_revision,
        resource_revision: project.resource_revision,
        stop_conditions: []
    };
    return {
        ...authority,
        authority_resolution_receipt_id: receipt('authres', {
            authority,
            channel_id: policy.channel_id,
            canonical_person_id: identity.canonical_person_id,
            membership_id: identity.membership_id
        })
    };
}

function sortByRevision(rows) {
    return [...rows].sort((left, right) => Number(right.binding_revision) - Number(left.binding_revision)
        || String(left.binding_id).localeCompare(String(right.binding_id)));
}

export class SlackChannelAuthorityRepository extends PostgresCompanyAuthorityRepository {
    constructor({ pool, now = () => new Date(), policies = [] } = {}) {
        super({ pool, now });
        this.policies = normalizeSlackChannelAuthorityPolicies(policies);
    }

    #selected(request) {
        const policy = policyForChannel(this.policies, channelIdFor(request));
        if (!policy) return null;
        assertSelectedScope(policy, request);
        if (request.requested_action?.resource_ref?.startsWith('personal://')) return null;
        const project = selectedProject(policy, request);
        if (!project) return { policy, project: null };
        return { policy, project };
    }

    async resolveSlackChannelAuthority(request) {
        const selected = this.#selected(request);
        if (!selected || !selected.project) return null;
        const { policy, project } = selected;
        const subject = requiredString(requestSubject(request), 'provider_identity.authenticated_subject_id');
        return this.withTenant(policy.tenant_id, async (client) => {
            const projectRows = rowsOrEmpty(await client.query(
                `SELECT project_id, project_code, project_payload
                   FROM tenant_projects
                  WHERE tenant_id = $1 AND project_id = $2
                  LIMIT 2 FOR SHARE`,
                [policy.tenant_id, project.project_id]
            ));
            const projectRow = oneOrError(projectRows, 'COMPANY_IDENTITY_UNRESOLVED', 'COMPANY_IDENTITY_AMBIGUOUS');
            // Project status is optional in the existing tenant-project schema;
            // membership status is required and remains fail-closed below.
            const projectStatus = projectRow.project_payload?.status;
            if (projectRow.project_code !== project.project_code
                || (projectStatus !== undefined && projectStatus !== 'active')) {
                fail('PROJECT_SCOPE_MISMATCH');
            }

            const grantRows = rowsOrEmpty(await client.query(
                `SELECT ag.id AS grant_id,
                        ag.person_id AS canonical_person_id,
                        ag.person_name,
                        ag.role,
                        ag.project_codes,
                        ag.clearance,
                        ag.active
                   FROM auth_grants ag
                   JOIN people p ON p.id = ag.person_id AND p.status = 'active'
                  WHERE ag.slack_user_id = $1
                    AND ag.slack_workspace_id = $2
                    AND ag.organization_id = $3
                    AND ag.active = true
                  ORDER BY ag.id
                  LIMIT 2 FOR SHARE`,
                [subject, policy.workspace_id, policy.graph_organization_id]
            ));
            const grant = oneOrError(grantRows);
            if (grant.active !== true || !grant.canonical_person_id) fail('COMPANY_IDENTITY_UNRESOLVED');

            const membershipRows = rowsOrEmpty(await client.query(
                `SELECT membership_id, organization_id, principal_id, membership_payload
                   FROM tenant_memberships
                  WHERE tenant_id = $1
                    AND organization_id = $2
                    AND principal_id = $3
                  ORDER BY membership_id
                  LIMIT 50 FOR SHARE`,
                [policy.tenant_id, policy.organization_id, grant.canonical_person_id]
            ));
            const activeMemberships = membershipRows.filter((row) => rowStatus(row.membership_payload) === 'active'
                && membershipRevision(row.membership_payload));
            if (activeMemberships.length === 0) {
                if (membershipRows.length > 0) fail('COMPANY_MEMBERSHIP_INACTIVE');
                fail('COMPANY_IDENTITY_UNRESOLVED');
            }
            const membership = oneOrError(activeMemberships, 'COMPANY_IDENTITY_UNRESOLVED', 'COMPANY_IDENTITY_AMBIGUOUS');
            const revision = membershipRevision(membership.membership_payload);

            const legacyIdentityRows = rowsOrEmpty(await client.query(
                `SELECT identity.identity_id,
                        identity.identity_revision,
                        identity.membership_id,
                        identity.project_id,
                        identity.placement_id,
                        identity.principal_type,
                        identity.status,
                        membership.organization_id AS legacy_organization_id,
                        membership.principal_id AS legacy_principal_id,
                        membership.membership_payload AS legacy_membership_payload
                   FROM company_external_identities identity
                   LEFT JOIN tenant_memberships membership
                     ON membership.tenant_id = identity.tenant_id
                    AND membership.membership_id = identity.membership_id
                  WHERE identity.tenant_id = $1
                    AND identity.provider = 'slack'
                    AND identity.authenticated_subject_id = $2
                    AND identity.workspace_id = $3
                    AND identity.app_id = $4
                    AND identity.project_id = $5
                   ORDER BY identity.identity_revision DESC
                  LIMIT 100 FOR SHARE OF identity`,
                [policy.tenant_id, subject, policy.workspace_id, policy.app_id, project.project_id]
            ));
            const legacyMembershipIds = [...new Set(
                legacyIdentityRows.map(({ membership_id }) => membership_id).filter(Boolean)
            )];
            const currentLegacyMemberships = legacyMembershipIds.length === 0
                ? []
                : rowsOrEmpty(await client.query(
                    `SELECT membership_id, organization_id, principal_id, membership_payload
                       FROM tenant_memberships
                      WHERE tenant_id = $1
                        AND membership_id = ANY($2::text[])
                      FOR SHARE`,
                    [policy.tenant_id, legacyMembershipIds]
                ));
            const currentLegacyMembershipById = new Map(
                currentLegacyMemberships.map((membership) => [membership.membership_id, membership])
            );
            for (const legacy of legacyIdentityRows) {
                if (legacy.status !== 'active') fail('COMPANY_MEMBERSHIP_INACTIVE');
                const currentMembership = currentLegacyMembershipById.get(legacy.membership_id);
                if (!currentMembership
                    || rowStatus(currentMembership.membership_payload) !== 'active'
                    || !membershipRevision(currentMembership.membership_payload)) {
                    fail('COMPANY_MEMBERSHIP_INACTIVE');
                }
            }

            const membershipIds = [...new Set([
                membership.membership_id,
                ...legacyMembershipIds
            ])];
            const resourceRefs = [`project:${project.project_id}`, `project:${project.project_code}`];
            const bindingRows = rowsOrEmpty(await client.query(
                `SELECT binding.binding_id,
                        binding.binding_revision,
                        binding.membership_id,
                        binding.organization_id,
                        binding.status,
                        binding.valid_from,
                        binding.valid_until,
                        binding.capability_id,
                        binding.decision,
                        binding.allowed_effects,
                        binding.responsible_person_id,
                        binding.accountable_person_id,
                        binding.approver_person_id,
                        binding.delegated_by_person_id,
                        binding.policy_revision,
                        binding.raci_revision,
                        binding.resource_revision,
                        binding.stop_conditions
                   FROM company_authority_bindings binding
                  WHERE binding.tenant_id = $1
                    AND binding.membership_id = ANY($2::text[])
                    AND binding.project_id = $3
                    AND binding.resource_ref = ANY($4::text[])
                    AND binding.capability_id = $5
                  ORDER BY binding.binding_revision DESC
                  FOR SHARE`,
                [policy.tenant_id, membershipIds, project.project_id, resourceRefs,
                    policy.capability_id]
            ));
            const currentBindings = bindingRows.filter((binding) => binding.status !== 'superseded');
            if (bindingRows.length > 0 && currentBindings.length === 0) fail('COMPANY_AUTHORITY_UNRESOLVED');
            const now = this.now().getTime();
            for (const binding of currentBindings) {
                const validFrom = new Date(binding.valid_from).getTime();
                const validUntil = binding.valid_until === null ? Infinity : new Date(binding.valid_until).getTime();
                if (binding.status !== 'active' || binding.valid_from == null || !Number.isFinite(validFrom)
                    || Number.isNaN(validUntil) || validFrom > now || validUntil <= now) {
                    fail('COMPANY_AUTHORITY_DENIED');
                }
                if (!DECISIONS.has(binding.decision) || binding.capability_id !== policy.capability_id) {
                    fail('COMPANY_AUTHORITY_UNRESOLVED');
                }
            }

            const identityBase = {
                tenant_id: policy.tenant_id,
                canonical_person_id: grant.canonical_person_id,
                principal_type: 'person',
                membership_id: membership.membership_id,
                membership_revision: revision,
                organization_id: policy.organization_id,
                project_id: projectRow.project_id,
                project_code: projectRow.project_code,
                placement_id: project.placement_id,
                status: 'active',
                identity_revision: policy.policy_revision,
                membership_access: {
                    role: membership.membership_payload?.role
                        ?? membership.membership_payload?.role_code ?? grant.role ?? 'member',
                    project_codes: Array.isArray(membership.membership_payload?.project_codes)
                        ? [...membership.membership_payload.project_codes]
                        : [],
                    clearance: Array.isArray(membership.membership_payload?.clearance)
                        ? [...membership.membership_payload.clearance]
                        : [...(grant.clearance ?? [])]
                }
            };
            const identity = {
                ...identityBase,
                identity_resolution_receipt_id: receipt('idres', {
                    identity: identityBase,
                    channel_id: policy.channel_id,
                    graph_organization_id: policy.graph_organization_id
                })
            };

            const orderedBindings = sortByRevision(currentBindings);
            const deny = orderedBindings.find((binding) => binding.decision === 'deny');
            if (deny) {
                return { identity, authority: authorityFromBinding(deny, policy, identity, []) };
            }
            const explicit = orderedBindings.filter((binding) => binding.decision !== 'auto');
            if (new Set(explicit.map(({ decision }) => decision)).size > 1
                || explicit.length > 1) {
                fail('COMPANY_AUTHORITY_AMBIGUOUS', { status: 409 });
            }
            const selectedBinding = explicit[0] ?? orderedBindings[0] ?? null;
            const allowedEffects = effectiveEffects(policy, orderedBindings);
            if (!allowedEffects.includes(requestedEffect(request))) fail('COMPANY_EFFECT_NOT_ALLOWED');
            const authority = selectedBinding
                ? authorityFromBinding(selectedBinding, policy, identity, allowedEffects)
                : syntheticAuthority(policy, project, identity);
            return { identity, authority };
        });
    }

    async resolveObservedRoute(request) {
        const selected = this.#selected(request);
        if (!selected || !selected.project) return super.resolveObservedRoute(request);
        const { policy, project } = selected;
        const subject = requestSubject(request);
        requiredString(subject, 'provider_identity.authenticated_subject_id');
        return this.withTenant(policy.tenant_id, async (client) => {
            const tenantRows = rowsOrEmpty(await client.query(
                `SELECT tenant_id, tenant_revision, status
                   FROM brainbase_tenants
                  WHERE tenant_id = $1 AND status = 'active'
                  LIMIT 2 FOR SHARE`,
                [policy.tenant_id]
            ));
            const tenant = oneOrError(tenantRows, 'COMPANY_IDENTITY_UNRESOLVED', 'COMPANY_IDENTITY_AMBIGUOUS');
            const connectionRows = rowsOrEmpty(await client.query(
                `SELECT connection_id, connection_revision, tenant_id,
                        provider, workspace_id, app_id, status
                   FROM workspace_connections
                  WHERE tenant_id = $1
                    AND provider = 'slack'
                    AND workspace_id = $2
                    AND app_id = $3
                    AND status = 'active'
                  ORDER BY connection_revision DESC
                  LIMIT 2 FOR SHARE`,
                [policy.tenant_id, policy.workspace_id, policy.app_id]
            ));
            const connection = oneOrError(
                connectionRows,
                'COMPANY_IDENTITY_UNRESOLVED',
                'COMPANY_IDENTITY_AMBIGUOUS'
            );
            if (connection.provider !== 'slack' || connection.tenant_id !== policy.tenant_id
                || connection.workspace_id !== policy.workspace_id || connection.app_id !== policy.app_id) {
                fail('AUTHORITY_SCOPE_MISMATCH');
            }
            if (request.tenant_id !== undefined && request.tenant_id !== policy.tenant_id) {
                fail('AUTHORITY_SCOPE_MISMATCH');
            }
            if (request.connection_id !== undefined && request.connection_id !== connection.connection_id) {
                fail('AUTHORITY_SCOPE_MISMATCH');
            }
            return {
                tenant_id: tenant.tenant_id,
                tenant_revision: tenant.tenant_revision,
                connection_id: connection.connection_id,
                connection_revision: connection.connection_revision,
                workspace_id: connection.workspace_id,
                app_id: connection.app_id,
                channel_id: policy.channel_id,
                project_id: project.project_id,
                project_code: project.project_code,
                placement_id: project.placement_id,
                policy_revision: policy.policy_revision
            };
        });
    }
}

function requestedEffect(request) {
    return request?.requested_action?.desired_effect;
}
