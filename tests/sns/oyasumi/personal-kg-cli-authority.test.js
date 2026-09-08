import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { resolvePersonalKgCliAuthority } from '../../../scripts/lib/personal-kg-cli-authority.js';

const cases = JSON.parse(fs.readFileSync(
    'contracts/mana-brainbase-company-authority/v1/fixtures/cases.json',
    'utf8'
));
const key = JSON.parse(fs.readFileSync(
    'contracts/mana-brainbase-company-authority/v1/fixtures/test-key.json',
    'utf8'
));
const fixture = cases.positive.find((entry) => entry.id === 'POS-PERSONAL-AUTO-OWNER');
const response = {
    schema_version: cases.schema_version,
    contract_id: cases.contract_id,
    correlation_id: fixture.request.correlation_id,
    context: fixture.context,
    error: null
};
const env = {
    BRAINBASE_COMPANY_AUTHORITY_RESPONSE_JSON: JSON.stringify(response),
    BRAINBASE_COMPANY_AUTHORITY_PUBLIC_JWK_JSON: JSON.stringify(key.public_jwk),
    BRAINBASE_TENANT_CONTEXT_PUBLIC_JWK_JSON: JSON.stringify(key.public_jwk),
    BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID: fixture.context.scope.placement_id
};

describe('Personal KG CLI company authority boundary', () => {
    it('derives owner, actor, organization, and project only from a verified context', () => {
        expect(resolvePersonalKgCliAuthority({
            desiredEffect: 'read',
            env,
            now: new Date('2026-08-21T00:01:00Z')
        })).toMatchObject({
            owner_person_id: fixture.context.scope.owner_person_id,
            actor_person_id: fixture.context.actor.canonical_person_id,
            organization_id: fixture.context.scope.organization_id,
            project_code: fixture.context.scope.project_id
        });
    });

    it('rejects legacy self-asserted identity even when a signed context is present', () => {
        expect(() => resolvePersonalKgCliAuthority({
            assertedIdentity: { ownerPersonId: 'victim-person' },
            desiredEffect: 'read',
            env,
            now: new Date('2026-08-21T00:01:00Z')
        })).toThrow('personal_kg_cli_self_asserted_identity_forbidden');
    });

    it('rejects tampered and effect-mismatched contexts before access', () => {
        const tampered = structuredClone(response);
        tampered.context.scope.owner_person_id = 'victim-person';
        expect(() => resolvePersonalKgCliAuthority({
            desiredEffect: 'read',
            env: { ...env, BRAINBASE_COMPANY_AUTHORITY_RESPONSE_JSON: JSON.stringify(tampered) },
            now: new Date('2026-08-21T00:01:00Z')
        })).toThrow('Ed25519 signature verification failed');
        expect(() => resolvePersonalKgCliAuthority({
            desiredEffect: 'write',
            env,
            now: new Date('2026-08-21T00:01:00Z')
        })).toThrow('personal_kg_cli_effect_not_allowed');
    });

    it('requires an explicit runtime deployment binding', () => {
        const { BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID: _deploymentId, ...unboundEnv } = env;
        expect(() => resolvePersonalKgCliAuthority({
            desiredEffect: 'read',
            env: unboundEnv,
            now: new Date('2026-08-21T00:01:00Z')
        })).toThrow('BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID_required');
    });
});
