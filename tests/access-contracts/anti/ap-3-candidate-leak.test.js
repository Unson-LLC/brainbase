import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL anti-pattern: candidate leak', () => {
  it('AP-3: candidate-store record does not leak through Graph SSOT retrieval', () => {
    expect(canRetrieve(getJwt('ctx-sato-4org'), entity('ent-candidate-observation'))).toMatchObject({
      allow: false,
      reason: 'candidate-store-isolated',
    });
  });
});
