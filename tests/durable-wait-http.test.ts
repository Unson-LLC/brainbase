import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DurableWaitStore } from '../src/durable-waits.js';
import {
  createDurableWaitHttpHandler,
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
});
