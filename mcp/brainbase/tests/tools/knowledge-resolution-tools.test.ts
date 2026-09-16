import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { handleKnowledgeResolutionToolCall, knowledgeResolutionTools } from '../../src/tools/knowledge-resolution-tools.js';
import { __testing as serverTesting } from '../../src/server.js';

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

it('knowledge.resolveをtool listへ登録しAPI receiptを返す', async () => {
  assert.ok(serverTesting.tools.some((tool) => tool.name === 'brainbase_knowledge_resolve'));
  assert.deepEqual(
    knowledgeResolutionTools.map((tool) => tool.name),
    ['brainbase_knowledge_resolve', 'brainbase_knowledge_event_record'],
  );
  const resolutionTool = knowledgeResolutionTools[0];
  assert.equal('recent_receipts' in (resolutionTool.inputSchema.properties || {}), false);
  assert.equal('repository' in (resolutionTool.inputSchema.properties || {}), false);
  assert.equal('suggested_path' in (resolutionTool.inputSchema.properties || {}), false);
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await handleKnowledgeResolutionToolCall('brainbase_knowledge_resolve', {
    project_code: 'brainbase', intent: 'UX知見を探す', audience: 'team', content_type: 'team_document',
  }, {
    apiUrl: 'http://brainbase.test', configuredProjectCodes: ['brainbase'],
    tokenManager: { getToken: async () => jwt({ projectCodes: ['brainbase'] }) },
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        resolution_id: 'kr_1', resolved_at: '2026-08-07T00:00:00.000Z', status: 'resolved',
        source_class: 'owning_repo', canonical_location: { repository: 'project:brainbase', path: 'docs/' },
        retrieval_capability: 'repository.read', searched_scope: [], absence_confirmed: false,
        excluded_sources: [], not_searched: [], next_route: 'owning_repo', confidence: 0.95, rationale: 'deterministic',
      }), { status: 200 });
    },
  });
  assert.equal(calls[0].url, 'http://brainbase.test/api/knowledge/resolve');
  assert.equal(result?.status, 'ok');
});

it('scope外projectはfetch前に拒否する', async () => {
  let fetched = false;
  const result = await handleKnowledgeResolutionToolCall('brainbase_knowledge_resolve', {
    project_code: 'salestailor', intent: 'x', audience: 'team', content_type: 'team_document',
  }, {
    apiUrl: 'http://brainbase.test', configuredProjectCodes: ['brainbase'],
    tokenManager: { getToken: async () => jwt({ projectCodes: ['brainbase'] }) },
    fetch: async () => { fetched = true; return new Response('{}'); },
  });
  assert.equal(fetched, false);
  assert.equal(result?.error?.code, 'brainbase_project_not_accessible');
});

it('invalid JWT contextはfetch前に拒否する', async () => {
  let fetched = false;
  const result = await handleKnowledgeResolutionToolCall('brainbase_knowledge_resolve', {
    project_code: 'brainbase', intent: 'x', audience: 'team', content_type: 'team_document',
  }, {
    apiUrl: 'http://brainbase.test', configuredProjectCodes: ['brainbase'],
    tokenManager: { getToken: async () => 'invalid-token' },
    fetch: async () => { fetched = true; return new Response('{}'); },
  });
  assert.equal(fetched, false);
  assert.equal(result?.status, 'error');
  assert.equal(result?.error?.code, 'brainbase_auth_context_invalid');
});

