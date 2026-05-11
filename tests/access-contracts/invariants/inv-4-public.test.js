import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL contract: public visibility', () => {
  it('INV-4: public visibility is retrievable by all actors while role_min still applies', () => {
    expect(canRetrieve(getJwt('ctx-baao-only-member'), entity('ent-public-philosophy'))).toMatchObject({ allow: true });
    expect(canRetrieve(getJwt('ctx-st-only-member'), entity('ent-public-philosophy'))).toMatchObject({ allow: true });
    expect(canRetrieve(getJwt('ctx-unson-only-member'), entity('ent-public-gm-philosophy'))).toMatchObject({
      allow: false,
      reason: 'role_min exceeds actor role',
    });
  });
});
