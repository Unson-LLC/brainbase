import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL anti-pattern: unknown org allow', () => {
  it('AP-1: unknown org_ids are not allowed for non-public entity', () => {
    expect(canRetrieve(getJwt('ctx-sato-4org'), entity('ent-unknown-org'))).toMatchObject({
      allow: false,
      reason: 'org_ids empty default deny',
    });
  });
});
