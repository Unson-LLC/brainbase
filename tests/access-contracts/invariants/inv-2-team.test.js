import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL contract: team visibility', () => {
  it('INV-2: team visibility allows only actor team_id membership', () => {
    expect(canRetrieve(getJwt('ctx-st-only-member'), entity('ent-team-sales-note'))).toMatchObject({ allow: true });
    expect(canRetrieve(getJwt('ctx-unson-only-member'), entity('ent-team-sales-note'))).toMatchObject({
      allow: false,
      reason: 'team mismatch',
    });
  });
});
