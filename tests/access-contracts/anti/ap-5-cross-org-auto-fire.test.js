import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL anti-pattern: cross-org auto fire', () => {
  it('AP-5: multi-org membership does not auto-inject unrelated org context for single-org actors', () => {
    expect(canRetrieve(getJwt('ctx-st-only-member'), entity('ent-org-customer-unson'))).toMatchObject({
      allow: false,
      reason: 'org mismatch',
    });
    expect(canRetrieve(getJwt('ctx-sato-4org'), entity('ent-org-customer-unson'))).toMatchObject({ allow: true });
  });
});
