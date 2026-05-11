import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL scenario: project outsider', () => {
  it('S-4: actor without target projectCode is denied project-scoped org entity', () => {
    expect(canRetrieve(getJwt('ctx-unson-only-member'), entity('ent-techknight-project-decision'))).toMatchObject({
      allow: false,
      reason: 'org mismatch',
    });
  });
});
