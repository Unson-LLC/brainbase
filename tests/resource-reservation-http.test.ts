import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ResourceReservationService,
  type ResourceReservationAuthorizationPort,
  type ResourceReservationProblemSnapshotPort,
  type ResourceReservationRequest,
} from '../src/resource-reservations.js';
import {
  createResourceReservationHttpHandler,
  type ResourceReservationHttpHandler,
  type TrustedResourceReservationRequestContext,
} from '../src/resource-reservation-http.js';

const servers: HttpServer[] = [];
const directories: string[] = [];

const problem = {
  problem_snapshot_id: `sha256:${'b'.repeat(64)}`,
  problem_id: 'problem-reservation-http',
  revision: 'r1',
};
const period = {
  startsAt: '2026-09-23T10:00:00.000Z',
  endsAt: '2026-09-23T18:00:00.000Z',
};

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-reservation-http-'));
  directories.push(directory);
  return directory;
}

function context(overrides: Partial<TrustedResourceReservationRequestContext> = {}): TrustedResourceReservationRequestContext {
  return {
    tenantId: 'tenant-a',
    principal: 'owner-a',
    scopeId: 'scope-a',
    verifiedMutationOrigin: 'https://bff.example.test',
    ...overrides,
  };
}

function requestBody(operationId: string, overrides: Partial<ResourceReservationRequest> = {}): ResourceReservationRequest {
  return {
    operationId,
    tenantId: 'tenant-a',
    principal: 'owner-a',
    scopeId: 'scope-a',
    resourceId: 'calendar-hours',
    period,
    amount: 8,
    unit: 'hour',
    runId: `run-${operationId}`,
    problem,
    ...overrides,
  };
}

function ports(capacity = 10): {
  authorization: ResourceReservationAuthorizationPort;
  problemSnapshot: ResourceReservationProblemSnapshotPort;
  capacity: { read: () => number };
} {
  return {
    authorization: {
      authorize: (input) => ({
        status: 'approved',
        approvalId: input.approvalId ?? `approval-${input.operationId}`,
        evidence: { source: 'http-test' },
      }),
    },
    problemSnapshot: { verify: () => true },
    capacity: { read: () => capacity },
  };
}

