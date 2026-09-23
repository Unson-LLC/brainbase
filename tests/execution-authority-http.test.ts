import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ExecutionAuthorityService,
  type ExecutionAuthorityPort,
  type ExecutionCheckKind,
  type ExecutionCheckRequest,
  type ExecutionCheckResult,
  type ExecutionEffectPort,
  type ExecutionReadAccessPort,
  type ExecutionStartInput,
} from '../src/execution-authority.js';
import {
  createExecutionAuthorityHttpHandler,
  type ExecutionAuthorityHttpHandler,
  type TrustedExecutionAuthorityRequestContext,
} from '../src/execution-authority-http.js';

const servers: HttpServer[] = [];
const directories: string[] = [];

const problem = {
  problem_snapshot_id: `sha256:${'a'.repeat(64)}`,
  problem_id: 'problem-execution-authority-http',
  revision: 'r1',
};

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-execution-authority-http-'));
  directories.push(directory);
  return directory;
}

function context(overrides: Partial<TrustedExecutionAuthorityRequestContext> = {}): TrustedExecutionAuthorityRequestContext {
  return {
    tenantId: 'tenant-a',
    principal: 'owner-a',
    scopeId: 'scope-a',
    verifiedMutationOrigin: 'https://bff.example.test',
    ...overrides,
  };
}

function requestBody(operationId: string, overrides: Partial<ExecutionStartInput> = {}): ExecutionStartInput {
  return {
    operationId,
    tenantId: 'tenant-a',
    principal: 'owner-a',
    scopeId: 'scope-a',
    runId: `run-${operationId}`,
    reservationId: 'reservation-a',
    approvalId: 'approval-a',
    authorityRef: 'authority-a',
    constraintRefs: ['constraint-a'],
    problem,
    ...overrides,
  };
}

interface HarnessState {
  authorityStatus: ExecutionCheckResult['status'];
  tenantBReadStatus: 'approved' | 'revoked';
  effectCalls: string[];
}

function serviceFor(dataDir: string, state: HarnessState): ExecutionAuthorityService {
  const verify = async (request: ExecutionCheckRequest): Promise<ExecutionCheckResult> => {
    const status = request.check === 'authority' ? state.authorityStatus : 'approved';
    return {
      status,
      revision: `${request.check}-r1`,
      ...(status === 'approved'
        ? {
            fencingToken: `${request.check}-fence-r1`,
            expiresAt: '2099-01-01T00:00:00.000Z',
          }
        : {}),
    };
  };
  const reservation = {
    verify,
    markStarted: async () => ({ status: 'started' as const }),
  };
  const readAccess: ExecutionReadAccessPort = {
    verify: async (request) => ({
      status: request.tenantId === 'tenant-b' ? state.tenantBReadStatus : 'approved',
      revision: `read-${request.tenantId}-r1`,
    }),
  };
  const effect: ExecutionEffectPort = {
    start: async (request) => {
      state.effectCalls.push(request.operationId);
      return { status: 'started' };
    },
  };
  const authority: ExecutionAuthorityPort = { verify };
  return new ExecutionAuthorityService({
    dataDir,
    authority,
    approval: { verify },
    constraint: { verify },
    reservation,
    readAccess,
    effect,
  });
}

