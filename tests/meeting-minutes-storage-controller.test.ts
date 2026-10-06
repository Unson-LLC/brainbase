import { strict as assert } from 'node:assert';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  createFilesystemMeetingMinutesAdapter,
  type MeetingMinutesStorageCapabilities,
} from '../src/meeting-minutes-storage.js';
import {
  InMemoryMeetingMinutesExternalSourceRegistry,
  MeetingMinutesStorageController,
  type MeetingMinutesControllerCorePort,
  type MeetingMinutesControllerCreateMeetingInput,
  type MeetingMinutesControllerDetail,
  type MeetingMinutesControllerRequestContext,
  type MeetingMinutesControllerSaveVersionInput,
  type MeetingMinutesControllerVersionRecord,
  type MeetingMinutesStoragePlacement,
} from '../src/meeting-minutes-storage-controller.js';

const PRINCIPAL = { principal_id: 'principal-owner' } satisfies MeetingMinutesControllerRequestContext;
const tempRoots: string[] = [];

interface MutableMeeting {
  readonly meeting_id: string;
  readonly title: string;
}

interface MutableDocument {
  readonly minutes_id: string;
  readonly meeting_id: string;
  title: string;
  current_version_id: string;
  revision: number;
}

class FakeCore implements MeetingMinutesControllerCorePort {
  private meetingCounter = 0;
  private minutesCounter = 0;
  private versionCounter = 0;
  private aggregateRevision = 0;
  private readonly meetings = new Map<string, MutableMeeting>();
  private readonly documents = new Map<string, MutableDocument>();
  private readonly versions = new Map<string, MeetingMinutesControllerVersionRecord>();

  async create_meeting(input: MeetingMinutesControllerCreateMeetingInput & { initial_body?: string; source_ref?: MeetingMinutesControllerVersionRecord['source_ref'] }, _context: MeetingMinutesControllerRequestContext): Promise<MeetingMinutesControllerDetail> {
    const meeting_id = `meeting_${++this.meetingCounter}`;
    const minutes_id = `minutes_${++this.minutesCounter}`;
    const version_id = `version_${++this.versionCounter}`;
    this.meetings.set(meeting_id, { meeting_id, title: input.title });
    this.documents.set(minutes_id, {
      minutes_id,
      meeting_id,
      title: input.minutes_title ?? '議事録',
      current_version_id: version_id,
      revision: 1,
    });
    this.versions.set(version_id, {
      version_id,
      minutes_id,
      meeting_id,
      ...(input.initial_body === undefined ? {} : { body: input.initial_body }),
      ...(input.source_ref === undefined ? {} : { source_ref: input.source_ref }),
    });
    this.aggregateRevision += 1;
    return this.detail(meeting_id);
  }

  async create_minutes(meeting_id: string, input: { title?: string; metadata?: Readonly<Record<string, unknown>>; expected_revision: number; body?: string; source_ref?: MeetingMinutesControllerVersionRecord['source_ref'] }, _context: MeetingMinutesControllerRequestContext): Promise<MeetingMinutesControllerDetail> {
    if (!this.meetings.has(meeting_id)) throw new Error('not_found');
    const minutes_id = `minutes_${++this.minutesCounter}`;
    const version_id = `version_${++this.versionCounter}`;
    this.documents.set(minutes_id, { minutes_id, meeting_id, title: input.title ?? '議事録', current_version_id: version_id, revision: 1 });
    this.versions.set(version_id, {
      version_id,
      minutes_id,
      meeting_id,
      ...(input.body === undefined ? {} : { body: input.body }),
      ...(input.source_ref === undefined ? {} : { source_ref: input.source_ref }),
    });
    this.aggregateRevision += 1;
    return this.detail(meeting_id);
  }

  async get_meeting(meeting_id: string, _context: MeetingMinutesControllerRequestContext): Promise<MeetingMinutesControllerDetail> {
    if (!this.meetings.has(meeting_id)) throw new Error('not_found');
    return this.detail(meeting_id);
  }

