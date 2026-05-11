import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL contract: org visibility', () => {
  it('INV-3: org visibility requires intersection between actor project orgs and entity org_ids', () => {
    expect(canRetrieve(getJwt('ctx-st-only-member'), entity('ent-org-customer-st'))).toMatchObject({ allow: true });
    expect(canRetrieve(getJwt('ctx-unson-only-member'), entity('ent-org-customer-st'))).toMatchObject({
      allow: false,
      reason: 'org mismatch',
    });
  });
});
