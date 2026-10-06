import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { createMeetingMinutesStore } from '../src/meeting-minutes.js';
import { createFilesystemMeetingMinutesAdapter } from '../src/meeting-minutes-storage.js';
import {
  InMemoryMeetingMinutesExternalSourceRegistry,
  MeetingMinutesStorageController,
} from '../src/meeting-minutes-storage-controller.js';
import { createMeetingMinutesStorageHttpHandler } from '../src/meeting-minutes-storage-http.js';

const context = { principal_id: 'http-owner' };
const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function start(root: string, data: string): Promise<{ base: string; sourceRoot: string; setAllowed: (allowed: boolean) => void }> {
  const sourceRoot = join(root, 'source');
  const dataRoot = join(root, 'data');
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(join(sourceRoot, 'minutes.md'), data, 'utf8');
  let allowed = true;
  const registry = new InMemoryMeetingMinutesExternalSourceRegistry();
  const adapter = createFilesystemMeetingMinutesAdapter({
    root: sourceRoot,
    authorize: async () => ({ allowed }),
  });
  const store = createMeetingMinutesStore({ data_dir: dataRoot });
  const controller = new MeetingMinutesStorageController({
    core: store,
    external_adapters: [{ provider: 'filesystem', adapter }],
    external_registry: registry,
  });
  const handler = createMeetingMinutesStorageHttpHandler({
    store,
    controller,
    resolveContext: () => context,
  });
  const server = createServer((request, response) => {
    void handler(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500).end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not expose a TCP address');
  // The test toggles the adapter ACL by mutating this closure through the
  // returned helper; the handler itself always resolves the trusted context.
  return { base: `http://127.0.0.1:${address.port}`, sourceRoot, setAllowed: (value) => { allowed = value; } };
}

async function request(base: string, path: string, init: RequestInit = {}): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.headers ?? {}),
    },
  });
  return { response, body: await response.json() as Record<string, unknown> };
}

describe('meeting minutes storage HTTP lifecycle', () => {
  test('selects an external source, exposes exact reads, and keeps rebind identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-minutes-storage-http-'));
    roots.push(root);
    const { base, sourceRoot, setAllowed } = await start(root, 'version one');
    const created = await request(base, '/api/meeting-minutes', {
      method: 'POST',
      headers: { 'idempotency-key': 'http-external-create' },
      body: JSON.stringify({
        title: '外部保存会議',
        scheduled_at: '2026-10-06T00:00:00.000Z',
        minutes_title: '議事録',
        placement: { kind: 'external', provider: 'filesystem', locator: 'minutes.md' },
      }),
    });
    expect(created.response.status).toBe(201);
    const meeting = created.body.meeting as Record<string, unknown>;
    const document = (created.body.minutes as Record<string, unknown>[])[0];
    const versionId = document.current_version_id as string;
    const meetingId = meeting.meeting_id as string;
    const minutesId = document.minutes_id as string;
    expect(typeof meetingId).toBe('string');

    const version = await request(base, `/api/meeting-minutes/${meetingId}/minutes/${minutesId}/versions/${versionId}`);
    expect(version.response.status).toBe(200);
    expect(version.body.source_status).toBe('available');
    expect(version.body.body).toBe('version one');
    expect((version.body.capabilities as Record<string, unknown>).read_only).toBe(true);

    await writeFile(join(sourceRoot, 'minutes.md'), 'version two', 'utf8');
    const changed = await request(base, `/api/meeting-minutes/${meetingId}/minutes/${minutesId}`, {
      method: 'POST',
      headers: { 'idempotency-key': 'http-external-save' },
      body: JSON.stringify({
        expected_revision: document.revision,
        placement: { kind: 'external', provider: 'filesystem', locator: 'minutes.md' },
      }),
    });
    expect(changed.response.status).toBe(201);
    const changedDocument = (changed.body.minutes as Record<string, unknown>[]).find((row) => row.minutes_id === minutesId)!;
    expect(changedDocument.minutes_id).toBe(minutesId);
    expect(changedDocument.current_version_id).not.toBe(versionId);

    const old = await request(base, `/api/meeting-minutes/${meetingId}/minutes/${minutesId}/versions/${versionId}`);
    expect(old.response.status).toBe(200);
    expect(old.body.source_status).toBe('historical_unavailable');
    expect(old.body.body).toBeUndefined();

    setAllowed(false);
    const denied = await request(base, `/api/meeting-minutes/${meetingId}/minutes/${minutesId}/versions/${changedDocument.current_version_id}`);
    expect(denied.response.status).toBe(200);
    expect(denied.body.source_status).toBe('denied');
    expect(denied.body.body).toBeUndefined();

    const confirmDenied = await request(base, `/api/meeting-minutes/${meetingId}/minutes/${minutesId}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ version_id: changedDocument.current_version_id, expected_revision: changedDocument.revision }),
    });
    expect(confirmDenied.response.status).toBe(403);
    expect((confirmDenied.body.error as Record<string, unknown>).code).toBe('source_denied');

    setAllowed(true);

    const rebound = await request(base, `/api/meeting-minutes/${meetingId}/minutes/${minutesId}`, {
      method: 'POST',
      headers: { 'idempotency-key': 'http-native-rebind' },
      body: JSON.stringify({ expected_revision: changedDocument.revision, placement: { kind: 'native' } }),
    });
    expect(rebound.response.status).toBe(201);
    const reboundDocument = (rebound.body.minutes as Record<string, unknown>[]).find((row) => row.minutes_id === minutesId)!;
    expect(reboundDocument.minutes_id).toBe(minutesId);
    const native = await request(base, `/api/meeting-minutes/${meetingId}/minutes/${minutesId}/versions/${reboundDocument.current_version_id}`);
    expect(native.body.source_status).toBe('native');
    expect(native.body.body).toBe('version two');
  });
});