  async get_version(meeting_id: string, minutes_id: string, version_id: string, _context: MeetingMinutesControllerRequestContext): Promise<MeetingMinutesControllerVersionRecord> {
    const version = this.versions.get(version_id);
    if (!version || version.meeting_id !== meeting_id || version.minutes_id !== minutes_id) throw new Error('not_found');
    return { ...version };
  }

  async save_version(input: MeetingMinutesControllerSaveVersionInput & { body?: string; source_ref?: MeetingMinutesControllerVersionRecord['source_ref'] }, _context: MeetingMinutesControllerRequestContext): Promise<MeetingMinutesControllerDetail> {
    const document = this.documents.get(input.minutes_id);
    if (!document) throw new Error('not_found');
    const previous = this.versions.get(document.current_version_id);
    if (!previous) throw new Error('corrupt');
    const version_id = `version_${++this.versionCounter}`;
    this.versions.set(version_id, {
      version_id,
      minutes_id: input.minutes_id,
      meeting_id: document.meeting_id,
      predecessor_version_id: input.predecessor_version_id ?? previous.version_id,
      ...(input.body === undefined ? {} : { body: input.body }),
      ...(input.source_ref === undefined ? {} : { source_ref: input.source_ref }),
    });
    document.current_version_id = version_id;
    document.revision += 1;
    this.aggregateRevision += 1;
    return this.detail(document.meeting_id);
  }

  private detail(meeting_id: string): MeetingMinutesControllerDetail {
    const meeting = this.meetings.get(meeting_id);
    if (!meeting) throw new Error('not_found');
    const minutes = [...this.documents.values()].filter((document) => document.meeting_id === meeting_id).map((document) => ({ ...document }));
    const ids = new Set(minutes.map((document) => document.minutes_id));
    const versions = [...this.versions.values()].filter((version) => ids.has(version.minutes_id)).map((version) => ({ ...version }));
    return {
      meeting,
      minutes,
      versions,
      snapshot_revision: this.aggregateRevision,
    };
  }
}

