import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL scenario: single-org member', () => {
  it('S-2: single-org member retrieves only its org context', () => {
    const unson = getJwt('ctx-unson-only-member');
    expect(canRetrieve(unson, entity('ent-org-customer-unson'))).toMatchObject({ allow: true });
    expect(canRetrieve(unson, entity('ent-org-customer-st'))).toMatchObject({ allow: false, reason: 'org mismatch' });
    expect(canRetrieve(unson, entity('ent-org-customer-tk'))).toMatchObject({ allow: false, reason: 'org mismatch' });
  });
});
