import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL contract: candidate-store isolation', () => {
  it('INV-9: candidate-store records are not retrieved through Graph SSOT path', () => {
    expect(canRetrieve(getJwt('ctx-sato-4org'), entity('ent-candidate-observation'))).toMatchObject({
      allow: false,
      reason: 'candidate-store-isolated',
    });
  });
});
