import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL contract: empty org_ids default deny', () => {
  it('INV-7: empty org_ids deny for non-public visibility and do not block public visibility', () => {
    expect(canRetrieve(getJwt('ctx-sato-4org'), entity('ent-unknown-org'))).toMatchObject({
      allow: false,
      reason: 'org_ids empty default deny',
    });
    expect(canRetrieve(getJwt('ctx-unson-only-member'), entity('ent-public-philosophy'))).toMatchObject({ allow: true });
  });
});
