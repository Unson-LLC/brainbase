import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { handleOnboardingToolCall, onboardingTools } from '../../src/tools/onboarding-tools.js';
import { __testing as serverTesting } from '../../src/server.js';

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    apiUrl: 'http://brainbase.test',
    configuredProjectCodes: ['brainbase'],
    tokenManager: { getToken: async () => jwt({ sub: 'per_owner', projectCodes: ['brainbase'] }) },
    fetch: async () => new Response(JSON.stringify({ id: 'onb_1', status: 'collecting' }), { status: 201 }),
    ...overrides,
  };
}

describe('Brainbase onboarding MCP tools', () => {
  it('production serverのtool listとdispatcherに全onboarding toolを登録する', async () => {
    const registered = serverTesting.tools.map((tool) => tool.name);
    for (const tool of onboardingTools) {
      assert.ok(registered.includes(tool.name), `missing tool: ${tool.name}`);
    }

    let fetched = false;
    const result = await serverTesting.dispatchOnboardingToolCall('brainbase_onboarding_get', {
      project_code: 'brainbase', run_id: 'onb_registered',
    }, dependencies({
      fetch: async () => {
        fetched = true;
        return new Response(JSON.stringify({ id: 'onb_registered', status: 'reviewing' }), { status: 200 });
      },
    }));
    assert.equal(fetched, true);
    assert.equal(result?.status, 'ok');
  });

  it('start toolは接続sourceを優先するAPIへBearerとscopeを渡す', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const result = await handleOnboardingToolCall('brainbase_onboarding_start', {
      project_code: 'brainbase', value_target: '最初の問い', source_mode: 'drive',
    }, dependencies({
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ id: 'onb_1', status: 'collecting' }), { status: 201 });
      },
    }));
    assert.ok(onboardingTools.some((tool) => tool.name === 'brainbase_onboarding_start'));
    assert.equal(result?.status, 'ok');
    assert.equal(calls[0].url, 'http://brainbase.test/api/onboarding/runs');
    assert.match(new Headers(calls[0].init?.headers).get('authorization') || '', /^Bearer /);
    assert.equal(new Headers(calls[0].init?.headers).get('x-brainbase-projects'), 'brainbase');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      project_code: 'brainbase', value_target: '最初の問い', source_mode: 'drive',
    });
  });

  it('全5 toolのHTTP method・URL・body契約を固定する', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const deps = dependencies({
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        const path = String(url);
        const payload = path.includes('/candidates/')
          ? { candidate: { id: 'cand_1', promotion_status: 'candidate' }, graph_entity_id: null }
          : { id: 'onb_1', status: 'reviewing' };
        return new Response(JSON.stringify(payload), { status: 200 });
      },
    });
    const cases = [
      ['brainbase_onboarding_get', { project_code: 'brainbase', run_id: 'run/1' }, 'GET', '/api/onboarding/runs/run%2F1', undefined],
      ['brainbase_onboarding_ingest', {
        project_code: 'brainbase', run_id: 'run/1',
        source: { mode: 'drive', collection_status: 'collected', source_id: 'f1', evidence_ref: 'f1#p1', content_hash: `sha256:${'a'.repeat(64)}`, permission_snapshot: { visibility: 'owner' } },
        candidates: [{ fact: 'fact', observation_class: 'observed', subject_type: 'org', evidence_id: 'f1#p1' }],
      }, 'POST', '/api/onboarding/runs/run%2F1/sources', ['source', 'candidates']],
      ['brainbase_onboarding_review', { project_code: 'brainbase', run_id: 'run/1', candidate_id: 'cand/1', decision: 'approve', reason: 'ok' }, 'POST', '/api/onboarding/runs/run%2F1/candidates/cand%2F1/review', ['decision', 'reason']],
      ['brainbase_onboarding_first_value', { project_code: 'brainbase', run_id: 'run/1', action: 'record', answer_hash: `sha256:${'b'.repeat(64)}`, used_graph_entity_ids: ['ent_1'], missing_context: [], presentation_contract_version: 'first_value_clarity.v1', presented_sections: ['覚えていたこと', 'つながったこと', '次にできること'] }, 'POST', '/api/onboarding/runs/run%2F1/first-value', ['answer_hash', 'used_graph_entity_ids', 'missing_context', 'presentation_contract_version', 'presented_sections']],
      ['brainbase_onboarding_first_value', { project_code: 'brainbase', run_id: 'run/1', action: 'review', verdict: 'useful' }, 'POST', '/api/onboarding/runs/run%2F1/first-value/review', ['verdict']],
    ] as const;

    for (const [name, args, method, path, bodyKeys] of cases) {
      const before = calls.length;
      const result = await handleOnboardingToolCall(name, args, deps);
      assert.equal(result?.status, 'ok');
      const call = calls[before];
      assert.equal(call.url, `http://brainbase.test${path}`);
      assert.equal(call.init?.method, method);
      if (bodyKeys) assert.deepEqual(Object.keys(JSON.parse(String(call.init?.body))), bodyKeys);
      else assert.equal(call.init?.body, undefined);
    }
  });

  it('not_usefulのfirst-value reviewをMCPからHTTP receiptへ透過する', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const receipt = {
      id: 'run/1',
      status: 'first_value_answer_reviewed',
      first_value_review: {
        verdict: 'not_useful',
        elapsed_ms: 600001,
        within_ten_minutes: false,
      },
    };
    const result = await handleOnboardingToolCall('brainbase_onboarding_first_value', {
      project_code: 'brainbase',
      run_id: 'run/1',
      action: 'review',
      verdict: 'not_useful',
    }, dependencies({
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify(receipt), { status: 200 });
      },
    }));

    assert.equal(calls[0].url, 'http://brainbase.test/api/onboarding/runs/run%2F1/first-value/review');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { verdict: 'not_useful' });
    assert.equal(result?.status, 'ok');
    assert.deepEqual(result?.data, receipt);
  });

  it('schema_failure: ingest・review・first-value schemaは必要な境界を宣言する', () => {
    const ingest = onboardingTools.find((tool) => tool.name === 'brainbase_onboarding_ingest');
    const review = onboardingTools.find((tool) => tool.name === 'brainbase_onboarding_review');
    const firstValue = onboardingTools.find((tool) => tool.name === 'brainbase_onboarding_first_value');
    const source = (ingest?.inputSchema.properties as Record<string, any>).source;
    const candidate = (ingest?.inputSchema.properties as Record<string, any>).candidates.items;
    const permissionSnapshot = source.properties.permission_snapshot;
    assert.deepEqual(source.required, ['mode', 'collection_status', 'source_id', 'evidence_ref', 'content_hash', 'permission_snapshot']);
    assert.deepEqual(candidate.required, ['fact', 'observation_class', 'subject_type', 'evidence_id']);
    assert.equal(permissionSnapshot.additionalProperties, false);
    assert.equal('visibility' in permissionSnapshot.properties, true);
    assert.equal('token' in permissionSnapshot.properties, false);
    assert.equal(review?.inputSchema.additionalProperties, false);
    assert.deepEqual((review?.inputSchema.properties as Record<string, any>).reason, {
      type: 'string', minLength: 1, maxLength: 500,
    });
    assert.equal(Array.isArray((firstValue?.inputSchema as any).allOf), true);
    assert.deepEqual((firstValue?.inputSchema as any).allOf[0].then.required, [
      'answer_hash', 'used_graph_entity_ids', 'presentation_contract_version', 'presented_sections',
    ]);
  });

  it('first-value action別required違反はfetch前にerrorにする', async () => {
    let fetched = false;
    const result = await handleOnboardingToolCall('brainbase_onboarding_first_value', {
      project_code: 'brainbase', run_id: 'onb_1', action: 'record',
    }, dependencies({ fetch: async () => { fetched = true; return new Response('{}'); } }));
    assert.equal(fetched, false);
    assert.equal(result?.status, 'error');
    assert.equal(result?.error?.code, 'brainbase_onboarding_input_invalid');
  });

  it('scope外projectはfetchせずerrorにする', async () => {
    const result = await handleOnboardingToolCall('brainbase_onboarding_start', {
      project_code: 'salestailor', value_target: '問い', source_mode: 'gmail',
    }, dependencies({ fetch: async () => { throw new Error('must not fetch'); } }));
    assert.equal(result?.status, 'error');
    assert.equal(result?.error?.code, 'brainbase_project_not_accessible');
  });

  it('ingestはquery・permission値に埋め込まれたcredential materialをfetch前に拒否する', async () => {
    for (const source of [
      {
        mode: 'drive', collection_status: 'collected', source_id: 'f-secret-query',
        evidence_ref: 'https://example.test/file?access_token=plaintext-secret',
        content_hash: `sha256:${'a'.repeat(64)}`, permission_snapshot: { visibility: 'owner' },
      },
      {
        mode: 'drive', collection_status: 'collected', source_id: 'f-secret-permission',
        evidence_ref: 'drive:f-secret-permission', content_hash: `sha256:${'a'.repeat(64)}`,
        permission_snapshot: { scope: 'access_token%3Dplaintext-secret' },
      },
      {
        mode: 'drive', collection_status: 'collected', source_id: 'f-secret-userinfo-space',
        evidence_ref: ' https://user:plaintext-secret@example.test/file',
        content_hash: `sha256:${'a'.repeat(64)}`, permission_snapshot: { visibility: 'owner' },
      },
      {
        mode: 'drive', collection_status: 'collected', source_id: 'f-secret-double-encoded',
        evidence_ref: 'https://example.test/file?access_token%253Dplaintext-secret',
        content_hash: `sha256:${'a'.repeat(64)}`, permission_snapshot: { visibility: 'owner' },
      },
      {
        mode: 'drive', collection_status: 'collected', source_id: 'f-secret-malformed-tail',
        evidence_ref: 'https://example.test/file?access_token%3Dplaintext-secret%ZZ',
        content_hash: `sha256:${'a'.repeat(64)}`, permission_snapshot: { visibility: 'owner' },
      },
      {
        mode: 'drive', collection_status: 'collected', source_id: 'f-secret-malformed-key',
        evidence_ref: 'https://example.test/file?access_token%ZZ=plaintext-secret',
        content_hash: `sha256:${'a'.repeat(64)}`, permission_snapshot: { visibility: 'owner' },
      },
      {
        mode: 'drive', collection_status: 'collected', source_id: 'f-secret-truncated-utf8-key',
        evidence_ref: 'https://example.test/file?access_token%E0%A4%A=plaintext-secret',
        content_hash: `sha256:${'a'.repeat(64)}`, permission_snapshot: { visibility: 'owner' },
      },
      {
        mode: 'drive', collection_status: 'collected', source_id: 'f-client-secret-query',
        evidence_ref: 'https://example.test/oauth?client_secret=plaintext-secret',
        content_hash: `sha256:${'a'.repeat(64)}`, permission_snapshot: { visibility: 'owner' },
      },
      {
        mode: 'drive', collection_status: 'collected', source_id: 'f-oauth-token-query',
        evidence_ref: 'https://example.test/oauth?oauth_token=plaintext-secret',
        content_hash: `sha256:${'a'.repeat(64)}`, permission_snapshot: { visibility: 'owner' },
      },
      {
        mode: 'drive', collection_status: 'collected', source_id: 'f-long-malformed-access-token',
        evidence_ref: 'https://example.test/file?access_token%ZZZZ=plaintext-secret',
        content_hash: `sha256:${'a'.repeat(64)}`, permission_snapshot: { visibility: 'owner' },
      },
      {
        mode: 'drive', collection_status: 'collected', source_id: 'f-long-malformed-client-secret',
        evidence_ref: 'https://example.test/oauth?client_secret%malformed=plaintext-secret',
        content_hash: `sha256:${'a'.repeat(64)}`, permission_snapshot: { visibility: 'owner' },
      },
      {
        mode: 'drive', collection_status: 'collected', source_id: 'f-long-malformed-oauth-token',
        evidence_ref: 'https://example.test/oauth?oauth_token%ZZZZ=plaintext-secret',
        content_hash: `sha256:${'a'.repeat(64)}`, permission_snapshot: { visibility: 'owner' },
      },
    ]) {
      let fetched = false;
      const result = await handleOnboardingToolCall('brainbase_onboarding_ingest', {
        project_code: 'brainbase', run_id: 'onb_1', source, candidates: [],
      }, dependencies({ fetch: async () => { fetched = true; return new Response('{}'); } }));
      assert.equal(fetched, false);
      assert.equal(result?.status, 'error');
      assert.equal(result?.error?.code, 'brainbase_onboarding_input_invalid');
    }

    for (const evidenceRef of ['drive:file-1#paragraph-2', 'https://example.test/file?id=public-123']) {
      let fetched = false;
      const result = await handleOnboardingToolCall('brainbase_onboarding_ingest', {
        project_code: 'brainbase', run_id: 'onb_1',
        source: {
          mode: 'drive', collection_status: 'collected', source_id: evidenceRef,
          evidence_ref: evidenceRef, content_hash: `sha256:${'a'.repeat(64)}`,
          permission_snapshot: { visibility: 'owner' },
        }, candidates: [],
      }, dependencies({ fetch: async () => { fetched = true; return new Response(JSON.stringify({ id: 'onb_1', status: 'reviewing' }), { status: 200 }); } }));
      assert.equal(fetched, true);
      assert.equal(result?.status, 'ok');
    }
  });

  it('reviewはsecret-likeまたは過長reasonをapprove/rejectともfetch前に拒否する', async () => {
    for (const decision of ['approve', 'reject']) {
      for (const reason of ['Bearer TOP_SECRET_TOKEN', 'x'.repeat(501)]) {
        let fetched = false;
        const result = await handleOnboardingToolCall('brainbase_onboarding_review', {
          project_code: 'brainbase', run_id: 'onb_1', candidate_id: 'cand_1', decision, reason,
        }, dependencies({ fetch: async () => { fetched = true; return new Response('{}'); } }));
        assert.equal(fetched, false);
        assert.equal(result?.status, 'error');
        assert.equal(result?.error?.code, 'brainbase_onboarding_input_invalid');
      }
    }
  });

  it('transport failureはconfirmed emptyではなくunavailableにする', async () => {
    const result = await handleOnboardingToolCall('brainbase_onboarding_get', {
      run_id: 'onb_1', project_code: 'brainbase',
    }, dependencies({ fetch: async () => { throw new Error('ECONNREFUSED'); } }));
    assert.equal(result?.status, 'unavailable');
    assert.equal(result?.error?.code, 'brainbase_api_unavailable');
    assert.equal('data' in (result || {}), false);
  });

  it('2xx empty payloadはconfirmed emptyとしてok、4xxはerror、5xxはunavailableに分ける', async () => {
    const args = { run_id: 'onb_1', project_code: 'brainbase' };
    const empty = await handleOnboardingToolCall('brainbase_onboarding_get', args, dependencies({
      fetch: async () => new Response(null, { status: 204 }),
    }));
    assert.deepEqual(empty, { status: 'ok', scope: { project_codes: ['brainbase'] }, data: null });

    const denied = await handleOnboardingToolCall('brainbase_onboarding_get', args, dependencies({
      fetch: async () => new Response(JSON.stringify({ error: { message: 'denied' } }), { status: 403 }),
    }));
    assert.equal(denied?.status, 'error');
    assert.equal(denied?.error?.http_status, 403);

    const unavailable = await handleOnboardingToolCall('brainbase_onboarding_get', args, dependencies({
      fetch: async () => new Response(JSON.stringify({ error: { message: 'db down' } }), { status: 503 }),
    }));
    assert.equal(unavailable?.status, 'unavailable');
    assert.equal(unavailable?.error?.http_status, 503);
  });

  it('parse_failure: malformed 2xx JSONを成功やconfirmed emptyに変換しない', async () => {
    const result = await handleOnboardingToolCall('brainbase_onboarding_get', {
      run_id: 'onb_1', project_code: 'brainbase',
    }, dependencies({
      fetch: async () => new Response('{broken', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    }));
    assert.equal(result?.status, 'error');
    assert.equal(result?.error?.code, 'brainbase_api_response_invalid');
    assert.equal(result?.error?.http_status, 200);
    assert.equal('data' in (result || {}), false);
  });

  it('schema_failure: credential-bearing responseを利用者へ返さない', async () => {
    const result = await handleOnboardingToolCall('brainbase_onboarding_get', {
      run_id: 'onb_1', project_code: 'brainbase',
    }, dependencies({
      fetch: async () => new Response(JSON.stringify({
        id: 'onb_1',
        nested: { client_secret: 'plaintext-secret' },
      }), { status: 200 }),
    }));
    assert.equal(result?.status, 'error');
    assert.equal(result?.error?.code, 'brainbase_api_response_invalid');
    assert.equal(result?.error?.http_status, 200);
    assert.equal('data' in (result || {}), false);
  });

  it('schema_failure: partial 2xx responseを成功扱いしない', async () => {
    for (const [name, payload] of [
      ['brainbase_onboarding_get', { id: 'onb_1' }],
      ['brainbase_onboarding_review', { candidate: { id: 'cand_1' }, graph_entity_id: null }],
    ] as const) {
      const result = await handleOnboardingToolCall(name, {
        run_id: 'onb_1', candidate_id: 'cand_1', decision: 'reject', project_code: 'brainbase',
      }, dependencies({
        fetch: async () => new Response(JSON.stringify(payload), { status: 200 }),
      }));
      assert.equal(result?.status, 'error');
      assert.equal(result?.error?.code, 'brainbase_api_response_invalid');
      assert.equal(result?.error?.http_status, 200);
      assert.equal('data' in (result || {}), false);
    }
  });

  it('credential-bearing 5xxは秘密を伏せたままunavailableを維持する', async () => {
    const result = await handleOnboardingToolCall('brainbase_onboarding_get', {
      run_id: 'onb_1', project_code: 'brainbase',
    }, dependencies({
      fetch: async () => new Response(JSON.stringify({
        error: { message: 'db down', client_secret: 'plaintext-secret' },
      }), { status: 503 }),
    }));
    assert.equal(result?.status, 'unavailable');
    assert.equal(result?.error?.code, 'brainbase_api_unavailable');
    assert.equal(result?.error?.http_status, 503);
    assert.equal(result?.error?.message, 'Brainbase API is unavailable');
    assert.equal(JSON.stringify(result).includes('plaintext-secret'), false);
    assert.equal('data' in (result || {}), false);
  });
});
