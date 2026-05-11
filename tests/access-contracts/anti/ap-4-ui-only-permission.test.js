import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL anti-pattern: UI-only permission', () => {
  it('AP-4: UI requiredLevel does not override server-side role_min', () => {
    expect(entity('ent-ui-only-permission').ui_permission.requiredLevel).toBe(1);
    expect(canRetrieve(getJwt('ctx-unson-only-member'), entity('ent-ui-only-permission'))).toMatchObject({
      allow: false,
      reason: 'role_min exceeds actor role',
    });
  });
});