async function createRoot(files: Record<string, string>) {
  const root = join(tmpdir(), `brainbase-minutes-controller-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(root, { recursive: true });
  for (const [locator, body] of Object.entries(files)) await writeFile(join(root, locator), body, 'utf8');
  tempRoots.push(root);
  return root;
}

function controllerFor(root: string, authorized: () => boolean) {
  const adapter = createFilesystemMeetingMinutesAdapter({
    root,
    authorize: async (context, operation) => ({
      allowed: authorized(),
      reason: `denied ${context.principal_id} ${operation}`,
    }),
  });
  return new MeetingMinutesStorageController({
    core: new FakeCore(),
    external_adapters: [{ provider: 'filesystem', adapter }],
    external_registry: new InMemoryMeetingMinutesExternalSourceRegistry(),
  });
}

const external = (locator = 'minutes.txt'): MeetingMinutesStoragePlacement => ({ kind: 'external', provider: 'filesystem', locator });
const native = (body?: string): MeetingMinutesStoragePlacement => ({
  kind: 'native',
  ...(body === undefined ? {} : { body }),
});

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('MeetingMinutesStorageController', () => {
  test('registers and reads a real file, dedupes re-import, and preserves minutes_id across changed revisions', async () => {
    const root = await createRoot({ 'minutes.txt': 'v1' });
    let allowed = true;
    const controller = controllerFor(root, () => allowed);

    const first = await controller.create_meeting({ title: 'External meeting' }, external(), PRINCIPAL);
    const document = first.minutes[0];
    const firstVersion = first.versions.find((version) => version.version_id === document.current_version_id);
    assert.ok(firstVersion?.source_ref);
    assert.equal(firstVersion.body, undefined);

    const readFirst = await controller.get_version(first.meeting.meeting_id, document.minutes_id, firstVersion.version_id, PRINCIPAL);
    assert.equal(readFirst.source_status, 'available');
    assert.equal(readFirst.body, 'v1');

    await writeFile(join(root, 'minutes.txt'), 'v2', 'utf8');
    const changed = await controller.save_version({ minutes_id: document.minutes_id, expected_revision: document.revision }, external(), PRINCIPAL);
    const changedDocument = changed.minutes.find((candidate) => candidate.minutes_id === document.minutes_id);
    assert.ok(changedDocument);
    assert.equal(changedDocument.minutes_id, document.minutes_id);
    assert.notEqual(changedDocument.current_version_id, document.current_version_id);
    assert.equal(changed.versions.filter((version) => version.minutes_id === document.minutes_id).length, 2);

    const duplicate = await controller.save_version({ minutes_id: document.minutes_id, expected_revision: changedDocument.revision }, external(), PRINCIPAL);
    const duplicateDocument = duplicate.minutes.find((candidate) => candidate.minutes_id === document.minutes_id);
    assert.equal(duplicateDocument?.current_version_id, changedDocument.current_version_id);
    assert.equal(duplicate.versions.filter((version) => version.minutes_id === document.minutes_id).length, 2);

    const oldRead = await controller.get_version(first.meeting.meeting_id, document.minutes_id, firstVersion.version_id, PRINCIPAL);
    assert.equal(oldRead.source_status, 'historical_unavailable');
    assert.equal(oldRead.body, undefined);

    allowed = false;
    const denied = await controller.get_version(first.meeting.meeting_id, document.minutes_id, changedDocument.current_version_id, PRINCIPAL);
    assert.equal(denied.source_status, 'denied');
    assert.equal(denied.body, undefined);

    allowed = true;
    await rm(root, { recursive: true, force: true });
    const disconnected = await controller.get_version(first.meeting.meeting_id, document.minutes_id, changedDocument.current_version_id, PRINCIPAL);
    assert.equal(disconnected.source_status, 'unavailable');
    assert.equal(disconnected.body, undefined);
  });

  test('selects native/external placement and rebinds without changing the core minutes_id', async () => {
    const root = await createRoot({ 'minutes.txt': 'external body' });
    const controller = controllerFor(root, () => true);
    const created = await controller.create_meeting({ title: 'Rebind meeting' }, native('native body'), PRINCIPAL);
    const originalDocument = created.minutes[0];
    const externalVersion = await controller.rebind({
      meeting_id: created.meeting.meeting_id,
      minutes_id: originalDocument.minutes_id,
      expected_revision: originalDocument.revision,
    }, external(), PRINCIPAL);
    const externalDocument = externalVersion.minutes.find((document) => document.minutes_id === originalDocument.minutes_id);
    assert.ok(externalDocument);
    assert.equal(externalDocument.minutes_id, originalDocument.minutes_id);
    const externalCurrent = externalVersion.versions.find((version) => version.version_id === externalDocument.current_version_id);
    assert.equal(externalCurrent?.body, undefined);
    assert.ok(externalCurrent?.source_ref);

    const nativeVersion = await controller.rebind({
      meeting_id: created.meeting.meeting_id,
      minutes_id: originalDocument.minutes_id,
      expected_revision: externalDocument.revision,
    }, native(), PRINCIPAL);
    const nativeDocument = nativeVersion.minutes.find((document) => document.minutes_id === originalDocument.minutes_id);
    assert.equal(nativeDocument?.minutes_id, originalDocument.minutes_id);
    const current = nativeVersion.versions.find((version) => version.version_id === nativeDocument?.current_version_id);
    assert.equal(current?.body, 'external body');
    assert.equal(current?.source_ref, undefined);
  });

  test('returns explicit adapter capability and source state when no adapter can resolve a persisted provider', async () => {
    const fakeCore = new FakeCore();
    const detail = await fakeCore.create_meeting({
      title: 'Unknown provider',
      source_ref: { provider: 'customer-system', locator: 'minutes/1', revision: 'r1', digest: 'd1' },
    }, PRINCIPAL);
    const controller = new MeetingMinutesStorageController({ core: fakeCore });
    const document = detail.minutes[0];
    const version = detail.versions[0];
    const result = await controller.get_version(detail.meeting.meeting_id, document.minutes_id, version.version_id, PRINCIPAL);
    assert.equal(result.placement, 'external');
    assert.equal(result.source_status, 'unavailable');
    expect(result.reason).toMatch(/adapter/i);
    expect(result.body).toBeUndefined();
  });
});

void ({} satisfies MeetingMinutesStorageCapabilities);
