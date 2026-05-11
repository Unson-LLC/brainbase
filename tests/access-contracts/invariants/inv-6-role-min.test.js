import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL contract: role_min', () => {
  it('INV-6: role_min above actor role rank is denied', () => {
    expect(canRetrieve(getJwt('ctx-ex-gm-demoted'), entity('ent-team-decision'))).toMatchObject({
      allow: false,
      reason: 'role_min exceeds actor role',
    });
    expect(canRetrieve(getJwt('ctx-sato-4org'), entity('ent-team-decision'))).toMatchObject({ allow: true });
  });
});
