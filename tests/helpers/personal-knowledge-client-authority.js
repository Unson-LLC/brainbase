import fs from 'node:fs';

import {
    createDetachedJws,
    TENANT_CONTEXT_PROTECTED_TYP
} from '../../contracts/mana-brainbase-company-authority/v1/reference/wire.mjs';

const CASES_URL = new URL(
    '../../contracts/mana-brainbase-company-authority/v1/fixtures/cases.json',
    import.meta.url
);
const KEY_URL = new URL(
    '../../contracts/mana-brainbase-company-authority/v1/fixtures/test-key.json',
    import.meta.url
);

function readJson(url) {
    return JSON.parse(fs.readFileSync(url, 'utf8'));
}

function clone(value) {
    return structuredClone(value);
}

function timestamp(value) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return value;
    return new Date(value).toISOString();
}

/**
 * Build a freshly signed Personal KG authority response for middleware and
 * PostgreSQL integration tests. Every field which is changed is covered by
 * the nested and outer detached signatures again.
 */
export function createPersonalKnowledgeAuthority({
    effect = 'read',
    owner = 'person-sato',
    organization = 'organization-tenant-a',
    channel = 'DCLIENT',
    project = 'project-a',
    deploymentId,
    audience = 'mana-runtime',
    now = new Date(),
    issuedAt,
    expiresAt,
    capability = effect === 'write' ? 'personal_write' : 'personal_read',
    allowedEffects = [effect],
    principalType = 'person',
    canonicalPersonId = owner,
    externalSubjectId = owner,
    authenticatedSubjectId = externalSubjectId,
    requesterId = externalSubjectId,
    correlationId,
    eventId,
    threadTs = 'thread-client',
    resourceRef = `personal://${owner}/notes`,
    dataScopes = ['personal'],
    mutate
} = {}) {
    const cases = readJson(CASES_URL);
    const key = readJson(KEY_URL);
    const fixture = cases.positive.find((entry) => entry.id === 'POS-PERSONAL-AUTO-OWNER');
    if (!fixture) throw new Error('personal authority fixture is missing');

    const context = clone(fixture.context);
    const request = clone(fixture.request);
    const effectiveNow = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(effectiveNow.getTime())) throw new Error('authority now must be a valid date');
    const issued = timestamp(issuedAt ?? new Date(effectiveNow.getTime() - 60_000));
    const expires = timestamp(expiresAt ?? new Date(effectiveNow.getTime() + 180_000));
    const deployment = deploymentId ?? context.scope.placement_id;
    const correlation = correlationId ?? request.correlation_id;
    const resolvedEventId = eventId ?? context.tenant_context.slack.event_id;
    const resolvedAudience = Array.isArray(audience) ? [...audience] : [audience];

    context.issued_at = issued;
    context.expires_at = expires;
    context.actor.external_subject_id = externalSubjectId;
    context.actor.canonical_person_id = canonicalPersonId;
    context.actor.membership_id = `membership-${organization}-${canonicalPersonId}`;
    context.scope.organization_id = organization;
    context.scope.project_id = project;
    context.scope.resource_ref = resourceRef;
    context.scope.owner_person_id = owner;
    context.scope.placement_id = deployment;
    context.authority.capability_id = capability;
    context.authority.allowed_effects = [...allowedEffects];
    context.authority.accountable_person_id = owner;

    const tenant = context.tenant_context;
    tenant.audience = resolvedAudience;
    tenant.actor.principal_id = canonicalPersonId;
    tenant.actor.principal_type = principalType;
    tenant.actor.authenticated_subject_id = authenticatedSubjectId;
    tenant.authorization.organization_ids = [organization];
    tenant.authorization.project_ids = [project];
    tenant.authorization.data_scopes = [...dataScopes];
    tenant.placement.deployment_id = deployment;
    tenant.slack.channel_id = channel;
    tenant.slack.event_id = resolvedEventId;
    tenant.slack.requester_id = requesterId;
    tenant.slack.thread_ts = threadTs;
    tenant.correlation_id = correlation;
    tenant.issued_at = issued;
    tenant.expires_at = expires;

    request.provider_identity.authenticated_subject_id = externalSubjectId;
    request.requested_action.capability_id = capability;
    request.requested_action.desired_effect = effect;
    request.requested_action.resource_ref = resourceRef;
    request.requested_action.project_hint = project;
    request.delivery.channel_id = channel;
    request.delivery.event_id = resolvedEventId;
    request.delivery.thread_ts = threadTs;
    request.correlation_id = correlation;

    if (typeof mutate === 'function') mutate({ context, request });

    tenant.integrity.value = createDetachedJws(
        tenant,
        key.private_jwk,
        tenant.integrity.key_id,
        { typ: TENANT_CONTEXT_PROTECTED_TYP }
    );
    context.integrity.value = createDetachedJws(context, key.private_jwk, context.integrity.key_id);

    const response = {
        schema_version: cases.schema_version,
        contract_id: cases.contract_id,
        correlation_id: tenant.correlation_id,
        context,
        error: null
    };
    const env = {
        ...process.env,
        BRAINBASE_COMPANY_AUTHORITY_PUBLIC_JWK_JSON: JSON.stringify(key.public_jwk),
        BRAINBASE_TENANT_CONTEXT_PUBLIC_JWK_JSON: JSON.stringify(key.public_jwk),
        BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID: deployment,
        BRAINBASE_TENANT_RUNTIME_AUDIENCE: resolvedAudience[0],
        BRAINBASE_COMPANY_AUTHORITY_RESPONSE_JSON: JSON.stringify(response)
    };

    return {
        response,
        context,
        request,
        env,
        publicJwk: key.public_jwk,
        privateJwk: key.private_jwk,
        now: effectiveNow,
        project,
        owner,
        organization,
        channel
    };
}
