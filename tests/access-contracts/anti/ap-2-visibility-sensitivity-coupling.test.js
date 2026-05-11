import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL anti-pattern: visibility and sensitivity coupling', () => {
  it('AP-2: org visibility does not imply low sensitivity access', () => {
    expect(canRetrieve(getJwt('ctx-unson-only-member'), entity('ent-org-top-secret-public-team'))).toMatchObject({
      allow: false,
      reason: 'sensitivity exceeds clearance',
    });
    expect(canRetrieve(getJwt('ctx-sato-4org'), entity('ent-org-top-secret-public-team'))).toMatchObject({ allow: true });
  });
});