it('transport・4xx・5xx・invalid success responseを区別する', async () => {
  const args = { project_code: 'brainbase', intent: 'x', audience: 'team', content_type: 'team_document' };
  const dependencies = (fetch: typeof globalThis.fetch) => ({
    apiUrl: 'http://brainbase.test', configuredProjectCodes: ['brainbase'],
    tokenManager: { getToken: async () => jwt({ projectCodes: ['brainbase'] }) }, fetch,
  });

  const transport = await handleKnowledgeResolutionToolCall('brainbase_knowledge_resolve', args, dependencies(async () => { throw new Error('ECONNREFUSED'); }));
  assert.equal(transport?.status, 'unavailable');
  assert.equal(transport?.error?.code, 'brainbase_api_unavailable');

  const denied = await handleKnowledgeResolutionToolCall('brainbase_knowledge_resolve', args, dependencies(async () => new Response(JSON.stringify({ error: { message: 'denied' } }), { status: 403 })));
  assert.equal(denied?.status, 'error');
  assert.equal(denied?.error?.code, 'brainbase_api_error');
  assert.equal(denied?.error?.http_status, 403);

  const unavailable = await handleKnowledgeResolutionToolCall('brainbase_knowledge_resolve', args, dependencies(async () => new Response(JSON.stringify({ error: { message: 'down' } }), { status: 503 })));
  assert.equal(unavailable?.status, 'unavailable');
  assert.equal(unavailable?.error?.code, 'brainbase_api_unavailable');
  assert.equal(unavailable?.error?.http_status, 503);

  const invalid = await handleKnowledgeResolutionToolCall('brainbase_knowledge_resolve', args, dependencies(async () => new Response(JSON.stringify({ status: 'resolved' }), { status: 200 })));
  assert.equal(invalid?.status, 'error');
  assert.equal(invalid?.error?.code, 'brainbase_api_response_invalid');

  const partial = await handleKnowledgeResolutionToolCall('brainbase_knowledge_resolve', args, dependencies(async () => new Response(JSON.stringify({ resolution_id: 'kr_partial', status: 'resolved' }), { status: 200 })));
  assert.equal(partial?.status, 'error');
  assert.equal(partial?.error?.code, 'brainbase_api_response_invalid');
});

it('extension dispatcherは最初のhandler結果で停止し、全てnullならfallback可能にする', async () => {
  const calls: string[] = [];
  const result = await serverTesting.dispatchExtensionToolCall('example', {}, [
    async () => { calls.push('first'); return null; },
    async () => { calls.push('second'); return { status: 'ok' }; },
    async () => { calls.push('third'); return { status: 'unexpected' }; },
  ]);
  assert.deepEqual(calls, ['first', 'second']);
  assert.deepEqual(result, { status: 'ok' });

  const fallback = await serverTesting.dispatchExtensionToolCall('missing', {}, [async () => null]);
  assert.equal(fallback, null);
});


it('signed runtime authority bypasses static scope only through the verifying backend', async () => {
  const args = { project_code: 'unson', intent: 'lookup', audience: 'team', content_type: 'canonical_fact' };
  const proof = { signed: 'test-envelope' };
  const receipt = {
    resolution_id: 'kr_1', resolved_at: '2026-09-16T00:00:00Z', status: 'resolved', project_code: 'unson',
    source_class: 'graph', canonical_location: { scope: 'unson' }, retrieval_capability: 'graph.search',
    searched_scope: [], absence_confirmed: false, excluded_sources: [], not_searched: [],
    next_route: 'graph', confidence: 1, rationale: 'test',
  };
  let calls = 0;
  const dependencies = {
    apiUrl: 'http://static.test', configuredProjectCodes: ['mana'],
    tokenManager: { getToken: async () => { throw new Error('must not use static authority'); } },
    runtimeApiUrl: 'http://runtime.test', runtimeServiceToken: 'service-test',
    companyAuthorityResponse: Buffer.from(JSON.stringify(proof)).toString('base64url'),
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      calls++;
      assert.equal(String(url), 'http://runtime.test/api/v1/runtime/knowledge:resolve');
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer service-test');
      assert.deepEqual(JSON.parse(String(init?.body)), { ...args, company_authority_response: proof });
      return new Response(JSON.stringify(receipt));
    },
  };
  const result = await handleKnowledgeResolutionToolCall('brainbase_knowledge_resolve', args, dependencies);
  assert.equal(result?.status, 'ok');
  assert.deepEqual(result?.scope, { project_codes: ['unson'] });
  const bad = await handleKnowledgeResolutionToolCall('brainbase_knowledge_resolve', args,
    { ...dependencies, companyAuthorityResponse: 'invalid!' });
  assert.equal(bad?.status, 'error');
  assert.equal(calls, 1);
  for (const status of [401, 403, 503]) {
    const denied = await handleKnowledgeResolutionToolCall('brainbase_knowledge_resolve', args,
      { ...dependencies, fetch: async () => new Response('{}', { status }) });
    assert.notEqual(denied?.status, 'ok');
  }
  const wrong = await handleKnowledgeResolutionToolCall('brainbase_knowledge_resolve', args,
    { ...dependencies, fetch: async () => new Response(JSON.stringify({ ...receipt, project_code: 'other' })) });
  assert.equal(wrong?.status, 'error');
});
