import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL contract: sensitivity', () => {
  it('INV-5: sensitivity exceeding actor clearance is denied', () => {
    expect(canRetrieve(getJwt('ctx-sato-4org'), entity('ent-top-secret-contract'))).toMatchObject({ allow: true });
    expect(canRetrieve(getJwt('ctx-ex-gm-demoted'), entity('ent-top-secret-contract'))).toMatchObject({
      allow: false,
      reason: 'sensitivity exceeds clearance',
    });
  });
});
