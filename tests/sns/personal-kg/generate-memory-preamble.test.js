// @ts-check
import { describe, expect, it, vi } from 'vitest';

import {
  fetchPersonalKg,
  resolvePersonalKgAccess,
} from '../../../scripts/generate-memory-preamble.mjs';

describe('generate memory preamble Personal KG boundary', () => {
  it('requires explicit owner, actor, and organization identity', () => {
    expect(() => resolvePersonalKgAccess({})).toThrow('personal_kg_owner_person_id_required');
    expect(() => resolvePersonalKgAccess({
      MEMORY_PREAMBLE_OWNER_PERSON_ID: 'person_a',
    })).toThrow('personal_kg_actor_person_id_required');
    expect(() => resolvePersonalKgAccess({
      MEMORY_PREAMBLE_OWNER_PERSON_ID: 'person_a',
      MEMORY_PREAMBLE_ACTOR_PERSON_ID: 'person_a',
    })).toThrow('personal_kg_organization_id_required');
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
          personId: 'person_a',
          organizationId: 'org_a',
          projectCodes: ['brainbase'],
          role: 'member',
          clearance: ['internal'],
        });
        return work({
          listPersonalKg: async ({ owner_person_id, cognitive_type, owner_read }) => [{
            id: `${cognitive_type}_allowed`,
            owner_person_id,
            actor_person_id: 'person_a',
            organization_id: 'org_a',
            visibility: 'owner',
            cognitive_type,
            body: `${cognitive_type} allowed`,
            confidence: 0.8,
          }, {
            id: `${cognitive_type}_cross_tenant`,
            owner_person_id,
            actor_person_id: 'person_a',
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
        INFO_SSOT_DATABASE_URL: 'postgres://example',
        MEMORY_PREAMBLE_OWNER_PERSON_ID: 'person_a',
        MEMORY_PREAMBLE_ACTOR_PERSON_ID: 'person_a',
        MEMORY_PREAMBLE_ORGANIZATION_ID: 'org_a',
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
