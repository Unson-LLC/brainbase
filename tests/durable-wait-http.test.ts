import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DurableWaitStore } from '../src/durable-waits.js';
import {
  createDurableWaitHttpHandler,
  createDurableWaitHttpHost,
  type DurableWaitHttpHandler,
  type TrustedDurableWaitRequestContext,
} from '../src/durable-wait-http.js';

const servers: HttpServer[] = [];
const roots: string[] = [];
const snapshotId = `sha256:${'a'.repeat(64)}`;

function context(overrides: Partial<TrustedDurableWaitRequestContext> = {}): TrustedDurableWaitRequestContext {
  return {
    tenantId: 'tenant-a',
    principal: 'owner',
    scopeId: 'org-1',
    scopeType: 'organization',
    verifiedMutationOrigin: 'https://mana.example.test',
    ...overrides,
  };
}

async function start(
  handler: DurableWaitHttpHandler,
  contexts: Record<string, TrustedDurableWaitRequestContext | null> = { default: context() },
): Promise<string> {
  const server = createHttpServer((request, response) => {
    const key = request.headers['x-test-context'];
    const contextKey = Array.isArray(key) ? key[0] : key;
    void handler(request, response, contexts[contextKey ?? 'default'] ?? null);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function startCanonicalHost(
  storeFactory: Parameters<typeof createDurableWaitHttpHost>[0]['storeFactory'],
  contexts: Record<string, TrustedDurableWaitRequestContext | null> = { default: context() },
): Promise<string> {
  const server = createDurableWaitHttpHost({
    storeFactory,
    resolveContext: async (request) => {
      const key = request.headers['x-test-context'];
      const contextKey = Array.isArray(key) ? key[0] : key;
      return contexts[contextKey ?? 'default'] ?? null;
    },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function request(
  baseUrl: string,
  path: string,
  init: { method: string; body?: unknown; headers?: Record<string, string> },
): Promise<{ response: Response; body: Record<string, any> | undefined }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method,
    headers: {
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers ?? {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) as Record<string, any> : undefined };
}

function createBody(waitId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    wait_id: waitId,
    owner_scope: { type: 'organization', id: 'org-1' },
    read_policy: { ownerId: 'owner', visibility: 'private', readerIds: ['owner'], writerIds: [] },
    problem_snapshot: { snapshot_id: snapshotId, problem_id: 'problem-1', revision: '1' },
    condition: { event: { event_type: 'evidence.received', event_id: 'event-1' } },
    responsible: { principal: 'owner', scope: 'org-1' },
    resume_method: 'resume_run',
    failure_policy: 'reconciliation_wait',
    run_ref: { run_id: `run-${waitId}`, node_id: 'wait-node' },
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  })));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('durable wait canonical HTTP adapter', () => {
  it('exposes scoped due candidates without accepting query identity or claiming them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-durable-wait-http-due-'));
    roots.push(root);
    const store = new DurableWaitStore({
      dataDir: root,
      clock: () => new Date('2026-09-24T00:00:00.000Z'),
      problemSnapshot: { verify: () => true },
    });
    const baseUrl = await start(createDurableWaitHttpHandler({ storeFactory: () => store }), {
      default: context(),
      otherScope: context({ scopeId: 'org-2' }),
      otherType: context({ scopeType: 'project' }),
      otherTenant: context({ tenantId: 'tenant-b' }),
      missingType: context({ scopeType: undefined }),
      anonymous: null,
    });
    for (const waitId of ['due-a', 'due-b']) {
      const created = await request(baseUrl, '/api/v1/durable-waits/create', {
        method: 'POST',
        body: createBody(waitId, { deadline: { due_at: '2026-09-23T00:00:00.000Z' } }),
      });
      expect(created.response.status).toBe(200);
    }
    const otherTenantCreated = await request(baseUrl, '/api/v1/durable-waits/create', {
      method: 'POST',
      headers: { 'x-test-context': 'otherTenant' },
      body: createBody('due-other-tenant', { deadline: { due_at: '2026-09-23T00:00:00.000Z' } }),
    });
    expect(otherTenantCreated.response.status).toBe(200);
    const first = await request(baseUrl, '/api/v1/durable-waits:due?limit=1', { method: 'GET' });
    expect(first.response.status).toBe(200);
    expect(first.body?.result?.candidates).toEqual([{ wait_id: 'due-a', due_at: '2026-09-23T00:00:00.000Z' }]);
    expect(first.body?.result?.next_cursor).toBeTruthy();
    const second = await request(baseUrl, `/api/v1/durable-waits:due?limit=1&cursor=${first.body?.result?.next_cursor}`, { method: 'GET' });
    expect(second.body?.result?.candidates.map((candidate: { wait_id: string }) => candidate.wait_id)).toEqual(['due-b']);
    const crossScope = await request(baseUrl, '/api/v1/durable-waits:due', { method: 'GET', headers: { 'x-test-context': 'otherScope' } });
    expect(crossScope.body?.result?.candidates).toEqual([]);
    const crossType = await request(baseUrl, '/api/v1/durable-waits:due', { method: 'GET', headers: { 'x-test-context': 'otherType' } });
    expect(crossType.body?.result?.candidates).toEqual([]);
    const crossTypeRead = await request(baseUrl, '/api/v1/durable-waits/due-a', { method: 'GET', headers: { 'x-test-context': 'otherType' } });
    expect(crossTypeRead.response.status).toBe(403);
    const crossTypeClaim = await request(baseUrl, '/api/v1/durable-waits/claim', {
      method: 'POST', headers: { 'x-test-context': 'otherType' },
      body: { wait_id: 'due-a', request_id: 'cross-scope-type', trigger: 'manual' },
    });
    expect(crossTypeClaim.response.status).toBe(403);
    const missingType = await request(baseUrl, '/api/v1/durable-waits:due', { method: 'GET', headers: { 'x-test-context': 'missingType' } });
    expect(missingType.response.status).toBe(400);
    const missingTypeRead = await request(baseUrl, '/api/v1/durable-waits/due-a', { method: 'GET', headers: { 'x-test-context': 'missingType' } });
    expect(missingTypeRead.response.status).toBe(403);
    const wrongTypeCreate = await request(baseUrl, '/api/v1/durable-waits/create', {
      method: 'POST', headers: { 'x-test-context': 'otherType' }, body: createBody('wrong-scope-type'),
    });
    expect(wrongTypeCreate.response.status).toBe(400);
    await expect(store.read({ wait_id: 'wrong-scope-type', principal: 'owner' })).rejects.toMatchObject({ code: 'not_found' });
    const crossTenant = await request(baseUrl, '/api/v1/durable-waits:due', { method: 'GET', headers: { 'x-test-context': 'otherTenant' } });
    expect(crossTenant.body?.result?.candidates.map((candidate: { wait_id: string }) => candidate.wait_id)).toEqual(['due-other-tenant']);
    const reusedCursor = await request(baseUrl, `/api/v1/durable-waits:due?cursor=${first.body?.result?.next_cursor}`, {
      method: 'GET', headers: { 'x-test-context': 'otherTenant' },
    });
    expect(reusedCursor.response.status).toBe(400);
    const crossTenantRead = await request(baseUrl, '/api/v1/durable-waits/due-a', { method: 'GET', headers: { 'x-test-context': 'otherTenant' } });
    expect(crossTenantRead.response.status).toBe(403);
    const crossTenantClaim = await request(baseUrl, '/api/v1/durable-waits/claim', {
      method: 'POST', headers: { 'x-test-context': 'otherTenant' },
      body: { wait_id: 'due-a', request_id: 'cross-tenant', trigger: 'timer' },
    });
    expect(crossTenantClaim.response.status).toBe(403);
    const anonymous = await request(baseUrl, '/api/v1/durable-waits:due', { method: 'GET', headers: { 'x-test-context': 'anonymous' } });
    expect(anonymous.response.status).toBe(401);
    const queryIdentity = await request(baseUrl, '/api/v1/durable-waits:due?tenantId=tenant-b', { method: 'GET' });
    expect(queryIdentity.response.status).toBe(400);
    const duplicateLimit = await request(baseUrl, '/api/v1/durable-waits:due?limit=1&limit=2', { method: 'GET' });
    expect(duplicateLimit.response.status).toBe(400);
    const read = await request(baseUrl, '/api/v1/durable-waits/due-a', { method: 'GET' });
    expect(read.body?.result?.state).toBe('waiting');
    const reservedId = await request(baseUrl, '/api/v1/durable-waits/create', { method: 'POST', body: createBody('due') });
    expect(reservedId.response.status).toBe(200);
    const readReservedId = await request(baseUrl, '/api/v1/durable-waits/due', { method: 'GET' });
    expect(readReservedId.body?.result?.wait_id).toBe('due');
  });

  it('mounts a trusted host around the real store and returns a bounded route response', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-durable-wait-http-host-'));
    roots.push(root);
    const baseUrl = await startCanonicalHost(() => new DurableWaitStore({
      dataDir: root,
      problemSnapshot: { verify: () => true },
    }));

    const created = await request(baseUrl, '/api/v1/durable-waits/create', {
      method: 'POST',
      body: createBody('wait-host-1'),
    });
    expect(created.response.status).toBe(200);

    const read = await request(baseUrl, '/api/v1/durable-waits/wait-host-1', { method: 'GET' });
    expect(read.response.status).toBe(200);
    expect(read.body?.result?.wait_id).toBe('wait-host-1');

    const unknown = await request(baseUrl, '/health', { method: 'GET' });
    expect(unknown.response.status).toBe(404);
    expect(unknown.body?.error?.code).toBe('not_found');
  });

  it('fails closed when the host cannot resolve an authenticated context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-durable-wait-http-host-auth-'));
    roots.push(root);
    const baseUrl = await startCanonicalHost(
      () => new DurableWaitStore({ dataDir: root, problemSnapshot: { verify: () => true } }),
      { default: null },
    );

    const response = await request(baseUrl, '/api/v1/durable-waits/create', {
      method: 'POST',
      body: createBody('wait-host-unauthenticated'),
    });
    expect(response.response.status).toBe(401);
    expect(response.body?.error?.code).toBe('unauthorized');
  });

  it('uses the real store for create, read, claim and idempotent resume across a new store instance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-durable-wait-http-'));
    roots.push(root);
    const options = {
      dataDir: root,
      problemSnapshot: { verify: () => true },
      defaultLeaseMs: 1000,
    } as const;
    const handler = createDurableWaitHttpHandler({
      storeFactory: () => new DurableWaitStore(options),
    });
    const baseUrl = await start(handler);

    const created = await request(baseUrl, '/api/v1/durable-waits/create', {
      method: 'POST',
      body: createBody('wait-http-1'),
    });
    expect(created.response.status).toBe(200);
    expect(created.body?.store_version).toBe('durable-wait.v1');
    expect(created.body?.result?.state).toBe('waiting');

    const read = await request(baseUrl, '/api/v1/durable-waits/wait-http-1', { method: 'GET' });
    expect(read.response.status).toBe(200);
    expect(read.body?.result?.problem_snapshot).toEqual({
      snapshot_id: snapshotId,
      problem_id: 'problem-1',
      revision: '1',
    });

    const claimBody = {
      wait_id: 'wait-http-1',
      request_id: 'operation-http-1',
      trigger: 'event',
      event_type: 'evidence.received',
      event_id: 'event-1',
    };
    const claim = await request(baseUrl, '/api/v1/durable-waits/claim', {
      method: 'POST',
      body: claimBody,
    });
    expect(claim.response.status).toBe(200);
    expect(claim.body?.result?.claimed_by_this_request).toBe(true);

    const retryClaim = await request(baseUrl, '/api/v1/durable-waits/claim', {
      method: 'POST',
      body: claimBody,
    });
    expect(retryClaim.response.status).toBe(200);
    expect(retryClaim.body?.result?.duplicate).toBe(true);
    expect(retryClaim.body?.result?.claim?.claim_id).toBe(claim.body?.result?.claim?.claim_id);

    const resumeBody = {
      wait_id: 'wait-http-1',
      request_id: 'operation-http-1',
      claim_id: claim.body?.result?.claim?.claim_id,
      lease_id: claim.body?.result?.claim?.lease?.lease_id,
      lease_token: claim.body?.result?.claim?.lease?.token,
    };
    const resumed = await request(baseUrl, '/api/v1/durable-waits/resume', {
      method: 'POST',
      body: resumeBody,
    });
    expect(resumed.response.status).toBe(200);
    const resumedAgain = await request(baseUrl, '/api/v1/durable-waits/resume', {
      method: 'POST',
      body: resumeBody,
    });
    expect(resumedAgain.response.status).toBe(200);
    expect(resumedAgain.body?.result).toEqual(resumed.body?.result);

    const readAfterRestart = await request(baseUrl, '/api/v1/durable-waits/wait-http-1', { method: 'GET' });
    expect(readAfterRestart.body?.result?.state).toBe('resumed');
    expect(readAfterRestart.body?.result?.resume_receipt?.resume_id).toBe(resumed.body?.result?.resume_id);
  });

  it('records unknown external effects and refuses to report a resume success', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-durable-wait-http-unknown-'));
    roots.push(root);
    const handler = createDurableWaitHttpHandler({
      storeFactory: () => new DurableWaitStore({ dataDir: root, problemSnapshot: { verify: () => true } }),
    });
    const baseUrl = await start(handler);
    const created = await request(baseUrl, '/api/v1/durable-waits/create', {
      method: 'POST',
      body: createBody('wait-unknown'),
    });
    expect(created.response.status).toBe(200);

    const unknown = await request(baseUrl, '/api/v1/durable-waits/effect-unknown', {
      method: 'POST',
      body: { wait_id: 'wait-unknown', reason: 'external effect response was lost' },
    });
    expect(unknown.response.status).toBe(200);
    expect(unknown.body?.result?.state).toBe('reconciliation_wait');

    const claim = await request(baseUrl, '/api/v1/durable-waits/claim', {
      method: 'POST',
      body: {
        wait_id: 'wait-unknown', request_id: 'operation-after-unknown', trigger: 'manual',
      },
    });
    expect(claim.response.status).toBe(409);
    expect(claim.body?.error?.code).toBe('reconciliation_required');
  });

  it('fails closed for body identity, current scope, ACL, and mutation-origin violations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-durable-wait-http-acl-'));
    roots.push(root);
    const storeFactory = () => new DurableWaitStore({ dataDir: root, problemSnapshot: { verify: () => true } });
    const handler = createDurableWaitHttpHandler({ storeFactory });
    const baseUrl = await start(handler, {
      default: context(),
      otherScope: context({ scopeId: 'org-2' }),
      otherPrincipal: context({ principal: 'reader-without-access' }),
      unverified: context({ verifiedMutationOrigin: undefined }),
    });

    const wrongBodyTenant = await request(baseUrl, '/api/v1/durable-waits/create', {
      method: 'POST',
      body: { ...createBody('wait-wrong-body'), tenantId: 'tenant-b' },
    });
    expect(wrongBodyTenant.response.status).toBe(400);
    expect(wrongBodyTenant.body?.error?.code).toBe('invalid_request');

    const created = await request(baseUrl, '/api/v1/durable-waits/create', {
      method: 'POST',
      body: createBody('wait-acl'),
    });
    expect(created.response.status).toBe(200);

    const crossScope = await request(baseUrl, '/api/v1/durable-waits/wait-acl', {
      method: 'GET', headers: { 'x-test-context': 'otherScope' },
    });
    expect(crossScope.response.status).toBe(403);

    const denied = await request(baseUrl, '/api/v1/durable-waits/wait-acl', {
      method: 'GET', headers: { 'x-test-context': 'otherPrincipal' },
    });
    expect(denied.response.status).toBe(403);

    const unverified = await request(baseUrl, '/api/v1/durable-waits/claim', {
      method: 'POST', headers: { 'x-test-context': 'unverified' },
      body: { wait_id: 'wait-acl', request_id: 'operation-acl', trigger: 'manual' },
    });
    expect(unverified.response.status).toBe(403);
    expect(unverified.body?.error?.code).toBe('mutation_origin_unverified');
  });

  it('checks owner scope before every mutation and leaves cross-scope state unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-durable-wait-http-scope-mutation-'));
    roots.push(root);
    const store = new DurableWaitStore({ dataDir: root, problemSnapshot: { verify: () => true } });
    const handler = createDurableWaitHttpHandler({ storeFactory: () => store });
    const baseUrl = await start(handler, {
      default: context(),
      otherScope: context({ scopeId: 'org-2' }),
    });

    const createWait = async (waitId: string): Promise<void> => {
      const created = await request(baseUrl, '/api/v1/durable-waits/create', {
        method: 'POST',
        body: createBody(waitId),
      });
      expect(created.response.status).toBe(200);
    };
    const readAsOwner = async (waitId: string): Promise<Record<string, any>> => {
      const read = await request(baseUrl, `/api/v1/durable-waits/${waitId}`, { method: 'GET' });
      expect(read.response.status).toBe(200);
      return read.body?.result as Record<string, any>;
    };
    const rejectCrossScope = async (path: string, body: Record<string, unknown>): Promise<void> => {
      const rejected = await request(baseUrl, path, {
        method: 'POST',
        headers: { 'x-test-context': 'otherScope' },
        body,
      });
      expect(rejected.response.status).toBe(403);
      expect(rejected.body?.error?.code).toBe('unauthorized');
    };

    const claimWaitId = 'wait-cross-scope-claim';
    await createWait(claimWaitId);
    const claimBefore = await readAsOwner(claimWaitId);
    await rejectCrossScope('/api/v1/durable-waits/claim', {
      wait_id: claimWaitId,
      request_id: 'operation-cross-scope-claim',
      trigger: 'manual',
    });
    expect(await readAsOwner(claimWaitId)).toEqual(claimBefore);

    const handoffWaitId = 'wait-cross-scope-handoff';
    await createWait(handoffWaitId);
    const handoffBefore = await readAsOwner(handoffWaitId);
    await rejectCrossScope('/api/v1/durable-waits/handoff', {
      wait_id: handoffWaitId,
      request_id: 'operation-cross-scope-handoff',
      responsible: { principal: 'owner', scope: 'org-1' },
      reason: 'cross scope handoff',
    });
    expect(await readAsOwner(handoffWaitId)).toEqual(handoffBefore);

    const premiseWaitId = 'wait-cross-scope-premise';
    await createWait(premiseWaitId);
    const premiseBefore = await readAsOwner(premiseWaitId);
    await rejectCrossScope('/api/v1/durable-waits/premise-changed', {
      wait_id: premiseWaitId,
      new_problem_snapshot: {
        snapshot_id: snapshotId,
        problem_id: 'problem-2',
        revision: '2',
      },
      reason: 'cross scope premise change',
    });
    expect(await readAsOwner(premiseWaitId)).toEqual(premiseBefore);

    const effectWaitId = 'wait-cross-scope-effect';
    await createWait(effectWaitId);
    const effectBefore = await readAsOwner(effectWaitId);
    await rejectCrossScope('/api/v1/durable-waits/effect-unknown', {
      wait_id: effectWaitId,
      reason: 'cross scope effect uncertainty',
    });
    expect(await readAsOwner(effectWaitId)).toEqual(effectBefore);

    const resumeWaitId = 'wait-cross-scope-resume';
    await createWait(resumeWaitId);
    const ownerClaim = await request(baseUrl, '/api/v1/durable-waits/claim', {
      method: 'POST',
      body: { wait_id: resumeWaitId, request_id: 'operation-owner-claim', trigger: 'manual' },
    });
    expect(ownerClaim.response.status).toBe(200);
    const claimResult = ownerClaim.body?.result as {
      claim?: { claim_id?: string; request_id?: string; lease?: { lease_id?: string; token?: string } };
    };
    const resumeBefore = await readAsOwner(resumeWaitId);
    await rejectCrossScope('/api/v1/durable-waits/resume', {
      wait_id: resumeWaitId,
      request_id: claimResult.claim?.request_id,
      claim_id: claimResult.claim?.claim_id,
      lease_id: claimResult.claim?.lease?.lease_id,
      lease_token: claimResult.claim?.lease?.token,
    });
    expect(await readAsOwner(resumeWaitId)).toEqual(resumeBefore);
  });
});
