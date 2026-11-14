import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  createMeetingMinutesStore,
  type MeetingMinutesExternalSourceHook,
  type MeetingMinutesSourceRef,
} from '../src/meeting-minutes.js';
import { createFilesystemMeetingMinutesAdapter } from '../src/meeting-minutes-storage.js';
import {
  InMemoryMeetingMinutesExternalSourceRegistry,
  MeetingMinutesStorageController,
  type MeetingMinutesStoragePlacement,
} from '../src/meeting-minutes-storage-controller.js';

const roots: string[] = [];
const context = { principal_id: 'integration-owner' };

async function makeFixture(body = 'version one') {
  const root = join(tmpdir(), `brainbase-minutes-storage-core-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const data = join(root, 'data');
  const sourceRoot = join(root, 'source');
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(join(sourceRoot, 'minutes.md'), body, 'utf8');
  roots.push(root);

  let allowed = true;
  const registry = new InMemoryMeetingMinutesExternalSourceRegistry();
  const adapter = createFilesystemMeetingMinutesAdapter({
    root: sourceRoot,
    authorize: async () => ({ allowed }),
  });
  const coreHook: MeetingMinutesExternalSourceHook = {
    find_existing: (sourceRef: MeetingMinutesSourceRef) => registry.find_existing(sourceRef),
    register: (sourceRef: MeetingMinutesSourceRef, identity) => registry.register(sourceRef, identity),
  };
  const store = createMeetingMinutesStore({ data_dir: data, external_source_hook: coreHook });
  const controller = new MeetingMinutesStorageController({
    core: store,
    external_adapters: [{ provider: 'filesystem', adapter }],
    external_registry: registry,
  });
  const placement: MeetingMinutesStoragePlacement = {
    kind: 'external',
    provider: 'filesystem',
    locator: 'minutes.md',
  };

  return {
    controller,
    placement,
    sourceRoot,
    setAllowed(value: boolean) {
      allowed = value;
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('MeetingMinutesStorageController with the native core store', () => {
  test('registers, reads, re-imports and reports current ACL/history through the real core', async () => {
    const fixture = await makeFixture();
    const first = await fixture.controller.create_meeting(
      {
        title: 'Core integration meeting',
        scheduled_at: '2026-10-06T00:00:00.000Z',
        ended_at: '2026-10-06T01:00:00.000Z',
      },
      fixture.placement,
      context,
    );
    const firstDocument = first.minutes[0];
    expect(firstDocument).toBeDefined();
    const firstVersion = first.versions.find((version) => version.version_id === firstDocument.current_version_id);
    expect(firstVersion?.source_ref?.provenance).toMatchObject({ source: 'external', adapter: 'filesystem' });
    expect(firstVersion?.body).toBeUndefined();

    const firstRead = await fixture.controller.get_version(
      first.meeting.meeting_id,
      firstDocument.minutes_id,
      firstVersion.version_id,
      context,
    );
    expect(firstRead).toMatchObject({ source_status: 'available', body: 'version one' });

    const duplicate = await fixture.controller.save_version(
      { minutes_id: firstDocument.minutes_id, expected_revision: firstDocument.revision },
      fixture.placement,
      context,
    );
    const duplicateDocument = duplicate.minutes.find((document) => document.minutes_id === firstDocument.minutes_id);
    expect(duplicateDocument).toBeDefined();
    expect(duplicateDocument?.current_version_id).toBe(firstDocument.current_version_id);
    expect(duplicate.versions.filter((version) => version.minutes_id === firstDocument.minutes_id)).toHaveLength(1);

    await writeFile(join(fixture.sourceRoot, 'minutes.md'), 'version two', 'utf8');
    const changed = await fixture.controller.save_version(
      { minutes_id: firstDocument.minutes_id, expected_revision: duplicateDocument.revision },
      fixture.placement,
      context,
    );
    const changedDocument = changed.minutes.find((document) => document.minutes_id === firstDocument.minutes_id);
    expect(changedDocument?.minutes_id).toBe(firstDocument.minutes_id);
    expect(changedDocument?.current_version_id).not.toBe(firstDocument.current_version_id);
    expect(changed.versions.filter((version) => version.minutes_id === firstDocument.minutes_id)).toHaveLength(2);

    const oldRead = await fixture.controller.get_version(
      first.meeting.meeting_id,
      firstDocument.minutes_id,
      firstVersion.version_id,
      context,
    );
    expect(oldRead.source_status).toBe('historical_unavailable');
    expect(oldRead.body).toBeUndefined();

    fixture.setAllowed(false);
    const denied = await fixture.controller.get_version(
      first.meeting.meeting_id,
      firstDocument.minutes_id,
      changedDocument.current_version_id,
      context,
    );
    expect(denied.source_status).toBe('denied');
    expect(denied.body).toBeUndefined();

    fixture.setAllowed(true);
    await rm(fixture.sourceRoot, { recursive: true, force: true });
    const disconnected = await fixture.controller.get_version(
      first.meeting.meeting_id,
      firstDocument.minutes_id,
      changedDocument.current_version_id,
      context,
    );
    expect(disconnected.source_status).toBe('unavailable');
    expect(disconnected.body).toBeUndefined();
  });

  test('selects native or external placement while preserving the core minutes_id', async () => {
    const fixture = await makeFixture('external body');
    const native: MeetingMinutesStoragePlacement = { kind: 'native', body: 'native body' };
    const created = await fixture.controller.create_meeting({
      title: 'Rebind meeting',
      scheduled_at: '2026-10-06T02:00:00.000Z',
      ended_at: '2026-10-06T03:00:00.000Z',
    }, native, context);
    const originalDocument = created.minutes[0];

    const external = await fixture.controller.rebind(
      {
        meeting_id: created.meeting.meeting_id,
        minutes_id: originalDocument.minutes_id,
        expected_revision: originalDocument.revision,
      },
      fixture.placement,
      context,
    );
    const externalDocument = external.minutes.find((document) => document.minutes_id === originalDocument.minutes_id);
    expect(externalDocument?.minutes_id).toBe(originalDocument.minutes_id);
    const externalVersion = external.versions.find((version) => version.version_id === externalDocument?.current_version_id);
    expect(externalVersion?.body).toBeUndefined();
    expect(externalVersion?.source_ref?.provider).toBe('filesystem');

    const reboundNative = await fixture.controller.rebind(
      {
        meeting_id: created.meeting.meeting_id,
        minutes_id: originalDocument.minutes_id,
        expected_revision: externalDocument.revision,
      },
      { kind: 'native' },
      context,
    );
    const nativeDocument = reboundNative.minutes.find((document) => document.minutes_id === originalDocument.minutes_id);
    const nativeVersion = reboundNative.versions.find((version) => version.version_id === nativeDocument?.current_version_id);
    expect(nativeDocument?.minutes_id).toBe(originalDocument.minutes_id);
    expect(nativeVersion?.body).toBe('external body');
    expect(nativeVersion?.source_ref).toBeUndefined();
  });
});
