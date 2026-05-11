import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve, canRetrieveForSynthesis } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL scenario: agency_level synthesis exclusion', () => {
  it('S-8: agency_level none denies synthesis while allowing direct read', () => {
    const agencyNone = entity('ent-agency-none');
    expect(canRetrieveForSynthesis(getJwt('ctx-sato-4org'), agencyNone)).toMatchObject({
      allow: false,
      reason: 'agency_level none excludes synthesis',
    });
    expect(canRetrieve(getJwt('ctx-sato-4org'), agencyNone)).toMatchObject({ allow: true });
  });
});
