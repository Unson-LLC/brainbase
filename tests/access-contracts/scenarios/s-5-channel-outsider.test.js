import { describe, expect, it } from 'vitest';
import entitiesFixture from '../fixtures/entity.fixture.json' with { type: 'json' };
import { getJwt } from '../helpers/jwt-helper.js';
import { canRetrieve } from '../helpers/rls-runner.js';

const entity = (id) => entitiesFixture.entities.find((entry) => entry.id === id);

describe('ACL scenario: Slack channel outsider', () => {
  it('S-5: actor without channel_id in permission snapshot is denied channel memory', () => {
    expect(canRetrieve(getJwt('ctx-channel-outsider'), entity('ent-channel-memory'))).toMatchObject({
      allow: false,
      reason: 'channel membership missing',
    });
  });
});
