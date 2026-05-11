import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL contract: multi-org member', () => {
  it('INV-10: multi-org actor retrieves by org intersection without special cross-org treatment', () => {
    expect(canRetrieve(getJwt('ctx-sato-4org'), entity('ent-org-customer-st'))).toMatchObject({ allow: true });
    expect(canRetrieve(getJwt('ctx-sato-4org'), entity('ent-org-customer-tk'))).toMatchObject({ allow: true });
    expect(canRetrieve(getJwt('ctx-st-only-member'), entity('ent-org-customer-tk'))).toMatchObject({
      allow: false,
      reason: 'org mismatch',
    });
  });
});
