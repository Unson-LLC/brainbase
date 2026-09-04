// @ts-check
import fs from 'node:fs';

import { acceptCompanyAuthorityResponse } from '../../contracts/mana-brainbase-company-authority/v1/reference/wire.mjs';
import { requirePersonalKgIdentity } from '../../server/services/sns/personal-kg-identity.js';

function readJsonValue(value, name) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) throw new Error(`${name}_required`);
    const source = normalized.startsWith('@')
        ? fs.readFileSync(normalized.slice(1), 'utf8')
        : normalized;
    try {
        return JSON.parse(source);
    } catch {
        throw new Error(`${name}_invalid_json`);
    }
}

export function loadCompanyAuthorityResponse(env = process.env) {
    return readJsonValue(
        env.BRAINBASE_COMPANY_AUTHORITY_RESPONSE_JSON,
        'BRAINBASE_COMPANY_AUTHORITY_RESPONSE_JSON'
    );
}

function hasSelfAssertedIdentity(asserted = {}) {
    return [
        asserted.ownerPersonId,
        asserted.owner_person_id,
        asserted.actorPersonId,
        asserted.actor_person_id,
        asserted.organizationId,
        asserted.organization_id,
        asserted.projectCode,
        asserted.project_code,
        asserted.delegationId,
        asserted.delegation_id
    ].some((value) => typeof value === 'string' && value.trim());
}

/**
 * Resolve Personal KG CLI identity exclusively from a verified, signed company
 * authority response. Legacy owner/actor/org/delegation flags are rejected so
 * they cannot override the authenticated identity.
 */
export function resolvePersonalKgCliAuthority({
    assertedIdentity = {},
    desiredEffect,
    env = process.env,
    now = new Date()
} = {}) {
    if (hasSelfAssertedIdentity(assertedIdentity) || hasSelfAssertedIdentity({
        owner_person_id: env.BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID,
        actor_person_id: env.BRAINBASE_PERSONAL_KG_ACTOR_PERSON_ID,
        organization_id: env.BRAINBASE_PERSONAL_KG_ORGANIZATION_ID,
        project_code: env.BRAINBASE_PERSONAL_KG_PROJECT_CODE,
        delegation_id: env.BRAINBASE_PERSONAL_KG_DELEGATION_ID
    })) {
        throw new Error('personal_kg_cli_self_asserted_identity_forbidden');
    }
    const response = loadCompanyAuthorityResponse(env);
    const publicJwk = readJsonValue(
        env.BRAINBASE_COMPANY_AUTHORITY_PUBLIC_JWK_JSON,
        'BRAINBASE_COMPANY_AUTHORITY_PUBLIC_JWK_JSON'
    );
    const tenantContextPublicJwk = env.BRAINBASE_TENANT_CONTEXT_PUBLIC_JWK_JSON
        ? readJsonValue(env.BRAINBASE_TENANT_CONTEXT_PUBLIC_JWK_JSON, 'BRAINBASE_TENANT_CONTEXT_PUBLIC_JWK_JSON')
        : publicJwk;
    const expectedDeploymentId = typeof env.BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID === 'string'
        ? env.BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID.trim()
        : '';
    if (!expectedDeploymentId) throw new Error('BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID_required');
    const ownerPersonId = response?.context?.scope?.owner_person_id;
    const accepted = acceptCompanyAuthorityResponse(response, {
        expectedAudience: env.BRAINBASE_TENANT_RUNTIME_AUDIENCE || 'mana-runtime',
        expectedDeploymentId,
        now,
        publicJwk,
        tenantContextPublicJwk,
        personalTargetPersonId: ownerPersonId
    });
    const context = accepted.context;
    if (!context || context.authority.decision !== 'auto') {
        throw new Error('personal_kg_cli_executable_authority_required');
    }
    if (!desiredEffect || !context.authority.allowed_effects.includes(desiredEffect)) {
        throw new Error('personal_kg_cli_effect_not_allowed');
    }
    return requirePersonalKgIdentity({
        owner_person_id: context.scope.owner_person_id,
        actor_person_id: context.actor.canonical_person_id,
        organization_id: context.scope.organization_id,
        org_ids: [context.scope.organization_id],
        project_code: context.scope.project_id,
        authority_resolution_receipt_id: context.evidence.authority_resolution_receipt_id,
        identity_resolution_receipt_id: context.evidence.identity_resolution_receipt_id
    });
}
