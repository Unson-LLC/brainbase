import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createMeetingMinutesStore,
  meetingMinutesBodyDigest,
  type MeetingMinutesRequestContext,
  type MeetingMinutesResource,
  type MeetingMinutesSnapshot,
  type MeetingMinutesStoragePort,
} from '../src/meeting-minutes.js';
import { createMeetingMinutesHttpHandler } from '../src/meeting-minutes-http.js';

const HOST_CONTEXT: MeetingMinutesRequestContext = { principal_id: 'host-owner' };
const FIXED_NOW = new Date('2026-10-06T00:00:00.000Z');

const EMPTY_SNAPSHOT: MeetingMinutesSnapshot = {
  schema_version: 1,
  revision: 0,
  meetings: [],
  documents: [],
  versions: [],
  idempotency: [],
};

const temporaryDirectories: string[] = [];
const runningServers: Server[] = [];

afterEach(async () => {
  const servers = runningServers.splice(0);
  await Promise.all(servers.map((server) => closeServer(server)));

  const directories = temporaryDirectories.splice(0);
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-meeting-minutes-native-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

type HttpState = {
  allow: boolean;
  principal: string;
};

async function startHttpServer(dataDirectory: string, state: HttpState) {
  const authorizer = {
    can_read: (resource: MeetingMinutesResource, context: MeetingMinutesRequestContext) =>
      state.allow && 'acl' in resource && resource.acl.owner_id === context.principal_id,
    can_write: (resource: MeetingMinutesResource, context: MeetingMinutesRequestContext) =>
      state.allow && 'acl' in resource && resource.acl.owner_id === context.principal_id,
  };
  const store = createMeetingMinutesStore({
    data_dir: dataDirectory,
    now: () => new Date(FIXED_NOW),
    authorizer,
  });
  const handler = createMeetingMinutesHttpHandler({
    store,
    resolveContext: () => ({ principal_id: state.principal }),
  });
  const server = createServer((request, response) => {
    void handler(request, response).then((handled) => {
      if (!handled && !response.writableEnded) {
        response.statusCode = 404;
        response.end();
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  runningServers.push(server);
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
    store,
  };
}

async function stopServer(server: Server): Promise<void> {
  const index = runningServers.indexOf(server);
  if (index >= 0) runningServers.splice(index, 1);
  await closeServer(server);
}

async function httpJson(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: any }> {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await response.text();
  return {
    status: response.status,
    body: text.length === 0 ? undefined : JSON.parse(text),
  };
}

describe('native meeting minutes acceptance', () => {
  it('keeps stable IDs, exact confirmations, immutable versions, and old receipts across correction and restart', async () => {
    const dataDirectory = await temporaryDataDirectory();
    const store = createMeetingMinutesStore({ data_dir: dataDirectory, now: () => new Date(FIXED_NOW) });

    const created = await store.create_meeting(
      {
        title: 'Native lifecycle acceptance',
        participant_ids: ['participant-1'],
        initial_body: 'first draft',
        actor_id: 'json-attacker',
      } as any,
      HOST_CONTEXT,
    );
    const meetingId = created.meeting.meeting_id;
    const firstDocument = created.minutes[0];
    const firstVersion = created.versions[0];
    expect(firstDocument).toBeDefined();
    expect(firstVersion).toBeDefined();
    const minutesId = firstDocument!.minutes_id;

    expect(created.meeting.created_actor_id).toBe(HOST_CONTEXT.principal_id);
    expect(firstVersion.created_actor_id).toBe(HOST_CONTEXT.principal_id);
    expect(firstVersion.body).toBe('first draft');
    expect(firstVersion.body_digest).toBe(meetingMinutesBodyDigest('first draft'));
    expect(firstVersion.confirmation).toBeUndefined();

    const fetched = await store.get_meeting(meetingId, HOST_CONTEXT);
    expect(fetched.meeting.meeting_id).toBe(meetingId);
    expect(fetched.minutes[0].minutes_id).toBe(minutesId);
    expect(fetched.minutes[0].current_version_id).toBe(firstVersion.version_id);
    expect(fetched.versions.map((version) => version.version_id)).toEqual([firstVersion.version_id]);

    const exactVersion = await store.get_version(meetingId, minutesId, firstVersion.version_id, HOST_CONTEXT);
    expect(exactVersion.version_id).toBe(firstVersion.version_id);
    expect(exactVersion.body_digest).toBe(firstVersion.body_digest);

    const confirmed = await store.confirm_version(
      {
        minutes_id: minutesId,
        version_id: firstVersion.version_id,
        expected_revision: firstDocument!.revision,
        actor_id: 'json-attacker',
      } as any,
      HOST_CONTEXT,
    );
    const confirmedVersion = confirmed.versions.find((version) => version.version_id === firstVersion.version_id);
    expect(confirmedVersion?.version_id).toBe(firstVersion.version_id);
    expect(confirmedVersion?.confirmation?.actor_id).toBe(HOST_CONTEXT.principal_id);
    expect(confirmedVersion?.confirmation?.version_id).toBe(firstVersion.version_id);
    expect(confirmedVersion?.body_digest).toBe(firstVersion.body_digest);

    const corrected = await store.save_version(
      {
        minutes_id: minutesId,
        body: 'corrected draft',
        predecessor_version_id: firstVersion.version_id,
        expected_revision: confirmed.minutes[0].revision,
        actor_id: 'json-attacker',
      } as any,
      HOST_CONTEXT,
    );
    const correctedVersion = corrected.versions.find((version) => version.version_id !== firstVersion.version_id);
    expect(correctedVersion).toBeDefined();
    expect(correctedVersion!.version_id).not.toBe(firstVersion.version_id);
    expect(correctedVersion!.predecessor_version_id).toBe(firstVersion.version_id);
    expect(correctedVersion!.body).toBe('corrected draft');
    expect(correctedVersion!.body_digest).toBe(meetingMinutesBodyDigest('corrected draft'));
    expect(correctedVersion!.confirmation).toBeUndefined();
    expect(corrected.minutes[0].current_version_id).toBe(correctedVersion!.version_id);

    const oldReceipt = await store.get_version(meetingId, minutesId, firstVersion.version_id, HOST_CONTEXT);
    expect(oldReceipt.version_id).toBe(firstVersion.version_id);
    expect(oldReceipt.body).toBe(firstVersion.body);
    expect(oldReceipt.body_digest).toBe(firstVersion.body_digest);
    expect(oldReceipt.confirmation).toEqual(confirmedVersion!.confirmation);

    const secondDocument = await store.create_minutes(
      meetingId,
      {
        title: 'Decision log',
        body: 'second document',
        expected_revision: corrected.snapshot_revision,
      },
      HOST_CONTEXT,
    );
    const secondVersion = secondDocument.versions.find((version) => version.minutes_id === secondDocument.minutes[1].minutes_id);
    expect(secondDocument.minutes[1].minutes_id).not.toBe(minutesId);
    expect(secondVersion?.version_id).not.toBe(firstVersion.version_id);

    const recreatedStore = createMeetingMinutesStore({ data_dir: dataDirectory, now: () => new Date(FIXED_NOW) });
    const afterRestart = await recreatedStore.get_meeting(meetingId, HOST_CONTEXT);
    expect(afterRestart.meeting.meeting_id).toBe(meetingId);
    expect(afterRestart.minutes.map((minutes) => minutes.minutes_id).sort()).toEqual(
      [minutesId, secondDocument.minutes[1].minutes_id].sort(),
    );
    const restartedOldReceipt = await recreatedStore.get_version(
      meetingId,
      minutesId,
      firstVersion.version_id,
      HOST_CONTEXT,
    );
    expect(restartedOldReceipt).toEqual(oldReceipt);
    const restartedCorrected = afterRestart.versions.find(
      (version) => version.version_id === correctedVersion!.version_id,
    );
    expect(restartedCorrected?.body).toBe('corrected draft');
    expect(restartedCorrected?.confirmation).toBeUndefined();
  });

  it('allows only one of two stores to win the same document revision CAS', async () => {
    const dataDirectory = await temporaryDataDirectory();
    const leftStore = createMeetingMinutesStore({ data_dir: dataDirectory, now: () => new Date(FIXED_NOW) });
    const rightStore = createMeetingMinutesStore({ data_dir: dataDirectory, now: () => new Date(FIXED_NOW) });
    const created = await leftStore.create_meeting(
      { title: 'CAS meeting', initial_body: 'initial' },
      HOST_CONTEXT,
    );

    const attempts = await Promise.allSettled([
      leftStore.save_version(
        {
          minutes_id: created.minutes[0].minutes_id,
          body: 'left winner',
          expected_revision: created.minutes[0].revision,
        },
        HOST_CONTEXT,
      ),
      rightStore.save_version(
        {
          minutes_id: created.minutes[0].minutes_id,
          body: 'right winner',
          expected_revision: created.minutes[0].revision,
        },
        HOST_CONTEXT,
      ),
    ]);
    const fulfilled = attempts.filter((attempt) => attempt.status === 'fulfilled');
    const rejected = attempts.filter((attempt) => attempt.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'revision_conflict' });

    const afterRace = await leftStore.get_meeting(created.meeting.meeting_id, HOST_CONTEXT);
    const raceBodies = afterRace.versions.map((version) => version.body).filter(Boolean);
    expect(raceBodies).toContain('initial');
    expect(raceBodies.filter((body) => body === 'left winner' || body === 'right winner')).toHaveLength(1);
  });

  it('replays durable HTTP idempotency after restart, rejects changed payloads, and rechecks current ACL', async () => {
    const dataDirectory = await temporaryDataDirectory();
    const state: HttpState = { allow: true, principal: HOST_CONTEXT.principal_id };
    const firstServer = await startHttpServer(dataDirectory, state);
    const idempotencyKey = 'http-native-create-1';
    const payload = {
      title: 'HTTP native meeting',
      initial_body: 'HTTP body',
      actor_id: 'json-attacker',
    };

    const created = await httpJson(firstServer.baseUrl, '/api/meeting-minutes', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    });
    expect(created.status).toBe(201);
    expect(created.body.meeting.created_actor_id).toBe(HOST_CONTEXT.principal_id);
    expect(created.body.versions[0].created_actor_id).toBe(HOST_CONTEXT.principal_id);
    const meetingId = created.body.meeting.meeting_id;

    await stopServer(firstServer.server);
    const restartedServer = await startHttpServer(dataDirectory, state);
    const replay = await httpJson(restartedServer.baseUrl, '/api/meeting-minutes', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    });
    expect(replay.status).toBe(201);
    expect(replay.body.meeting.meeting_id).toBe(meetingId);
    expect(replay.body.versions[0].version_id).toBe(created.body.versions[0].version_id);

    const changedPayload = await httpJson(restartedServer.baseUrl, '/api/meeting-minutes', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ ...payload, title: 'changed payload' }),
    });
    expect(changedPayload.status).toBe(409);
    expect(changedPayload.body.error.code).toBe('idempotency_conflict');

    state.allow = false;
    const revokedReplay = await httpJson(restartedServer.baseUrl, '/api/meeting-minutes', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    });
    expect(revokedReplay.status).toBe(403);
    expect(revokedReplay.body.error.code).toBe('authorization_denied');

    state.allow = true;
    const detail = await httpJson(restartedServer.baseUrl, `/api/meeting-minutes/${meetingId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.meeting.meeting_id).toBe(meetingId);
    expect(detail.body.minutes).toHaveLength(1);
  });

  it('fails closed when the durable write fails or its readback remains stale', async () => {
    const dataDirectory = await temporaryDataDirectory();
    let writes = 0;
    const writeFailureStorage: MeetingMinutesStoragePort = {
      read: async () => EMPTY_SNAPSHOT,
      write: async () => {
        writes += 1;
        throw new Error('simulated disk failure');
      },
    };
    const writeFailureStore = createMeetingMinutesStore({
      data_dir: dataDirectory,
      storage: writeFailureStorage,
      now: () => new Date(FIXED_NOW),
    });
    await expect(
      writeFailureStore.create_meeting({ title: 'must not appear', initial_body: 'body' }, HOST_CONTEXT),
    ).rejects.toMatchObject({ code: 'storage_unavailable' });
    expect(writes).toBe(1);

    let staleWrites = 0;
    const staleReadbackStorage: MeetingMinutesStoragePort = {
      read: async () => EMPTY_SNAPSHOT,
      write: async () => {
        staleWrites += 1;
      },
    };
    const staleReadbackStore = createMeetingMinutesStore({
      data_dir: dataDirectory,
      storage: staleReadbackStorage,
      now: () => new Date(FIXED_NOW),
    });
    await expect(
      staleReadbackStore.create_meeting({ title: 'readback must fail', initial_body: 'body' }, HOST_CONTEXT),
    ).rejects.toMatchObject({ code: 'readback_mismatch' });
    expect(staleWrites).toBe(1);
  });
});
