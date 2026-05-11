import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL scenario: multi-org CEO', () => {
  it('S-1: 4org CEO retrieves team and org entities across member orgs but not other owner visibility', () => {
    const sato = getJwt('ctx-sato-4org');
    expect(canRetrieve(sato, entity('ent-org-customer-st'))).toMatchObject({ allow: true });
    expect(canRetrieve(sato, entity('ent-org-customer-unson'))).toMatchObject({ allow: true });
    expect(canRetrieve(sato, entity('ent-org-customer-tk'))).toMatchObject({ allow: true });
    expect(canRetrieve(sato, entity('ent-team-sales-note'))).toMatchObject({ allow: true });
    expect(canRetrieve(getJwt('ctx-st-only-member'), entity('ent-personal-observation'))).toMatchObject({
      allow: false,
      reason: 'owner mismatch',
    });
  });
});
