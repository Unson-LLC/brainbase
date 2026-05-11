import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve, canRetrieveForSynthesis } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL contract: agency_level', () => {
  it('INV-8: agency_level none excludes synthesis but not direct retrieval', () => {
    expect(canRetrieve(getJwt('ctx-sato-4org'), entity('ent-agency-none'))).toMatchObject({ allow: true });
    expect(canRetrieveForSynthesis(getJwt('ctx-sato-4org'), entity('ent-agency-none'))).toMatchObject({
      allow: false,
      reason: 'agency_level none excludes synthesis',
    });
  });
});
