import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createJudgmentViewHttpHandler,
  type TrustedJudgmentViewRequestContext,
} from '../src/judgment-view-http.js';
import type { JudgmentViewDocument } from '../src/judgment-view.js';

const servers: HttpServer[] = [];
const trustedContext: TrustedJudgmentViewRequestContext = {
  tenantId: 'tenant-a',
  principal: 'principal-a',
  scopeId: 'project-a',
};

function document(status: JudgmentViewDocument['status'] = 'resolved'): JudgmentViewDocument {
  return {
    contract_version: 'judgment-view.v1',
    mode: 'historical',
    status,
    run: { status },
    conclusion: { status },
    problem: { status },
    objective: { status },
    evidence: { status, items: null, absence_confirmed: false },
    childRuns: { status, items: null, absence_confirmed: false },
    resultEvaluation: { status },
    judgmentValidity: { status },
  };
}

async function start(
  handler: ReturnType<typeof createJudgmentViewHttpHandler>,
  context: TrustedJudgmentViewRequestContext | null = trustedContext,
): Promise<string> {
  const server = createHttpServer((request, response) => {
    void handler(request, response, context).then((handled) => {
      if (!handled && !response.writableEnded) {
        response.statusCode = 404;
        response.end();
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function request(baseUrl: string, path: string, method = 'GET') {
  const response = await fetch(`${baseUrl}${path}`, { method });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) as Record<string, unknown> : undefined };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  })));
});

describe('judgment view composable HTTP route', () => {
  it('uses trusted host context and historical evaluation query without accepting tenant identity from the URL', async () => {
    const read = vi.fn(async () => document());
    const serviceFactory = vi.fn(() => ({ read }));
    const handler = createJudgmentViewHttpHandler({ serviceFactory });
    const baseUrl = await start(handler);

    const result = await request(baseUrl, '/judgment-views/run-1?tenantId=attacker&principal=attacker&scopeId=attacker&evaluationId=evaluation-1');
    expect(result.response.status).toBe(200);
    expect(result.body?.mode).toBe('historical');
    expect(serviceFactory).toHaveBeenCalledWith(trustedContext);
    expect(read).toHaveBeenCalledWith({
      runId: 'run-1',
      evaluationId: 'evaluation-1',
      access: trustedContext,
    });
  });

  it('composes with neighboring routes and rejects missing context or mutation methods', async () => {
    const serviceFactory = vi.fn(() => ({ read: vi.fn(async () => document()) }));
    const handler = createJudgmentViewHttpHandler({ serviceFactory, basePath: '/company/judgment-views' });
    const baseUrl = await start(handler);

    const outside = await request(baseUrl, '/reservation/1');
    expect(outside.response.status).toBe(404);
    const method = await request(baseUrl, '/company/judgment-views/run-1', 'POST');
    expect(method.response.status).toBe(405);
    expect(method.body?.error).toMatchObject({ code: 'method_not_allowed' });

    const unauthorizedHandler = createJudgmentViewHttpHandler({ serviceFactory });
    const unauthorizedBaseUrl = await start(unauthorizedHandler, null);
    const unauthorized = await request(unauthorizedBaseUrl, '/judgment-views/run-1');
    expect(unauthorized.response.status).toBe(401);
    expect(serviceFactory).toHaveBeenCalledTimes(0);
  });

  it('maps an unavailable read to an explicit 503 response', async () => {
    const serviceFactory = vi.fn(() => ({ read: vi.fn(async () => document('unavailable')) }));
    const handler = createJudgmentViewHttpHandler({ serviceFactory });
    const baseUrl = await start(handler);

    const result = await request(baseUrl, '/judgment-views/run-1');
    expect(result.response.status).toBe(503);
    expect(result.body?.status).toBe('unavailable');
  });
});
