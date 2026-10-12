// story-meeting-minutes-withdraw-v1: a published minutes document can be taken back from its readers.
// Nothing is deleted: the versions stay, the document records who withdrew it and when.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createMeetingMinutesStore,
  MEETING_MINUTES_SIDECAR,
  type MeetingMinutesRequestContext,
  type MeetingMinutesResource,
} from '../src/meeting-minutes.js';

const OWNER: MeetingMinutesRequestContext = { principal_id: 'per_owner' };
const OTHER: MeetingMinutesRequestContext = { principal_id: 'per_other' };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function storeWith(writers = new Set(['per_owner'])) {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-minutes-withdraw-'));
  directories.push(dir);
  const authorizer = {
    can_read: () => true,
    can_write: (_resource: MeetingMinutesResource, context: MeetingMinutesRequestContext) => writers.has(context.principal_id),
  };
  let tick = 0;
  const store = createMeetingMinutesStore({ data_dir: dir, authorizer, now: () => new Date(Date.UTC(2026, 9, 12, 0, 0, tick++)) });
  const created = await store.create_meeting({ title: '定例', initial_body: '議事録の本文' }, OWNER);
  return { dir, store, meetingId: created.meeting.meeting_id, document: created.minutes[0] };
}

describe('withdrawing a minutes document (story-meeting-minutes-withdraw-v1)', () => {
  it('records who withdrew it, keeps the versions, and leaves it out of listings but not of the detail', async () => {
    const { store, meetingId, document } = await storeWith();
    const withdrawn = await store.withdraw_minutes({ minutes_id: document.minutes_id, expected_revision: document.revision }, OWNER);
    const saved = withdrawn.minutes.find((entry) => entry.minutes_id === document.minutes_id);
    expect(saved?.withdrawal).toEqual({ actor_id: 'per_owner', withdrawn_at: expect.any(String) });
    expect(withdrawn.versions.map((version) => version.body)).toEqual(['議事録の本文']);
    const [listed] = await store.list_meetings(OWNER);
    expect(listed.meeting.meeting_id).toBe(meetingId);
    expect(listed.minutes).toEqual([]);
    const detail = await store.get_meeting(meetingId, OWNER);
    expect(detail.minutes[0].withdrawal?.actor_id).toBe('per_owner');
  });

  it('refuses a person who cannot write the document', async () => {
    const { store, document } = await storeWith();
    await expect(store.withdraw_minutes({ minutes_id: document.minutes_id, expected_revision: document.revision }, OTHER))
      .rejects.toMatchObject({ code: 'authorization_denied' });
  });

  it('refuses new versions and confirmations of a withdrawn document', async () => {
    const { store, document } = await storeWith();
    const withdrawn = await store.withdraw_minutes({ minutes_id: document.minutes_id, expected_revision: document.revision }, OWNER);
    const current = withdrawn.minutes[0];
    await expect(store.save_version({ minutes_id: current.minutes_id, body: '書き換え', expected_revision: current.revision }, OWNER))
      .rejects.toMatchObject({ code: 'invalid_input' });
    await expect(store.confirm_version({ minutes_id: current.minutes_id, version_id: current.current_version_id, expected_revision: current.revision }, OWNER))
      .rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('keeps the first withdrawal on a repeat, replays a retried key, and rejects a key reused for another request', async () => {
    const { store, document } = await storeWith();
    const first = await store.withdraw_minutes({ minutes_id: document.minutes_id, expected_revision: document.revision, idempotency_key: 'k1', idempotency_fingerprint: 'f1' }, OWNER);
    const firstRecord = first.minutes[0].withdrawal;
    const again = await store.withdraw_minutes({ minutes_id: document.minutes_id, expected_revision: document.revision }, OWNER);
    expect(again.minutes[0].withdrawal).toEqual(firstRecord);
    const replay = await store.withdraw_minutes({ minutes_id: document.minutes_id, expected_revision: document.revision, idempotency_key: 'k1', idempotency_fingerprint: 'f1' }, OWNER);
    expect(replay.minutes[0].withdrawal).toEqual(firstRecord);
    await expect(store.withdraw_minutes({ minutes_id: document.minutes_id, expected_revision: document.revision, idempotency_key: 'k1', idempotency_fingerprint: 'other' }, OWNER))
      .rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('treats a malformed withdrawal on disk as a corrupt record', async () => {
    const { dir, store, document } = await storeWith();
    await store.withdraw_minutes({ minutes_id: document.minutes_id, expected_revision: document.revision }, OWNER);
    const file = join(dir, MEETING_MINUTES_SIDECAR);
    const snapshot = JSON.parse(await readFile(file, 'utf8'));
    snapshot.documents[0].withdrawal = { actor_id: '', withdrawn_at: 'not a date' };
    await writeFile(file, JSON.stringify(snapshot));
    await expect(store.list_meetings(OWNER)).rejects.toMatchObject({ code: 'corrupt_record' });
  });
});
