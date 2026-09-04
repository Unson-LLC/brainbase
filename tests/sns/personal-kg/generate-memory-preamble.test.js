// @ts-check
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  createDetachedJws,
  TENANT_CONTEXT_PROTECTED_TYP,
} from '../../../contracts/mana-brainbase-company-authority/v1/reference/wire.mjs';
import {
  fetchPersonalKg,
  resolvePersonalKgAccess,
} from '../../../scripts/generate-memory-preamble.mjs';

function personalAuthorityEnv() {
  const cases = JSON.parse(fs.readFileSync(
    'contracts/mana-brainbase-company-authority/v1/fixtures/cases.json',
    'utf8',
  ));
  const key = JSON.parse(fs.readFileSync(
    'contracts/mana-brainbase-company-authority/v1/fixtures/test-key.json',
    'utf8',
  ));
  const fixture = cases.positive.find((entry) => entry.id === 'POS-PERSONAL-AUTO-OWNER');
  const context = structuredClone(fixture.context);
  const issuedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 3 * 60_000).toISOString();
  context.issued_at = issuedAt;
  context.expires_at = expiresAt;
  context.tenant_context.issued_at = issuedAt;
  context.tenant_context.expires_at = expiresAt;
  context.tenant_context.integrity.value = createDetachedJws(
    context.tenant_context,
    key.private_jwk,
    context.tenant_context.integrity.key_id,
    { typ: TENANT_CONTEXT_PROTECTED_TYP },
  );
  context.integrity.value = createDetachedJws(context, key.private_jwk, context.integrity.key_id);
  return {
    BRAINBASE_COMPANY_AUTHORITY_RESPONSE_JSON: JSON.stringify({
      schema_version: cases.schema_version,
      contract_id: cases.contract_id,
      correlation_id: fixture.request.correlation_id,
      context,
      error: null,
    }),
    BRAINBASE_COMPANY_AUTHORITY_PUBLIC_JWK_JSON: JSON.stringify(key.public_jwk),
    BRAINBASE_TENANT_CONTEXT_PUBLIC_JWK_JSON: JSON.stringify(key.public_jwk),
    BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID: context.scope.placement_id,
  };
}

describe('generate memory preamble Personal KG boundary', () => {
  it('requires signed company authority and rejects legacy self-asserted identity', () => {
    expect(() => resolvePersonalKgAccess({})).toThrow('BRAINBASE_COMPANY_AUTHORITY_RESPONSE_JSON_required');
    expect(() => resolvePersonalKgAccess({
      MEMORY_PREAMBLE_OWNER_PERSON_ID: 'person_a',
      ...personalAuthorityEnv(),
    })).toThrow('personal_kg_cli_self_asserted_identity_forbidden');
  });

  it('uses owner and organization RLS access and excludes cross-tenant rows', async () => {
    const end = vi.fn();
    class FakePool {
      constructor(config) {
        expect(config).toEqual({ connectionString: 'postgres://example' });
      }

      end() {
        end();
        return Promise.resolve();
      }
    }
    class FakeRepository {
      constructor({ pool }) {
        expect(pool).toBeInstanceOf(FakePool);
      }

      async transaction(work, options) {
        expect(options.access).toMatchObject({
          personId: 'person-sato',
          organizationId: 'organization-tenant-a',
          projectCodes: ['brainbase'],
          role: 'member',
          clearance: ['internal'],
        });
        return work({
          listPersonalKg: async ({ owner_person_id, cognitive_type, owner_read }) => [{
            id: `${cognitive_type}_allowed`,
            owner_person_id,
            actor_person_id: 'person-sato',
            organization_id: 'organization-tenant-a',
            visibility: 'owner',
            cognitive_type,
            body: `${cognitive_type} allowed`,
            confidence: 0.8,
          }, {
            id: `${cognitive_type}_cross_tenant`,
            owner_person_id,
            actor_person_id: 'person-sato',
            organization_id: 'org_b',
            visibility: 'owner',
            cognitive_type,
            body: `${cognitive_type} blocked`,
            confidence: 0.9,
          }].map((candidate) => {
            expect(owner_read).toBe(true);
            return candidate;
          }),
        });
      }
    }

    const result = await fetchPersonalKg({
      env: {
        ...personalAuthorityEnv(),
        INFO_SSOT_DATABASE_URL: 'postgres://example',
        BRAINBASE_PROJECTS: 'brainbase',
      },
      PoolClass: FakePool,
      RepositoryClass: FakeRepository,
    });

    expect(result.status).toBe('available');
    expect(result.records.map(({ id }) => id)).toEqual(['insight_allowed', 'claim_allowed']);
    expect(end).toHaveBeenCalledOnce();
  });
});
