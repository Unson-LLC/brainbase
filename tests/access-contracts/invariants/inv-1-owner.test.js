import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL contract: owner visibility', () => {
  it('INV-1: owner visibility allows only matching owner_person_id', () => {
    expect(canRetrieve(getJwt('ctx-sato-4org'), entity('ent-personal-observation'))).toMatchObject({ allow: true });
    expect(canRetrieve(getJwt('ctx-unson-only-member'), entity('ent-personal-observation'))).toMatchObject({
      allow: false,
      reason: 'owner mismatch',
    });
  });
});
