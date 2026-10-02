import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  JUDGMENT_PROBLEM_SNAPSHOT_VERSION,
  type JudgmentProblemReferenceProvider,
  type JudgmentProblemSnapshot,
} from '../src/judgment-problem-snapshot.js';
import {
  createJudgmentProblemSnapshotHttpHandler,
  type JudgmentProblemSnapshotHttpOptions,
  type TrustedJudgmentProblemSnapshotRequestContext,
} from '../src/judgment-problem-snapshot-http.js';

const servers: HttpServer[] = [];
const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-problem-snapshot-http-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const KINDS = ['objective', 'criterion', 'observation', 'model', 'constraint', 'authority', 'resource', 'deadline'] as const;

function snapshot(overrides: Partial<JudgmentProblemSnapshot> = {}): JudgmentProblemSnapshot {
  return {
    snapshot_version: JUDGMENT_PROBLEM_SNAPSHOT_VERSION,
    problem_id: 'problem-http',
    revision: '1',
    question: 'Which plan should run?',
    owner_scope: { type: 'project', id: 'scope-a' },
    references: KINDS.map((kind, index) => ({
      kind,
      id: `${kind}-a`,
      revision: '1',
      digest: `sha256:${(index + 1).toString(16).padStart(2, '0').repeat(32)}` as `sha256:${string}`,
      scope: { type: 'project', id: 'scope-a' },
      valid_from: '2026-01-01T00:00:00.000Z',
    })),
    read_policy: { ownerId: 'owner-a', visibility: 'private', readerIds: [], writerIds: ['owner-a'] },
    execution_permission: 'none',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const resolvedReferences: JudgmentProblemReferenceProvider = {
  resolve: ({ reference }) => ({ status: 'resolved', digest: reference.digest }),
};

async function listen(
  options: Partial<JudgmentProblemSnapshotHttpOptions> & { root: string },
  context: TrustedJudgmentProblemSnapshotRequestContext | null = { principal: 'owner-a', verifiedMutationOrigin: 'https://host.example.test' },
): Promise<string> {
  const handler = createJudgmentProblemSnapshotHttpHandler({
    providerFactory: () => ({ referenceProvider: resolvedReferences }),
    ...options,
  });
  const server = createHttpServer(async (request, response) => {
    if (!await handler(request, response, context)) {
      response.statusCode = 404;
      response.end('outside');
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  return `http://127.0.0.1:${address.port}`;
}

const post = (base: string, body: unknown, path = '/judgment-problem-snapshots') => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

describe('judgment problem snapshot HTTP handler', () => {
  it('saves a snapshot, returns its receipt, and reads it back by id', async () => {
    const base = await listen({ root: await tempDir() });
    const saved = await post(base, { snapshot: snapshot() });
    expect(saved.status).toBe(201);
    const receipt = (await saved.json()).result;
    expect(receipt).toMatchObject({ problem_id: 'problem-http', revision: '1', status: 'created' });
    expect(receipt.snapshot_id).toMatch(/^sha256:[0-9a-f]{64}$/u);

    const again = await post(base, { snapshot: snapshot() });
    expect(again.status).toBe(200);
    expect((await again.json()).result).toMatchObject({ snapshot_id: receipt.snapshot_id, status: 'existing' });

    const read = await fetch(`${base}/judgment-problem-snapshots/${encodeURIComponent(receipt.snapshot_id)}`);
    expect(read.status).toBe(200);
    expect((await read.json()).result).toMatchObject({ problem_id: 'problem-http', revision: '1', execution_permission: 'none' });
  });

  it('binds the providers to the trusted context, not to the request body', async () => {
    const providerFactory = vi.fn(() => ({ referenceProvider: resolvedReferences }));
    const base = await listen({ root: await tempDir(), providerFactory }, { principal: 'owner-a', verifiedMutationOrigin: 'x' });
    await post(base, { snapshot: snapshot(), principal: 'someone-else' }).then((response) => expect(response.status).toBe(400));
    await post(base, { snapshot: snapshot() });
    expect(providerFactory).toHaveBeenCalledWith({ principal: 'owner-a', verifiedMutationOrigin: 'x' });
  });

  it('requires authentication and a verified mutation origin', async () => {
    const root = await tempDir();
    expect((await post(await listen({ root }, null), { snapshot: snapshot() })).status).toBe(401);
    expect((await post(await listen({ root }, { principal: 'owner-a' }), { snapshot: snapshot() })).status).toBe(403);
    const verified = await listen({ root, verifyMutationRequest: () => true }, { principal: 'owner-a' });
    expect((await post(verified, { snapshot: snapshot() })).status).toBe(201);
  });

  it('refuses a writer outside the read policy and hides a snapshot from another reader', async () => {
    const root = await tempDir();
    const owner = await listen({ root });
    const saved = await (await post(owner, { snapshot: snapshot() })).json();
    const stranger = await listen({ root }, { principal: 'stranger', verifiedMutationOrigin: 'x' });
    expect((await post(stranger, { snapshot: snapshot({ problem_id: 'problem-other' }) })).status).toBe(403);
    const read = await fetch(`${stranger}/judgment-problem-snapshots/${encodeURIComponent(saved.result.snapshot_id)}`);
    expect(read.status).toBe(403);
  });

  it('maps snapshot errors to statuses without saving anything', async () => {
    const base = await listen({ root: await tempDir() });
    const missing = snapshot({ references: snapshot().references.filter((reference) => reference.kind !== 'constraint') });
    const response = await post(base, { snapshot: missing });
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('missing_reference');
    expect((await post(base, '{"snapshot":')).status).toBe(400);
    expect((await post(base, { snapshot: snapshot(), extra: true })).status).toBe(400);
    const unresolved = await listen({
      root: await tempDir(),
      providerFactory: () => ({ referenceProvider: { resolve: () => ({ status: 'missing', message: 'gone' }) } }),
    });
    expect((await post(unresolved, { snapshot: snapshot() })).status).toBe(422);
    const notFound = await fetch(`${base}/judgment-problem-snapshots/${encodeURIComponent(`sha256:${'c'.repeat(64)}`)}`);
    expect(notFound.status).toBe(404);
  });

  it('answers 405 for other methods and leaves other paths to the host', async () => {
    const base = await listen({ root: await tempDir() });
    expect((await fetch(`${base}/judgment-problem-snapshots`, { method: 'DELETE' })).status).toBe(405);
    expect(await (await fetch(`${base}/other`)).text()).toBe('outside');
  });

  it('validates its options', () => {
    expect(() => createJudgmentProblemSnapshotHttpHandler({ root: '', providerFactory: () => ({ referenceProvider: resolvedReferences }) })).toThrow(/root/);
    expect(() => createJudgmentProblemSnapshotHttpHandler({ root: '/tmp/x' } as JudgmentProblemSnapshotHttpOptions)).toThrow(/providerFactory/);
  });
});
