import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMeetingMinutesHttpHandler } from '../src/meeting-minutes-http.js';
import { createMeetingMinutesStore } from '../src/meeting-minutes.js';

const NOW = () => new Date('2026-10-06T00:00:00.000Z');
const ACTOR = { principal_id: 'self' };

let directories: string[] = [];
let servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function dataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-meeting-minutes-http-'));
  directories.push(directory);
  return directory;
}

async function start(handler: ReturnType<typeof createMeetingMinutesHttpHandler>): Promise<string> {
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
  return `http://127.0.0.1:${address.port}`;
}

async function request(base: string, init: RequestInit & { path?: string } = {}): Promise<{ response: Response; body: Record<string, unknown> }> {
  const { path = '/api/meeting-minutes', ...fetchInit } = init;
  const response = await fetch(`${base}${path}`, {
    ...fetchInit,
    headers: {
      ...(fetchInit.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(fetchInit.headers ?? {})
    }
  });
  return { response, body: await response.json() as Record<string, unknown> };
}

function handlerFor(dataDir: string, authorizer?: { can_read?: () => boolean; can_write?: () => boolean }) {
  const store = createMeetingMinutesStore({ data_dir: dataDir, now: NOW, authorizer });
  return createMeetingMinutesHttpHandler({
    store,
    resolveContext: () => ACTOR
  });
}

describe('meeting minutes HTTP lifecycle', () => {
  it('replays a durable create after handler restart and rejects a changed payload', async () => {
    const dataDir = await dataDirectory();
    const key = 'http-create-1';
    const payload = { title: 'HTTP会議', initial_body: '本文' };
    const firstBase = await start(handlerFor(dataDir));
    const first = await request(firstBase, {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: JSON.stringify(payload)
    });
    expect(first.response.status).toBe(201);
    const firstMeeting = (first.body.meeting as Record<string, unknown>).meeting_id;
    expect(typeof firstMeeting).toBe('string');

    const firstServer = servers.shift()!;
    await new Promise<void>((resolve) => firstServer.close(() => resolve()));
    const restartedBase = await start(handlerFor(dataDir));
    const replay = await request(restartedBase, {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: JSON.stringify(payload)
    });
    expect(replay.response.status).toBe(201);
    expect((replay.body.meeting as Record<string, unknown>).meeting_id).toBe(firstMeeting);

    const mismatch = await request(restartedBase, {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: JSON.stringify({ ...payload, title: '別の会議' })
    });
    expect(mismatch.response.status).toBe(409);
    expect((mismatch.body.error as Record<string, unknown>).code).toBe('idempotency_conflict');
  });

  it('rechecks the current ACL for an idempotent HTTP replay', async () => {
    const dataDir = await dataDirectory();
    let readable = true;
    const authorizer = { can_read: () => readable, can_write: () => true };
    const base = await start(handlerFor(dataDir, authorizer));
    const options = {
      method: 'POST',
      headers: { 'idempotency-key': 'http-acl-1' },
      body: JSON.stringify({ title: '機密会議', initial_body: '機密本文' })
    } as const;
    const first = await request(base, options);
    expect(first.response.status).toBe(201);

    readable = false;
    const replay = await request(base, options);
    expect(replay.response.status).toBe(403);
    expect((replay.body.error as Record<string, unknown>).code).toBe('authorization_denied');
  });

  it('rejects an empty or oversized idempotency key at the HTTP boundary', async () => {
    const dataDir = await dataDirectory();
    const base = await start(handlerFor(dataDir));
    const empty = await request(base, {
      method: 'POST',
      headers: { 'idempotency-key': '   ' },
      body: JSON.stringify({ title: '会議' })
    });
    expect(empty.response.status).toBe(422);
    expect((empty.body.error as Record<string, unknown>).code).toBe('invalid_idempotency_key');

    const oversized = await request(base, {
      method: 'POST',
      headers: { 'idempotency-key': 'x'.repeat(201) },
      body: JSON.stringify({ title: '会議' })
    });
    expect(oversized.response.status).toBe(422);
    expect((oversized.body.error as Record<string, unknown>).code).toBe('invalid_idempotency_key');
  });
});