async function start(
  handler: ResourceReservationHttpHandler,
  contexts: Record<string, TrustedResourceReservationRequestContext | null> = { default: context() },
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
  init: { method: string; body?: string; headers?: Record<string, string> },
): Promise<{ response: Response; body: Record<string, any> | undefined }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) as Record<string, any> : undefined };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  })));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('resource reservation canonical HTTP adapter', () => {
  it('composes with the real service and reads an approved reservation back over HTTP', async () => {
    const dataDir = await tempDir();
    const serviceFactory = vi.fn(() => new ResourceReservationService({ dataDir, ...ports() }));
    const handler = createResourceReservationHttpHandler({ serviceFactory });
    const baseUrl = await start(handler);
    const body = requestBody('approve-http');

    const approved = await request(baseUrl, '/resource-reservations/approve', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    expect(approved.response.status).toBe(200);
    expect(approved.body?.action).toBe('approve');
    const approvalId = approved.body?.result?.reservation?.approval?.approvalId;

    const retry = await request(baseUrl, '/resource-reservations/approve', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    expect(retry.response.status).toBe(200);
    expect(retry.body?.result?.reservation?.reservationId)
      .toBe(approved.body?.result?.reservation?.reservationId);

    const reserved = await request(baseUrl, '/resource-reservations/reserve', {
      method: 'POST',
      body: JSON.stringify({ ...body, operationId: 'reserve-http', approvalId }),
    });
    expect(reserved.response.status).toBe(200);
    expect(reserved.body?.result?.reservation?.state).toBe('reserved');

    const read = await request(baseUrl, '/resource-reservations', { method: 'GET' });
    expect(read.response.status).toBe(200);
    expect(read.body?.result?.reservations).toHaveLength(1);
    expect(read.body?.result?.reservations?.[0]?.state).toBe('reserved');
    expect(serviceFactory).toHaveBeenCalledTimes(4);
  });

  it('rejects untrusted body identities, authority, malformed JSON, and unverified mutation origin before the factory', async () => {
    const serviceFactory = vi.fn(() => {
      throw new Error('factory must not be called');
    });
    const handler = createResourceReservationHttpHandler({ serviceFactory });
    const baseUrl = await start(handler, {
      default: context(),
      noCsrf: context({ verifiedMutationOrigin: undefined }),
    });

    const wrongTenant = await request(baseUrl, '/resource-reservations/approve', {
      method: 'POST',
      body: JSON.stringify(requestBody('wrong-tenant', { tenantId: 'tenant-b' })),
    });
    expect(wrongTenant.response.status).toBe(400);
    expect(wrongTenant.body?.error?.code).toBe('invalid_request');

    const authority = await request(baseUrl, '/resource-reservations/approve', {
      method: 'POST',
      body: JSON.stringify({ ...requestBody('authority'), authority: 'owner-a' }),
    });
    expect(authority.response.status).toBe(400);

    const malformed = await request(baseUrl, '/resource-reservations/approve', {
      method: 'POST',
      body: '{"operationId":',
    });
    expect(malformed.response.status).toBe(400);

    const csrf = await request(baseUrl, '/resource-reservations/approve', {
      method: 'POST',
      headers: { 'x-test-context': 'noCsrf' },
      body: JSON.stringify(requestBody('csrf')),
    });
    expect(csrf.response.status).toBe(403);
    expect(csrf.body?.error?.code).toBe('mutation_origin_unverified');
    expect(serviceFactory).not.toHaveBeenCalled();
  });

  it('allows a host-side mutation verifier to authorize writes when context has no origin marker', async () => {
    const dataDir = await tempDir();
    const verifyMutationRequest = vi.fn(() => true);
    const serviceFactory = vi.fn(() => new ResourceReservationService({ dataDir, ...ports() }));
    const handler = createResourceReservationHttpHandler({ serviceFactory, verifyMutationRequest });
    const baseUrl = await start(handler, { default: context({ verifiedMutationOrigin: undefined }) });

    const response = await request(baseUrl, '/resource-reservations/estimate', {
      method: 'POST',
      body: JSON.stringify(requestBody('callback-csrf')),
    });
    expect(response.response.status).toBe(200);
    expect(verifyMutationRequest).toHaveBeenCalledTimes(1);
    expect(serviceFactory).toHaveBeenCalledTimes(1);
  });

  it('keeps tenants separated through the real ledger and current service ACL', async () => {
    const dataDir = await tempDir();
    const handler = createResourceReservationHttpHandler({
      serviceFactory: (requestContext) => new ResourceReservationService({ dataDir, ...ports() }),
    });
    const baseUrl = await start(handler, {
      a: context(),
      b: context({ tenantId: 'tenant-b', principal: 'owner-b', scopeId: 'scope-b' }),
    });
    const body = requestBody('tenant-a-approve');
    const approved = await request(baseUrl, '/resource-reservations/approve', {
      method: 'POST',
      headers: { 'x-test-context': 'a' },
      body: JSON.stringify(body),
    });
    expect(approved.response.status).toBe(200);
    const reservationId = approved.body?.result?.reservation?.reservationId;

    const tenantBRead = await request(baseUrl, '/resource-reservations', {
      method: 'GET',
      headers: { 'x-test-context': 'b' },
    });
    expect(tenantBRead.response.status).toBe(200);
    expect(tenantBRead.body?.result?.reservations).toEqual([]);

    const crossTenantBody = {
      operationId: 'tenant-b-release',
      tenantId: 'tenant-a',
      principal: 'owner-a',
      scopeId: 'scope-a',
      reservationId,
    };
    const crossTenant = await request(baseUrl, '/resource-reservations/release', {
      method: 'POST',
      headers: { 'x-test-context': 'b' },
      body: JSON.stringify(crossTenantBody),
    });
    expect(crossTenant.response.status).toBe(400);

    const directCrossTenant = await request(baseUrl, '/resource-reservations/release', {
      method: 'POST',
      headers: { 'x-test-context': 'b' },
      body: JSON.stringify({
        operationId: 'tenant-b-release-2',
        reservationId,
      }),
    });
    expect(directCrossTenant.response.status).toBe(403);
    expect(directCrossTenant.body?.error?.code).toBe('scope_mismatch');
  });

  it('serializes concurrent HTTP reservations through the existing service store', async () => {
    const dataDir = await tempDir();
    const handler = createResourceReservationHttpHandler({
      serviceFactory: () => new ResourceReservationService({ dataDir, ...ports(10) }),
    });
    const baseUrl = await start(handler);
    const first = requestBody('concurrent-approve-1');
    const second = requestBody('concurrent-approve-2');
    const approvals = await Promise.all([
      request(baseUrl, '/resource-reservations/approve', { method: 'POST', body: JSON.stringify(first) }),
      request(baseUrl, '/resource-reservations/approve', { method: 'POST', body: JSON.stringify(second) }),
    ]);
    expect(approvals.every(({ response }) => response.status === 200)).toBe(true);
    const approvalId1 = approvals[0].body?.result?.reservation?.approval?.approvalId;
    const approvalId2 = approvals[1].body?.result?.reservation?.approval?.approvalId;
    const reserves = await Promise.all([
      request(baseUrl, '/resource-reservations/reserve', {
        method: 'POST',
        body: JSON.stringify({ ...first, operationId: 'concurrent-reserve-1', approvalId: approvalId1 }),
      }),
      request(baseUrl, '/resource-reservations/reserve', {
        method: 'POST',
        body: JSON.stringify({ ...second, operationId: 'concurrent-reserve-2', approvalId: approvalId2 }),
      }),
    ]);
    expect(reserves.map(({ response }) => response.status).sort()).toEqual([200, 409]);

    const read = await request(baseUrl, '/resource-reservations', { method: 'GET' });
    expect(read.body?.result?.reservations?.filter((item: { state: string }) => item.state === 'reserved')).toHaveLength(1);
  });
});