async function start(
  handler: ExecutionAuthorityHttpHandler,
  contexts: Record<string, TrustedExecutionAuthorityRequestContext | null> = { default: context() },
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

describe('execution authority canonical HTTP adapter', () => {
  it('starts through the real service, persists an intent, reads it back, and does not repeat an effect', async () => {
    const dataDir = await tempDir();
    const state: HarnessState = { authorityStatus: 'approved', tenantBReadStatus: 'approved', effectCalls: [] };
    const serviceFactory = vi.fn(() => serviceFor(dataDir, state));
    const handler = createExecutionAuthorityHttpHandler({ serviceFactory });
    const baseUrl = await start(handler);
    const body = requestBody('execute-http');

    const started = await request(baseUrl, '/execution-authority/start', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    expect(started.response.status).toBe(200);
    expect(started.body?.action).toBe('start');
    expect(started.body?.result?.replayed).toBe(false);
    expect(started.body?.result?.effect).toEqual({ operationId: 'execute-http', status: 'started' });

    const retry = await request(baseUrl, '/execution-authority/start', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    expect(retry.response.status).toBe(200);
    expect(retry.body?.result?.replayed).toBe(true);
    expect(state.effectCalls).toEqual(['execute-http']);

    const read = await request(baseUrl, '/execution-authority/intents/execute-http', { method: 'GET' });
    expect(read.response.status).toBe(200);
    expect(read.body?.action).toBe('read');
    expect(read.body?.result).toMatchObject({ operationId: 'execute-http', phase: 'started' });
    expect(serviceFactory).toHaveBeenCalledTimes(3);
  });

  it('keeps tenants separated and applies current read permission through the real service', async () => {
    const dataDir = await tempDir();
    const state: HarnessState = { authorityStatus: 'approved', tenantBReadStatus: 'approved', effectCalls: [] };
    const handler = createExecutionAuthorityHttpHandler({ serviceFactory: (requestContext) => serviceFor(dataDir, state) });
    const baseUrl = await start(handler, {
      a: context(),
      b: context({ tenantId: 'tenant-b', principal: 'owner-b', scopeId: 'scope-b' }),
    });

    const started = await request(baseUrl, '/execution-authority/start', {
      method: 'POST',
      headers: { 'x-test-context': 'a' },
      body: JSON.stringify(requestBody('tenant-a-intent')),
    });
    expect(started.response.status).toBe(200);

    const crossTenantRead = await request(baseUrl, '/execution-authority/intents/tenant-a-intent', {
      method: 'GET',
      headers: { 'x-test-context': 'b' },
    });
    expect(crossTenantRead.response.status).toBe(404);
    expect(crossTenantRead.body?.error?.code).toBe('not_found');

    state.tenantBReadStatus = 'revoked';
    const revokedRead = await request(baseUrl, '/execution-authority/intents/tenant-a-intent', {
      method: 'GET',
      headers: { 'x-test-context': 'b' },
    });
    expect(revokedRead.response.status).toBe(403);
    expect(revokedRead.body?.error?.code).toBe('read_revoked');
  });

  it('rejects malformed, untrusted, and authority-bearing input before the tenant factory', async () => {
    const serviceFactory = vi.fn(() => {
      throw new Error('factory must not be called');
    });
    const handler = createExecutionAuthorityHttpHandler({ serviceFactory });
    const baseUrl = await start(handler, {
      default: context(),
      noCsrf: context({ verifiedMutationOrigin: undefined }),
    });

    const wrongTenant = await request(baseUrl, '/execution-authority/start', {
      method: 'POST',
      body: JSON.stringify(requestBody('wrong-tenant', { tenantId: 'tenant-b' })),
    });
    expect(wrongTenant.response.status).toBe(400);
    expect(wrongTenant.body?.error?.code).toBe('invalid_request');

    const authority = await request(baseUrl, '/execution-authority/start', {
      method: 'POST',
      body: JSON.stringify({ ...requestBody('authority'), authority: 'owner-a' }),
    });
    expect(authority.response.status).toBe(400);

    const malformed = await request(baseUrl, '/execution-authority/start', {
      method: 'POST',
      body: '{"operationId":',
    });
    expect(malformed.response.status).toBe(400);

    const csrf = await request(baseUrl, '/execution-authority/start', {
      method: 'POST',
      headers: { 'x-test-context': 'noCsrf' },
      body: JSON.stringify(requestBody('csrf')),
    });
    expect(csrf.response.status).toBe(403);
    expect(csrf.body?.error?.code).toBe('mutation_origin_unverified');
    expect(serviceFactory).not.toHaveBeenCalled();
  });

  it('requires the host mutation verifier to return the literal boolean true', async () => {
    const serviceFactory = vi.fn(() => {
      throw new Error('factory must not be called');
    });
    const handler = createExecutionAuthorityHttpHandler({
      serviceFactory,
      verifyMutationRequest: vi.fn(() => 'false' as unknown as boolean),
    });
    const baseUrl = await start(handler, {
      default: context({ verifiedMutationOrigin: undefined }),
    });

    const response = await request(baseUrl, '/execution-authority/start', {
      method: 'POST',
      body: JSON.stringify(requestBody('strict-verifier')),
    });

    expect(response.response.status).toBe(403);
    expect(response.body?.error?.code).toBe('mutation_origin_unverified');
    expect(serviceFactory).not.toHaveBeenCalled();
  });

  it('rejects revoked and unknown current authority without crossing reservation or effect boundaries', async () => {
    const dataDir = await tempDir();
    const state: HarnessState = { authorityStatus: 'revoked', tenantBReadStatus: 'approved', effectCalls: [] };
    const serviceFactory = vi.fn(() => serviceFor(dataDir, state));
    const handler = createExecutionAuthorityHttpHandler({ serviceFactory });
    const baseUrl = await start(handler);

    const revoked = await request(baseUrl, '/execution-authority/start', {
      method: 'POST',
      body: JSON.stringify(requestBody('revoked')),
    });
    expect(revoked.response.status).toBe(403);
    expect(revoked.body?.error?.code).toBe('authority_revoked');
    expect(state.effectCalls).toHaveLength(0);

    state.authorityStatus = 'unknown';
    const unknown = await request(baseUrl, '/execution-authority/start', {
      method: 'POST',
      body: JSON.stringify(requestBody('unknown')),
    });
    expect(unknown.response.status).toBe(503);
    expect(unknown.body?.error?.code).toBe('authority_unknown');
    expect(state.effectCalls).toHaveLength(0);
  });
});
