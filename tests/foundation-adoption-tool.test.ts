import { describe, expect, it } from 'vitest';
import {
  foundationAdoptionTools,
  handleFoundationAdoptionToolCall,
  type FoundationAuthenticatedToolDependencies,
  type FoundationAuthenticatedToolResult,
} from '../src/foundation-authenticated-tools.js';

const token = 'token-of-the-adopter';
const digest = `sha256:${'d'.repeat(64)}`;
const nextDigest = `sha256:${'e'.repeat(64)}`;

function toolError(status: 'error' | 'unavailable', code: string, message: string, scope: string[], httpStatus?: number): FoundationAuthenticatedToolResult {
  return { status, scope: { project_codes: scope }, error: { code, message, ...(httpStatus ? { http_status: httpStatus } : {}) } };
}

type Seen = { url: string; method: string; headers: Record<string, string>; body?: unknown };

function deps(respond: (seen: Seen) => Response, projectCodes = ['back-office']) {
  const seen: Seen[] = [];
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const entry: Seen = { url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) };
    seen.push(entry);
    if (url.endsWith('/api/csrf-token')) return new Response(JSON.stringify({ token: 'csrf-1' }), { status: 200 });
    return respond(entry);
  }) as typeof globalThis.fetch;
  const dependencies: FoundationAuthenticatedToolDependencies = {
    apiUrl: 'http://brainbase.test',
    fetch,
    auth: {
      async authenticateProject(args) {
        const requested = typeof args.project_code === 'string' ? args.project_code : '';
        if (!projectCodes.includes(requested)) return toolError('error', 'brainbase_project_not_accessible', `project '${requested}' is not accessible`, projectCodes);
        return { token, scope: projectCodes };
      },
      toolError,
      async fetchAuthenticatedJson(context, request) {
        const response = await fetch(`http://brainbase.test${request.path}`, {
          method: request.method,
          headers: { ...request.headers, Authorization: `Bearer ${context.token}`, 'x-brainbase-projects': context.scope.join(','), 'content-type': 'application/json' },
          ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
        });
        try {
          return { ok: true as const, response, payload: await response.json(), payloadParsed: true };
        } catch {
          return { ok: true as const, response, payload: null, payloadParsed: false };
        }
      },
    },
  };
  return { dependencies, seen };
}

const args = { scope_id: 'back-office', type: 'constraint', id: 'no-overnight-runs', revision: '3', digest };
const adopted = () => new Response(JSON.stringify({ action: 'adopt', result: { id: 'no-overnight-runs', type: 'constraint', revision: '4', digest: nextDigest } }), { status: 201 });

describe('foundation_adopt tool (ADR-015)', () => {
  it('is published with the reviewed revision and digest as required input', () => {
    const [tool] = foundationAdoptionTools;
    expect(tool.name).toBe('foundation_adopt');
    expect(tool.inputSchema.required).toEqual(expect.arrayContaining(['scope_id', 'type', 'id', 'revision', 'digest']));
  });

  it('posts the reviewed revision to the adoption route of the selected project with CSRF', async () => {
    const { dependencies, seen } = deps(adopted);
    const result = await handleFoundationAdoptionToolCall('foundation_adopt', args, dependencies);
    expect(result).toMatchObject({ status: 'ok', scope: { project_codes: ['back-office'] }, data: { result: { revision: '4', digest: nextDigest } } });
    const post = seen.find((entry) => entry.url.endsWith('/api/company-os/foundation-adoptions'))!;
    expect(post).toMatchObject({ method: 'POST', body: { id: 'no-overnight-runs', type: 'constraint', revision: '3', digest } });
    expect(post.headers).toMatchObject({ 'x-brainbase-scope': 'back-office', 'x-brainbase-projects': 'back-office', 'x-csrf-token': 'csrf-1', Authorization: `Bearer ${token}` });
  });

  it('refuses malformed input and a project the caller cannot use, before any request', async () => {
    const { dependencies, seen } = deps(adopted);
    for (const bad of [
      { ...args, digest: 'nope' }, { ...args, revision: '0' }, { ...args, type: 'philosophy' }, { ...args, extra: 1 }, { ...args, scope_id: 'a,b' },
    ]) {
      expect((await handleFoundationAdoptionToolCall('foundation_adopt', bad, dependencies))?.status).toBe('error');
    }
    expect((await handleFoundationAdoptionToolCall('foundation_adopt', { ...args, scope_id: 'brainbase' }, dependencies))?.error?.code).toBe('brainbase_project_not_accessible');
    expect(seen).toHaveLength(0);
    expect(await handleFoundationAdoptionToolCall('foundation_read', args, dependencies)).toBeNull();
  });

  it('returns the refusal of the route and does not accept a response for another revision', async () => {
    const refused = deps(() => new Response(JSON.stringify({ error: { code: 'ADOPTER_IS_OWNER', message: 'The owner of a draft cannot adopt it.' } }), { status: 403 }));
    expect(await handleFoundationAdoptionToolCall('foundation_adopt', args, refused.dependencies))
      .toMatchObject({ status: 'error', error: { code: 'ADOPTER_IS_OWNER', http_status: 403 } });
    const wrong = deps(() => new Response(JSON.stringify({ action: 'adopt', result: { id: 'no-overnight-runs', type: 'constraint', revision: '9', digest: nextDigest } }), { status: 201 }));
    expect(await handleFoundationAdoptionToolCall('foundation_adopt', args, wrong.dependencies))
      .toMatchObject({ status: 'error', error: { code: 'foundation_api_response_invalid' } });
  });
});
