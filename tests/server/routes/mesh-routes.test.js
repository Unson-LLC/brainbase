import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMeshRouter } from '../../../server/routes/mesh.js';
import { csrfMiddleware } from '../../../server/middleware/csrf.js';

const owner = { personId: 'owner', organizationId: 'org-a' };
const validQuery = { to: 'peer-1', question: '状況は？', scope: 'status' };

function setup({ identity = owner, configuredOwner = owner, serviceEnabled = true, csrf = false } = {}) {
  const service = { nodeId: 'local', role: 'member', getPeers: vi.fn(() => []), sendQuery: vi.fn(async () => 'query-1') };
  const authService = {
    verifyServiceToken: vi.fn(() => ({ sub: owner.personId, organizationId: owner.organizationId })),
    verifyToken: vi.fn(token => {
      if (token !== 'valid') throw new Error('Invalid');
      return { sub: identity.personId, organizationId: identity.organizationId, level: 3 };
    }),
  };
  const app = express();
  app.use(express.json());
  if (csrf) app.use(csrfMiddleware());
  app.use('/api/mesh', createMeshRouter(serviceEnabled ? service : null, { authService, owner: configuredOwner }));
  app.post('/api/mesh/neighbour', (_req, res) => res.json({ ok: true }));
  return { app, service };
}

afterEach(() => vi.unstubAllEnvs());

describe('Mesh authenticated owner boundary', () => {
  it.each(['/status', '/peers', '/query'])('rejects anonymous %s before service access', async path => {
    const { app, service } = setup();
    const call = path === '/query' ? request(app).post(`/api/mesh${path}`).send(validQuery) : request(app).get(`/api/mesh${path}`);
    expect((await call).status).toBe(401);
    expect(service.getPeers).not.toHaveBeenCalled();
    expect(service.sendQuery).not.toHaveBeenCalled();
  });

  it('does not accept insecure role headers', async () => {
    vi.stubEnv('ALLOW_INSECURE_SSOT_HEADERS', 'true');
    const { app } = setup();
    expect((await request(app).get('/api/mesh/peers').set('x-brainbase-role', 'ceo')).status).toBe(401);
  });

  it.each([
    { personId: 'other', organizationId: 'org-a' },
    { personId: 'owner', organizationId: 'org-b' },
    { personId: 'owner', organizationId: undefined },
  ])('rejects non-owner or wrong-organization identity %j', async identity => {
    const { app, service } = setup({ identity });
    expect((await request(app).post('/api/mesh/query').auth('valid', { type: 'bearer' }).send(validQuery)).status).toBe(403);
    expect(service.sendQuery).not.toHaveBeenCalled();
  });

  it('fails closed when node ownership is unconfigured', async () => {
    const { app } = setup({ configuredOwner: {} });
    expect((await request(app).get('/api/mesh/peers').auth('valid', { type: 'bearer' })).status).toBe(503);
  });

  it('rejects generic service credentials even with owner-like claims', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', 'test-only-key');
    const { app, service } = setup();
    expect((await request(app).post('/api/mesh/query').auth('bbsvc_test', { type: 'bearer' }).send(validQuery)).status).toBe(403);
    expect((await request(app).post('/api/mesh/query').set('x-internal-api-key', 'test-only-key').send(validQuery)).status).toBe(403);
    expect(service.sendQuery).not.toHaveBeenCalled();
  });

  it('does not fall back to an owner cookie when a bearer is invalid', async () => {
    const { app, service } = setup();
    expect((await request(app).post('/api/mesh/query').auth('invalid', { type: 'bearer' }).set('Cookie', 'brainbase_session=valid').send(validQuery)).status).toBe(401);
    expect(service.sendQuery).not.toHaveBeenCalled();
  });

  it('allows owner reads and defaults an omitted scope', async () => {
    const { app, service } = setup();
    expect((await request(app).get('/api/mesh/status').auth('valid', { type: 'bearer' })).status).toBe(200);
    expect((await request(app).get('/api/mesh/peers').auth('valid', { type: 'bearer' })).body).toEqual({ peers: [] });
    expect((await request(app).post('/api/mesh/query').auth('valid', { type: 'bearer' }).send({ to: 'peer-1', question: '状態' })).status).toBe(200);
    expect(service.sendQuery).toHaveBeenCalledWith('peer-1', '状態', 'general');
  });

  it('does not report an unavailable mesh as an empty peer list', async () => {
    const { app } = setup({ serviceEnabled: false });
    expect((await request(app).get('/api/mesh/peers').auth('valid', { type: 'bearer' })).status).toBe(503);
  });

  it('returns only a send acknowledgement for the owner', async () => {
    const { app, service } = setup();
    const response = await request(app).post('/api/mesh/query').auth('valid', { type: 'bearer' }).send(validQuery);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ queryId: 'query-1', status: 'sent', receipt_kind: 'send_ack', answer_status: 'unknown' });
    expect(service.sendQuery).toHaveBeenCalledWith('peer-1', '状況は？', 'status');
    expect(response.body).not.toHaveProperty('answer');
  });

  it.each([
    { to: 'all' }, { to: ' ALL ' }, { to: ' ' }, { to: {} }, { question: ' ' }, { question: [] }, { scope: 'invalid' }, { scope: null },
  ])('rejects unsupported input %j without sending', async delta => {
    const { app, service } = setup();
    expect((await request(app).post('/api/mesh/query').auth('valid', { type: 'bearer' }).send({ ...validQuery, ...delta })).status).toBe(400);
    expect(service.sendQuery).not.toHaveBeenCalled();
  });

  it('requires auth even if the exact query path passes the bearer CSRF exception', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { app, service } = setup({ csrf: true });
    expect((await request(app).post('/api/mesh/query').auth('invalid', { type: 'bearer' }).send(validQuery)).status).toBe(401);
    expect(service.sendQuery).not.toHaveBeenCalled();
  });

  it('allows a valid owner bearer without browser CSRF token', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { app } = setup({ csrf: true });
    expect((await request(app).post('/api/mesh/query').auth('valid', { type: 'bearer' }).send(validQuery)).status).toBe(200);
  });

  it('keeps cookie-only and neighbouring writes under CSRF protection', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { app, service } = setup({ csrf: true });
    expect((await request(app).post('/api/mesh/query').set('Cookie', 'brainbase_session=valid').send(validQuery)).status).toBe(403);
    expect((await request(app).post('/api/mesh/neighbour').auth('valid', { type: 'bearer' }).send({})).status).toBe(403);
    expect(service.sendQuery).not.toHaveBeenCalled();
  });
});
