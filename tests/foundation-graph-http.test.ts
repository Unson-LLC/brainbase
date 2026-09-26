import { describe, expect, it, vi } from 'vitest';
import {
  createFoundationGraphHttpHandler,
  FOUNDATION_GRAPH_READY_SQL,
  type FoundationGraphTrustedIdentity
} from '../src/foundation-graph-http.js';

const identity: FoundationGraphTrustedIdentity = {
  principal: 'alice',
  organizationId: 'org-a',
  projectScopeIds: ['project-a']
};

function jsonRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://foundation.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }
  });
}

function fixture(options: { ready?: boolean; csrfResult?: boolean } = {}) {
  const ready = options.ready ?? true;
  const csrf = vi.fn(async () => options.csrfResult ?? true);
  const query = vi.fn(async (text: string) => (
    text === FOUNDATION_GRAPH_READY_SQL
      ? { rows: [{ ready }] }
      : { rows: [] }
  ));
  const withAccessContext = vi.fn(async (
    _trustedIdentity: FoundationGraphTrustedIdentity,
    callback: (client: { query: typeof query }) => Promise<Response>
  ) => callback({ query }));
  const handler = createFoundationGraphHttpHandler({
    resolveTrustedIdentity: () => identity,
    withAccessContext,
    csrf: { verify: csrf },
    bodyLimitBytes: 65_536
  });
  return { handler, csrf, query, withAccessContext };
}

describe('Graph Foundation public HTTP adapter', () => {
  it('runs the public contract through the selected project transaction', async () => {
    const f = fixture();
    const response = await f.handler.handle(jsonRequest('/api/foundation/contract?scope_id=project-a'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      contractVersion: 'foundation-public.v1',
      philosophy: { connected: true },
      executionPermission: 'none'
    });
    expect(f.withAccessContext).toHaveBeenCalledWith(identity, expect.any(Function));
    expect(f.query).toHaveBeenCalledWith(FOUNDATION_GRAPH_READY_SQL);
    expect(FOUNDATION_GRAPH_READY_SQL).toContain('tgtype = 34');
  });

  it.each([
    ['/api/foundation/contract', 400],
    ['/api/foundation/contract?scope_id=project-a&scope_id=project-b', 400],
    ['/api/foundation/contract?scope_id=project-b', 403]
  ])('rejects an invalid or ungranted project selector before storage (%s)', async (path, status) => {
    const f = fixture();
    await expect(f.handler.handle(jsonRequest(path))).resolves.toHaveProperty('status', status);
    expect(f.withAccessContext).not.toHaveBeenCalled();
  });

  it('fails closed when the immutable history migration is not ready', async () => {
    const f = fixture({ ready: false });
    const response = await f.handler.handle(jsonRequest('/api/foundation/contract?scope_id=project-a'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'foundation_migration_required' } });
  });

  it('uses the injected CSRF verifier for mutations', async () => {
    const f = fixture({ csrfResult: false });
    const response = await f.handler.handle(jsonRequest(
      '/api/foundation/judgment-references/validate?scope_id=project-a',
      { method: 'POST', body: JSON.stringify({}) }
    ));

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('csrf_failed');
    expect(f.csrf).toHaveBeenCalled();
  });

  it('allows only a canonical organization philosophy reference through the boundary', async () => {
    const f = fixture();
    const allowed = await f.handler.handle(jsonRequest(
      '/api/foundation/judgment-references/validate?scope_id=project-a',
      {
        method: 'POST',
        body: JSON.stringify({ reference: { kind: 'philosophy', scope: { type: 'organization', id: 'org-a' } } })
      }
    ));
    expect(allowed.status).not.toBe(403);
    expect(f.withAccessContext).toHaveBeenCalledTimes(1);

    const denied = await f.handler.handle(jsonRequest(
      '/api/foundation/judgment-references/validate?scope_id=project-a',
      {
        method: 'POST',
        body: JSON.stringify({ reference: { kind: 'objective', scope: { type: 'organization', id: 'org-a' } } })
      }
    ));
    expect(denied.status).toBe(403);
    expect(f.withAccessContext).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['another organization philosophy', { reference: { kind: 'philosophy', scope: { type: 'organization', id: 'org-b' } } }],
    ['another project reference', { reference: { kind: 'model', scope: { type: 'project', id: 'project-b' } } }],
    ['organization owner scope', { snapshot: { owner_scope: { type: 'organization', id: 'org-a' } } }],
    ['organization measurement scope', {
      snapshot: {
        references: [{
          kind: 'objective',
          scope: { type: 'project', id: 'project-a' },
          measurement: { scope: { subjectIds: ['org-a'] } }
        }]
      }
    }]
  ])('rejects %s before the shared transaction can widen scope', async (_label, body) => {
    const f = fixture();
    const path = 'snapshot' in body
      ? '/api/foundation/judgment-problems/validate?scope_id=project-a'
      : '/api/foundation/judgment-references/validate?scope_id=project-a';
    const response = await f.handler.handle(jsonRequest(path, {
      method: 'POST',
      body: JSON.stringify(body)
    }));

    expect(response.status).toBe(403);
    expect(f.withAccessContext).not.toHaveBeenCalled();
  });

  it('leaves malformed bodies to the shared validator instead of making an auth decision', async () => {
    const f = fixture();
    const response = await f.handler.handle(jsonRequest(
      '/api/foundation/judgment-references/validate?scope_id=project-a',
      { method: 'POST', body: JSON.stringify({ reference: { kind: 'objective', scope: { type: 'organization' } } }) }
    ));

    expect(response.status).toBe(400);
    expect(f.withAccessContext).toHaveBeenCalledTimes(1);
  });
});
