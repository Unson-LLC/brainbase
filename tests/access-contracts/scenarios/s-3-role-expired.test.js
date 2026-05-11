import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL scenario: expired role', () => {
  it('S-3: demoted GM is denied for gm role_min entity', () => {
    expect(canRetrieve(getJwt('ctx-ex-gm-demoted'), entity('ent-team-decision'))).toMatchObject({
      allow: false,
      reason: 'role_min exceeds actor role',
    });
  });
});
