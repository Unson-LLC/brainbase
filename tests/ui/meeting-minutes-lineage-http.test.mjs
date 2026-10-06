import { strict as assert } from 'node:assert';
import { test } from 'vitest';

import { createMeetingMinutesLineageHttpActions } from '../../ui/meeting-minutes-lineage-http.js';

const reference = {
  meetingId: 'meeting-1',
  minutesId: 'minutes-1',
  versionId: 'version-1',
  contentDigest: 'sha256:minutes-1',
  locator: 'meeting-1/minutes-1/version-1',
  provenance: {
    providerKind: 'brainbase.native',
    providerId: 'meeting-1/minutes-1',
    revision: 'version-1',
    digest: 'sha256:minutes-1',
  },
};

test('keeps lineage mutation identifiers stable across a browser retry', async () => {
  const requests = [];
  let idCalls = 0;
  let keyCalls = 0;
  const actions = createMeetingMinutesLineageHttpActions({
    reference,
    token: 'launch-token',
    idFor: () => { idCalls += 1; return 'candidate-create-operation'; },
    idempotencyKeyFor: () => { keyCalls += 1; return 'candidate-create-key'; },
    fetcher: async (path, init) => {
      requests.push({ path, init });
      return { ok: true, status: 201, json: async () => ({ id: 'candidate-1' }) };
    },
  });
  const input = { kind: 'task', proposal: { task: { title: '次回会議の準備' } } };
  await actions.actions.createCandidate(input);
  await actions.actions.createCandidate(input);

  assert.equal(requests.length, 2);
  assert.equal(idCalls, 1);
  assert.equal(keyCalls, 1);
  assert.equal(requests[0].path, '/api/meeting-minutes-lineage/candidates');
  assert.equal(requests[1].path, requests[0].path);
  assert.equal(requests[0].init.headers['X-Brainbase-Review-Token'], 'launch-token');
  const first = JSON.parse(requests[0].init.body);
  const second = JSON.parse(requests[1].init.body);
  assert.equal(first.id, 'candidate-create-operation');
  assert.equal(second.id, first.id);
  assert.equal(first.idempotencyKey, 'candidate-create-key');
  assert.equal(second.idempotencyKey, first.idempotencyKey);
  assert.deepEqual(first.evidence, reference);
  assert.deepEqual(first.actor, { type: 'person', id: 'browser-ui' });
});
