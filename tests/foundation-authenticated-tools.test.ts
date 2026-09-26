import { describe, expect, it } from 'vitest';
import { philosophyRevisionDigest } from '../src/philosophy-revision-reader.js';
import {
  foundationPublicTools,
  handleFoundationPublicToolCall,
  type FoundationAuthenticatedToolDependencies,
  type FoundationAuthenticatedToolResult,
} from '../src/foundation-authenticated-tools.js';

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

const token = jwt({ sub: 'per_owner', projectCodes: ['brainbase', 'vibepro'] });

function toolError(
  status: 'error' | 'unavailable',
  code: string,
  message: string,
  scope: string[],
  httpStatus?: number,
  details?: unknown,
): FoundationAuthenticatedToolResult {
  return {
    status,
    scope: { project_codes: scope },
    error: {
      code,
      message,
      ...(httpStatus ? { http_status: httpStatus } : {}),
      ...(details !== undefined ? { details } : {}),
    },
  };
}

function deps(fetch: typeof globalThis.fetch, projectCodes = ['brainbase', 'vibepro']): FoundationAuthenticatedToolDependencies {
  const authenticateProject: FoundationAuthenticatedToolDependencies['auth']['authenticateProject'] = async (args) => {
    const requestedProject = typeof args.project_code === 'string' ? args.project_code : '';
    if (!requestedProject || !projectCodes.includes(requestedProject)) {
      return toolError('error', 'brainbase_project_not_accessible', `project '${requestedProject}' is not accessible`, projectCodes);
    }
    return { token, scope: projectCodes };
  };
  return {
    apiUrl: 'http://brainbase.test',
    fetch,
    auth: {
      authenticateProject,
      toolError,
      async fetchAuthenticatedJson(context, request) {
        let response: Response;
        try {
          response = await fetch(`http://brainbase.test${request.path}`, {
            method: request.method,
            headers: {
              ...request.headers,
              Authorization: `Bearer ${context.token}`,
              'x-brainbase-projects': context.scope.join(','),
              ...(request.body !== undefined ? { 'content-type': 'application/json' } : {}),
            },
            ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
          });
        } catch (error) {
          return {
            ok: false as const,
            result: toolError('unavailable', 'brainbase_api_unavailable', error instanceof Error ? error.message : String(error), context.scope),
          };
        }
        try {
          return { ok: true as const, response, payload: await response.json(), payloadParsed: true };
        } catch {
          return { ok: true as const, response, payload: null, payloadParsed: false };
        }
      },
    },
  };
}

const philosophyContent = {
  kind: 'philosophy' as const,
  id: 'philosophy_1',
  revision: '1',
  payload: {
    principle: '継続利用を導入件数より優先する',
  },
  applicability: {
    scope: { type: 'project' as const, id: 'brainbase' },
    validFrom: '2026-01-01T00:00:00Z',
  },
};

const philosophyRecord = {
  ...philosophyContent,
  digest: philosophyRevisionDigest(philosophyContent),
  currentAcl: {
    ownerId: 'per_owner',
    visibility: 'project' as const,
    readerIds: [],
    writerIds: [],
  },
  currentScope: { type: 'project' as const, id: 'brainbase' },
};

