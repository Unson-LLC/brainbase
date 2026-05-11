import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL scenario: sensitivity overflow', () => {
  it('S-7: actor clearance below top-secret is denied top-secret entity', () => {
    expect(canRetrieve(getJwt('ctx-ex-gm-demoted'), entity('ent-top-secret-contract'))).toMatchObject({
      allow: false,
      reason: 'sensitivity exceeds clearance',
    });
  });
});
