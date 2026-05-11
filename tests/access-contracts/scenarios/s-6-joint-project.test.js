import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL scenario: joint project', () => {
  it('S-6: joint project is allowed by org intersection and denied for unrelated org member', () => {
    const joint = entity('ent-joint-baao-unson');
    expect(canRetrieve(getJwt('ctx-sato-4org'), joint)).toMatchObject({ allow: true });
    expect(canRetrieve(getJwt('ctx-unson-only-member'), joint)).toMatchObject({ allow: true });
    expect(canRetrieve(getJwt('ctx-st-only-member'), joint)).toMatchObject({ allow: false, reason: 'org mismatch' });
  });
});