describe('Foundation authenticated MCP tools', () => {
  it('publishes the four provider tools with a required scope_id', () => {
    expect(foundationPublicTools.map((tool) => tool.name)).toEqual([
      'foundation_describe',
      'foundation_read',
      'foundation_validate_reference',
      'foundation_validate_problem',
    ]);
    for (const tool of foundationPublicTools) {
      expect(tool.inputSchema.required).toContain('scope_id');
    }
  });

  it('propagates only the selected scope and keeps scope_id out of POST bodies', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      const pathname = new URL(String(url)).pathname;
      if (pathname.endsWith('/csrf-token')) {
        return new Response(JSON.stringify({ token: 'csrf-token' }), { status: 200 });
      }
      if (pathname.endsWith('/contract')) {
        return new Response(JSON.stringify({
          contractVersion: 'foundation-public.v1',
          foundation: { version: '1.0.0' },
          connection: 'configured',
          executionPermission: 'none',
        }), { status: 200 });
      }
      if (pathname.includes('/definitions/')) {
        if (pathname.includes('/definitions/philosophy/')) {
          return new Response(JSON.stringify(philosophyRecord), { status: 200 });
        }
        return new Response(JSON.stringify({
          definition: { id: 'objective_1', type: 'objective', revision: '1' },
          digest: `sha256:${'a'.repeat(64)}`,
        }), { status: 200 });
      }
      if (pathname.endsWith('/judgment-references/validate')) {
        return new Response(JSON.stringify({ status: 'resolved' }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: 'resolved', executionPermission: 'none' }), { status: 200 });
    };

    const baseReference = {
      kind: 'objective', id: 'objective_1', revision: '1', digest: `sha256:${'a'.repeat(64)}`,
      scope: { type: 'project', id: 'brainbase' }, valid_from: '2026-01-01T00:00:00+09:00',
    };
    const cases: Array<{ name: string; args: Record<string, unknown>; method: string; path: string; body?: unknown }> = [
      {
        name: 'foundation_describe', args: { scope_id: 'brainbase' }, method: 'GET',
        path: '/api/foundation/contract?scope_id=brainbase',
      },
      {
        name: 'foundation_read', args: { scope_id: 'brainbase', type: 'objective', id: 'objective_1', revision: '1' }, method: 'GET',
        path: '/api/foundation/definitions/objective/objective_1?scope_id=brainbase&revision=1',
      },
      {
        name: 'foundation_read', args: {
          scope_id: 'brainbase', type: 'philosophy', id: 'philosophy_1', revision: '1', digest: philosophyRecord.digest,
        }, method: 'GET',
        path: `/api/foundation/definitions/philosophy/philosophy_1?scope_id=brainbase&revision=1&digest=${encodeURIComponent(philosophyRecord.digest)}`,
      },
      {
        name: 'foundation_validate_reference', args: { scope_id: 'brainbase', reference: baseReference, phase: 'read' }, method: 'POST',
        path: '/api/foundation/judgment-references/validate?scope_id=brainbase', body: { reference: baseReference, phase: 'read' },
      },
      {
        name: 'foundation_validate_problem', args: { scope_id: 'brainbase', snapshot: { id: 'snapshot_1' } }, method: 'POST',
        path: '/api/foundation/judgment-problems/validate?scope_id=brainbase', body: { snapshot: { id: 'snapshot_1' } },
      },
    ];

    for (const testCase of cases) {
      const result = await handleFoundationPublicToolCall(testCase.name, testCase.args, deps(fetch));
      expect(result?.status, testCase.name).toBe('ok');
      const csrfRequest = testCase.method === 'POST' ? requests.shift() : undefined;
      if (csrfRequest) {
        expect(csrfRequest.url).toBe('http://brainbase.test/api/csrf-token');
        expect(csrfRequest.init?.method).toBe('GET');
        const csrfHeaders = new Headers(csrfRequest.init?.headers);
        expect(csrfHeaders.get('authorization')).toBe(`Bearer ${token}`);
        expect(csrfHeaders.get('x-brainbase-projects')).toBe('brainbase');
        expect(csrfHeaders.get('x-session-id')).toMatch(/^brainbase-mcp-foundation-/u);
      }
      const request = requests.shift();
      expect(request).toBeDefined();
      expect(request?.url).toBe(`http://brainbase.test${testCase.path}`);
      expect(request?.init?.method).toBe(testCase.method);
      const headers = new Headers(request?.init?.headers);
      expect(headers.get('authorization')).toBe(`Bearer ${token}`);
      expect(headers.get('x-brainbase-projects')).toBe('brainbase');
      if (testCase.method === 'POST') {
        expect(headers.get('x-csrf-token')).toBe('csrf-token');
        expect(headers.get('x-session-id')).toBe(new Headers(csrfRequest?.init?.headers).get('x-session-id'));
      }
      if (testCase.body !== undefined) expect(JSON.parse(String(request?.init?.body))).toEqual(testCase.body);
      else expect(request?.init?.body).toBeUndefined();
    }
  });

  it('fails closed for unauthorized scopes, unavailable upstreams, and invalid 200 responses', async () => {
    let called = false;
    const inaccessible = await handleFoundationPublicToolCall('foundation_describe', { scope_id: 'other' }, deps(async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }));
    expect(inaccessible?.status).toBe('error');
    expect(inaccessible?.error?.code).toBe('brainbase_project_not_accessible');
    expect(called).toBe(false);

    const unavailable = await handleFoundationPublicToolCall('foundation_describe', { scope_id: 'brainbase' }, deps(async () => new Response('{}', { status: 404 })));
    expect(unavailable?.status).toBe('unavailable');
    expect(unavailable?.error?.http_status).toBe(404);

    const malformed = await handleFoundationPublicToolCall('foundation_describe', { scope_id: 'brainbase' }, deps(async () => new Response(JSON.stringify({}), { status: 200 })));
    expect(malformed?.status).toBe('error');
    expect(malformed?.error?.code).toBe('foundation_api_response_invalid');

    const philosophyDigestMismatch = await handleFoundationPublicToolCall('foundation_read', {
      scope_id: 'brainbase', type: 'philosophy', id: 'philosophy_1', revision: '1',
    }, deps(async () => new Response(JSON.stringify({
      kind: 'philosophy',
      id: 'philosophy_1',
      revision: '1',
      digest: `sha256:${'b'.repeat(64)}`,
      payload: { principle: '継続利用を導入件数より優先する' },
      applicability: {
        scope: { type: 'project', id: 'brainbase' },
        validFrom: '2026-01-01T00:00:00Z',
      },
      currentAcl: { ownerId: 'per_owner', visibility: 'project', readerIds: [], writerIds: [] },
      currentScope: { type: 'project', id: 'brainbase' },
    }), { status: 200 })));
    expect(philosophyDigestMismatch?.status).toBe('error');
    expect(philosophyDigestMismatch?.error?.code).toBe('foundation_api_response_invalid');

    const philosophyIdentity = { ...philosophyContent, id: 'philosophy_other' };
    const philosophyIdentityMismatch = await handleFoundationPublicToolCall('foundation_read', {
      scope_id: 'brainbase', type: 'philosophy', id: 'philosophy_1', revision: '1',
    }, deps(async () => new Response(JSON.stringify({
      ...philosophyRecord,
      id: philosophyIdentity.id,
      digest: philosophyRevisionDigest(philosophyIdentity),
    }), { status: 200 })));
    expect(philosophyIdentityMismatch?.status).toBe('error');
    expect(philosophyIdentityMismatch?.error?.code).toBe('foundation_api_response_invalid');

    const unresolved = await handleFoundationPublicToolCall('foundation_validate_problem', {
      scope_id: 'brainbase', snapshot: { id: 'snapshot_1' },
    }, deps(async (url) => new Response(
      JSON.stringify(new URL(String(url)).pathname.endsWith('/csrf-token')
        ? { token: 'csrf-token' }
        : { status: 'unresolved' }),
      { status: 200 },
    )));
    expect(unresolved?.status).toBe('error');
    expect(unresolved?.error?.code).toBe('foundation_api_response_invalid');

    const csrfUnavailable = await handleFoundationPublicToolCall('foundation_validate_problem', {
      scope_id: 'brainbase', snapshot: { id: 'snapshot_1' },
    }, deps(async () => new Response('{}', { status: 503 })));
    expect(csrfUnavailable?.status).toBe('unavailable');
    expect(csrfUnavailable?.error?.code).toBe('foundation_api_unavailable');
  });

  it('rejects scope header injection', async () => {
    const result = await handleFoundationPublicToolCall('foundation_describe', { scope_id: 'brainbase,vibepro' }, deps(async () => new Response('{}')));
    expect(result?.status).toBe('error');
    expect(result?.error?.code).toBe('foundation_request_invalid');
  });
});
