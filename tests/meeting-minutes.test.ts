import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMeetingMinutesStorage,
  createMeetingMinutesStore,
  createMeetingMinutesVersionPort,
  meetingMinutesBodyDigest,
  MeetingMinutesError,
  type MeetingMinutesResource,
  type MeetingMinutesSnapshot
} from '../src/meeting-minutes.js';

const ACTOR = { principal_id: 'self' };
const NOW = () => new Date('2026-10-06T00:00:00.000Z');

let directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function dataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-meeting-minutes-'));
  directories.push(directory);
  return directory;
}

function store(dataDir: string, options: Parameters<typeof createMeetingMinutesStore>[0] = {}) {
  return createMeetingMinutesStore({ data_dir: dataDir, now: NOW, ...options });
}

describe('native meeting minutes lifecycle', () => {
  it('creates one meeting with multiple immutable documents and confirms an exact version', async () => {
    const dataDir = await dataDirectory();
    const minutes = store(dataDir);
    const meeting = await minutes.create_meeting({ title: '週次定例', initial_body: '最初の議事録' }, ACTOR);
    expect(meeting.meeting.title).toBe('週次定例');
    expect(meeting.minutes).toHaveLength(1);
    expect(meeting.minutes[0]?.current_version_id).toBe(meeting.versions[0]?.version_id);
    expect(meeting.versions[0]).toMatchObject({ body: '最初の議事録', body_digest: meetingMinutesBodyDigest('最初の議事録') });

    const second = await minutes.create_minutes(meeting.meeting.meeting_id, {
      title: '決定事項', body: '決定事項を分けて保存', expected_revision: meeting.snapshot_revision
    }, ACTOR);
    expect(second.minutes).toHaveLength(2);
    expect(new Set(second.minutes.map((document) => document.minutes_id)).size).toBe(2);

    const firstDocument = second.minutes[0]!;
    const corrected = await minutes.save_version({
      minutes_id: firstDocument.minutes_id,
      body: '訂正版',
      expected_revision: firstDocument.revision
    }, ACTOR);
    const correctedDocument = corrected.minutes.find((document) => document.minutes_id === firstDocument.minutes_id)!;
    const correctedVersion = corrected.versions.find((version) => version.version_id === correctedDocument.current_version_id)!;
    expect(correctedVersion).toMatchObject({ body: '訂正版', predecessor_version_id: firstDocument.current_version_id });
    expect(correctedVersion.version_id).not.toBe(firstDocument.current_version_id);

    const confirmed = await minutes.confirm_version({
      minutes_id: correctedDocument.minutes_id,
      version_id: correctedVersion.version_id,
      expected_revision: correctedDocument.revision
    }, ACTOR);
    const saved = confirmed.versions.find((version) => version.version_id === correctedVersion.version_id)!;
    expect(saved.confirmation).toMatchObject({ version_id: correctedVersion.version_id, actor_id: 'self', confirmed_at: NOW().toISOString() });
    expect((await minutes.get_version(meeting.meeting.meeting_id, correctedDocument.minutes_id, correctedVersion.version_id, ACTOR)).body).toBe('訂正版');
  });

  it('keeps an external source reference as the immutable content union and deduplicates by exact identity', async () => {
    const dataDir = await dataDirectory();
    const minutes = store(dataDir);
    const source = {
      provider: 'google-drive',
      locator: 'file-123',
      revision: '42',
      digest: 'sha256:external-42',
      provenance: { providerKind: 'drive', providerId: 'file-123', revision: '42', digest: 'sha256:external-42' }
    } as const;
    const created = await minutes.create_meeting({ title: '外部議事録', source_ref: source }, ACTOR);
    expect(created.versions[0]).toMatchObject({ source_ref: source });
    expect(created.versions[0]).not.toHaveProperty('body');
    await expect(minutes.create_meeting({ title: '重複', source_ref: source }, ACTOR)).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('replays a durable idempotency receipt after a new store instance and rejects a changed payload', async () => {
    const dataDir = await dataDirectory();
    const input = { title: '冪等な会議', initial_body: '一度だけ保存', idempotency_key: 'meeting-1', idempotency_fingerprint: 'fp-1' };
    const first = await store(dataDir).create_meeting(input, ACTOR);
    const replay = await store(dataDir).create_meeting(input, ACTOR);
    expect(replay.meeting.meeting_id).toBe(first.meeting.meeting_id);
    expect(replay.minutes[0]?.current_version_id).toBe(first.minutes[0]?.current_version_id);
    await expect(store(dataDir).create_meeting({ ...input, title: '別の会議', idempotency_fingerprint: 'fp-2' }, ACTOR))
      .rejects.toMatchObject({ code: 'idempotency_conflict' });
    const snapshot = await createMeetingMinutesStorage(dataDir).read();
    expect(snapshot.meetings).toHaveLength(1);
    expect(snapshot.idempotency).toHaveLength(1);
  });

  it('rechecks current ACL on idempotency replay instead of treating the receipt as authority', async () => {
    const dataDir = await dataDirectory();
    let readable = true;
    const authorizer = {
      can_read: () => readable,
      can_write: () => true
    };
    const input = { title: '権限再確認', initial_body: '秘密', idempotency_key: 'acl-1', idempotency_fingerprint: 'fp-acl' };
    const first = await createMeetingMinutesStore({ data_dir: dataDir, now: NOW, authorizer }).create_meeting(input, ACTOR);
    expect(first.meeting.meeting_id).toBeTruthy();
    readable = false;
    await expect(createMeetingMinutesStore({ data_dir: dataDir, now: NOW, authorizer }).create_meeting(input, ACTOR))
      .rejects.toMatchObject({ code: 'authorization_denied' });
  });

  it('fails closed for a partial authorizer and does not return a detail when an old version is denied', async () => {
    const dataDir = await dataDirectory();
    await expect(createMeetingMinutesStore({
      data_dir: dataDir,
      now: NOW,
      authorizer: { can_read: () => true },
    }).create_meeting({ title: '書込み拒否', initial_body: '本文' }, ACTOR))
      .rejects.toMatchObject({ code: 'authorization_denied' });

    let deniedVersionId: string | undefined;
    const authorizer = {
      can_read: (resource: MeetingMinutesResource) => !('version_id' in resource) || resource.version_id !== deniedVersionId,
      can_write: () => true,
    };
    const minutes = createMeetingMinutesStore({ data_dir: dataDir, now: NOW, authorizer });
    const created = await minutes.create_meeting({ title: '版単位の読取り', initial_body: '初版' }, ACTOR);
    const firstVersion = created.versions[0]!;
    const updated = await minutes.save_version({
      minutes_id: created.minutes[0]!.minutes_id,
      body: '訂正版',
      expected_revision: created.minutes[0]!.revision,
    }, ACTOR);
    deniedVersionId = firstVersion.version_id;
    await expect(minutes.get_meeting(created.meeting.meeting_id, ACTOR))
      .rejects.toMatchObject({ code: 'authorization_denied' });
    deniedVersionId = undefined;
    await expect(minutes.get_meeting(created.meeting.meeting_id, ACTOR)).resolves.toMatchObject({
      versions: expect.arrayContaining([
        expect.objectContaining({ version_id: updated.minutes[0]!.current_version_id }),
      ]),
    });
  });

  it('allows only one canonical record when two store instances retry the same key concurrently', async () => {
    const dataDir = await dataDirectory();
    const input = { title: '同時再試行', initial_body: '本文', idempotency_key: 'concurrent-1', idempotency_fingerprint: 'fp-concurrent' };
    const [left, right] = await Promise.all([
      store(dataDir).create_meeting(input, ACTOR),
      store(dataDir).create_meeting(input, ACTOR)
    ]);
    expect(left.meeting.meeting_id).toBe(right.meeting.meeting_id);
    expect((await createMeetingMinutesStorage(dataDir).read()).meetings).toHaveLength(1);
    expect((await createMeetingMinutesStorage(dataDir).read()).idempotency).toHaveLength(1);
  });

  it('adapts exact native and external versions while applying current ACL on every read', async () => {
    const dataDir = await dataDirectory();
    const minutes = store(dataDir);
    const created = await minutes.create_meeting({ title: '正本参照', initial_body: '参照本文' }, ACTOR);
    const version = created.versions[0]!;
    const port = createMeetingMinutesVersionPort(minutes);
    const reference = {
      meetingId: created.meeting.meeting_id,
      minutesId: created.minutes[0]!.minutes_id,
      versionId: version.version_id,
      contentDigest: version.body_digest!,
      locator: 'native',
      provenance: { providerKind: 'native', providerId: 'brainbase', revision: '1', digest: version.body_digest! }
    };
    await expect(port.readExact(reference, { principal: 'self' })).resolves.toEqual({ reference });
    await expect(port.readExact({ ...reference, contentDigest: 'sha256:wrong' }, { principal: 'self' })).resolves.toBeNull();
  });

  it('rejects cross-document, cyclic, and orphan predecessor/version links', async () => {
    const dataDir = await dataDirectory();
    const minutes = store(dataDir);
    const created = await minutes.create_meeting({ title: '不正な版リンク', initial_body: '会議本文' }, ACTOR);
    const firstDocument = created.minutes[0]!;
    const withSecond = await minutes.create_minutes(created.meeting.meeting_id, {
      title: '別文書', body: '別文書本文', expected_revision: created.snapshot_revision
    }, ACTOR);
    const secondDocument = withSecond.minutes.find((candidate) => candidate.minutes_id !== firstDocument.minutes_id)!;
    const withCorrection = await minutes.save_version({
      minutes_id: firstDocument.minutes_id,
      body: '訂正版',
      expected_revision: firstDocument.revision,
    }, ACTOR);
    const snapshot = await createMeetingMinutesStorage(dataDir).read();
    const firstVersion = snapshot.versions.find((version) => version.minutes_id === firstDocument.minutes_id && version.predecessor_version_id === undefined)!;
    const correctedVersion = snapshot.versions.find((version) => version.version_id === withCorrection.minutes.find((candidate) => candidate.minutes_id === firstDocument.minutes_id)!.current_version_id)!;
    const secondVersion = snapshot.versions.find((version) => version.minutes_id === secondDocument.minutes_id)!;
    const storage = createMeetingMinutesStorage(dataDir);
    const invalidSnapshot = (mutate: (value: any) => void) => {
      const value = JSON.parse(JSON.stringify(snapshot));
      mutate(value);
      value.revision = snapshot.revision + 1;
      return expect(storage.write(value, snapshot.revision)).rejects.toMatchObject({ code: 'corrupt_record' });
    };

    await invalidSnapshot((value) => {
      value.versions.find((version: any) => version.version_id === secondVersion.version_id).predecessor_version_id = firstVersion.version_id;
    });
    await invalidSnapshot((value) => {
      value.versions.find((version: any) => version.version_id === firstVersion.version_id).predecessor_version_id = correctedVersion.version_id;
      value.versions.find((version: any) => version.version_id === correctedVersion.version_id).predecessor_version_id = firstVersion.version_id;
    });
    await invalidSnapshot((value) => {
      value.versions.push({
        version_id: 'version_orphan',
        minutes_id: firstDocument.minutes_id,
        meeting_id: created.meeting.meeting_id,
        body: '孤立した版',
        body_digest: meetingMinutesBodyDigest('孤立した版'),
        created_at: NOW().toISOString(),
        created_actor_id: 'self',
      });
    });
  });
});

describe('meeting minutes storage locking', () => {
  it('does not steal an expired-looking lock owned by a live process', async () => {
    const dataDir = await dataDirectory();
    const lockPath = join(dataDir, 'meeting-minutes.json.lock');
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, 'owner'), JSON.stringify({ token: 'live-owner', pid: process.pid, hostname: hostname() }));
    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);
    const snapshot: MeetingMinutesSnapshot = { schema_version: 1, revision: 1, meetings: [], documents: [], versions: [], idempotency: [] };
    await expect(createMeetingMinutesStorage(dataDir).write(snapshot, 0)).rejects.toMatchObject({ code: 'storage_unavailable' });
    const owner = await readFile(join(lockPath, 'owner'), 'utf8');
    expect(owner).toContain('live-owner');
  }, 7_000);
});
