import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalJson,
  computeJudgmentRequestDigest,
  createJudgmentBindingHeaders,
  handleJudgmentResolutionToolCall,
  judgmentResolutionTools,
} from '../../src/tools/judgment-resolution-tools.js';
import {
  canProceedWithAction,
  normalizeJudgmentHostResult,
  runManagedJudgmentTurn,
} from '../../src/tools/judgment-host-contract.js';
import { __testing as serverTesting } from '../../src/server.js';

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

const args = {
  request: 'この文章の意味を説明して', turn_id: 'host-turn-mcp', project_code: 'brainbase',
  classification_proposal: {
    intent: 'answer', domains: ['general'], action_kind: 'none', risk: 'low', confidence: 'confirmed', signals: [],
  },
};

function receipt(overrides: Record<string, unknown> = {}) {
  const value: Record<string, unknown> = {
    resolution_id: 'jr_mcp', resolved_at: '2026-08-07T00:00:00.000Z', turn_id: args.turn_id,
    request_digest: computeJudgmentRequestDigest(args), context_digest: null, status: 'resolved', runtime_version: 'judgment-runtime-v1', manifest_digest: 'b'.repeat(64),
    host_binding: { adapter_id: 'brainbase-mcp', adapter_version: '1', status: 'managed', enforcement_level: 'host_contract' },
    project_code: 'brainbase', classification_proposal: args.classification_proposal,
    classification: args.classification_proposal, classification_assurance: 'verified', reconciliation_reasons: [],
    selected_dag_ids: ['direct.v1'], applicable_policies: [], suppressed_policies: [], required_capabilities: [],
    active_nodes: ['entry', 'reconcile', 'goal', 'direct-answer', 'merge', 'receipt'],
    active_node_definitions: [
      ['entry', 'common'], ['reconcile', 'common'], ['goal', 'judgment'], ['direct-answer', 'judgment'], ['merge', 'common'], ['receipt', 'common'],
    ].map(([id, kind]) => ({ id, kind, instruction: `Execute ${id}.`, required_capability_template: null })),
    active_edges: [['entry', 'reconcile'], ['reconcile', 'goal'], ['goal', 'direct-answer'], ['direct-answer', 'merge'], ['merge', 'receipt']],
    unresolved: [], rationale: ['resolved'],
  };
  Object.assign(value, overrides);
  const planValue = { ...value };
  delete planValue.resolution_id;
  delete planValue.resolved_at;
  delete planValue.request_digest;
  delete planValue.plan_digest;
  value.plan_digest = createHash('sha256').update(canonicalJson(planValue)).digest('hex');
  if (Object.hasOwn(overrides, 'plan_digest')) value.plan_digest = overrides.plan_digest;
  return value;
}

describe('judgment resolution MCP tool', () => {
  // Trace: story-brainbase-judgment-resolver-v1:ac:2 story-brainbase-judgment-resolver-v1:ac:13
  it('tool listへ公開し署名済みbinding headersでAPIを呼ぶ', async () => {
    assert.ok(serverTesting.tools.some((tool) => tool.name === 'brainbase_judgment_resolve'));
    assert.equal(judgmentResolutionTools.length, 1);
    assert.ok('conversation_context' in (judgmentResolutionTools[0].inputSchema.properties ?? {}));
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const result = await handleJudgmentResolutionToolCall('brainbase_judgment_resolve', args, {
      apiUrl: 'http://brainbase.test', configuredProjectCodes: ['brainbase'], bindingSecret: 'mcp-secret',
      adapterId: 'brainbase-mcp', adapterVersion: '1', now: () => new Date('2026-08-07T00:00:00.000Z'),
      tokenManager: { getToken: async () => jwt({ projectCodes: ['brainbase'] }) },
      fetch: async (url, init) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(receipt()), { status: 200 }); },
    });
    assert.equal(calls[0].url, 'http://brainbase.test/api/judgment/resolve');
    assert.equal((calls[0].init?.headers as Record<string, string>)['x-brainbase-judgment-adapter'], 'brainbase-mcp');
    assert.match((calls[0].init?.headers as Record<string, string>)['x-brainbase-judgment-signature'], /^[a-f0-9]{64}$/);
    assert.equal(result?.status, 'ok');
  });

  it('optional signalsを省略したhost proposalも空配列へ正規化してreceiptを検証する', async () => {
    const { signals: _signals, ...proposalWithoutSignals } = args.classification_proposal;
    const argsWithoutSignals = {
      ...args,
      classification_proposal: proposalWithoutSignals,
    };
    const normalizedProposal = { ...proposalWithoutSignals, signals: [] };
    const normalizedReceipt = receipt({
      request_digest: computeJudgmentRequestDigest(argsWithoutSignals),
      classification_proposal: normalizedProposal,
      classification: normalizedProposal,
    });
    const result = await handleJudgmentResolutionToolCall('brainbase_judgment_resolve', argsWithoutSignals, {
      apiUrl: 'http://brainbase.test', configuredProjectCodes: ['brainbase'], bindingSecret: 'mcp-secret',
      adapterId: 'brainbase-mcp', adapterVersion: '1', now: () => new Date('2026-08-07T00:00:00.000Z'),
      tokenManager: { getToken: async () => jwt({ projectCodes: ['brainbase'] }) },
      fetch: async () => new Response(JSON.stringify(normalizedReceipt), { status: 200 }),
    });
    assert.equal(result?.status, 'ok');
  });

  it('repository共有goldenとcross-runtime bindingを満たす', () => {
    const goldenPath = fileURLToPath(new URL('../../../../config/judgment-runtime-golden-vectors.json', import.meta.url));
    const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as {
      canonical_json: { input: unknown; expected_bytes: string; expected_sha256: string };
      binding: {
        request: typeof args; secret: string; adapter_id: string; adapter_version: string; issued_at: string;
        expected_request_digest: string; expected_payload_bytes: string; expected_signature: string;
      };
    };
    const canonical = canonicalJson(golden.canonical_json.input);
    assert.equal(canonical, golden.canonical_json.expected_bytes);
    assert.equal(createHash('sha256').update(canonical).digest('hex'), golden.canonical_json.expected_sha256);

    const headers = createJudgmentBindingHeaders(golden.binding.request, {
      bindingSecret: golden.binding.secret,
      adapterId: golden.binding.adapter_id,
      adapterVersion: golden.binding.adapter_version,
      issuedAt: golden.binding.issued_at,
    });
    const payload = canonicalJson([
      'brainbase-judgment-binding-v1', golden.binding.adapter_id, golden.binding.adapter_version,
      golden.binding.request.turn_id, golden.binding.issued_at, golden.binding.expected_request_digest,
    ]);
    assert.equal(headers['x-brainbase-judgment-request-digest'], golden.binding.expected_request_digest);
    assert.equal(payload, golden.binding.expected_payload_bytes);
    assert.equal(headers['x-brainbase-judgment-signature'], golden.binding.expected_signature);
  });

  it('receiptを同じturn・request・adapter bindingへ再束縛する', async () => {
    const deps = (payload: Record<string, unknown>) => ({
      apiUrl: 'http://brainbase.test', configuredProjectCodes: ['brainbase'], bindingSecret: 'secret',
      adapterId: 'brainbase-mcp', adapterVersion: '1', now: () => new Date('2026-08-07T00:00:00.000Z'),
      tokenManager: { getToken: async () => jwt({ projectCodes: ['brainbase'] }) },
      fetch: async () => new Response(JSON.stringify(payload), { status: 200 }),
    });
    const wrongTurn = await handleJudgmentResolutionToolCall('brainbase_judgment_resolve', args, deps(receipt({ turn_id: 'other-turn' })));
    const wrongRequest = await handleJudgmentResolutionToolCall('brainbase_judgment_resolve', args, deps(receipt({ request_digest: '0'.repeat(64) })));
    const wrongAdapter = await handleJudgmentResolutionToolCall('brainbase_judgment_resolve', args, deps(receipt({
      host_binding: { adapter_id: 'other-adapter', adapter_version: '1', status: 'managed', enforcement_level: 'host_contract' },
    })));
    for (const result of [wrongTurn, wrongRequest, wrongAdapter]) {
      assert.equal(result?.error?.code, 'brainbase_api_response_invalid');
    }
  });

  it('4xx・network・invalid receiptを区別する', async () => {
    const deps = (fetch: typeof globalThis.fetch) => ({
      apiUrl: 'http://brainbase.test', configuredProjectCodes: ['brainbase'], bindingSecret: 'secret',
      adapterId: 'brainbase-mcp', adapterVersion: '1', now: () => new Date('2026-08-07T00:00:00.000Z'),
      tokenManager: { getToken: async () => jwt({ projectCodes: ['brainbase'] }) }, fetch,
    });
    const denied = await handleJudgmentResolutionToolCall('brainbase_judgment_resolve', args, deps(async () => new Response(JSON.stringify({ error: { message: 'binding rejected' } }), { status: 403 })));
    assert.equal(denied?.status, 'error');
    assert.equal(denied?.error?.http_status, 403);

    const unavailable = await handleJudgmentResolutionToolCall('brainbase_judgment_resolve', args, deps(async () => { throw new Error('ECONNREFUSED'); }));
    assert.equal(unavailable?.status, 'unavailable');

    const serverFailure = await handleJudgmentResolutionToolCall('brainbase_judgment_resolve', args, deps(async () => new Response(JSON.stringify({ error: { message: 'down' } }), { status: 503 })));
    assert.equal(serverFailure?.status, 'unavailable');
    assert.equal(serverFailure?.error?.code, 'brainbase_api_unavailable');

    const invalid = await handleJudgmentResolutionToolCall('brainbase_judgment_resolve', args, deps(async () => new Response(JSON.stringify({ status: 'resolved' }), { status: 200 })));
    assert.equal(invalid?.error?.code, 'brainbase_api_response_invalid');
  });

  for (const [label, overrides] of [
    ['timestamp', { resolved_at: 'not-a-date' }],
    ['project', { project_code: 'wrong-project' }],
    ['assurance', { classification_assurance: 123 }],
    ['edge', { active_edges: [123] }],
    ['node definition', { active_node_definitions: [] }],
    ['policy', { applicable_policies: [123] }],
    ['required capability content type', { required_capabilities: [{
      capability: 'knowledge.resolve', status: 'required', receipt_required: true,
      input: { intent: 'lookup', audience: 'team', content_type: 'invented_type' },
    }] }],
    ['required capability missing project', { required_capabilities: [{
      capability: 'knowledge.resolve', status: 'required', receipt_required: true,
      input: { intent: 'lookup', audience: 'team', content_type: 'canonical_fact' },
    }] }],
    ['required capability mismatched project', { required_capabilities: [{
      capability: 'knowledge.resolve', status: 'required', receipt_required: true,
      input: { intent: 'lookup', audience: 'team', content_type: 'canonical_fact', project_code: 'other' },
    }] }],
    ['general mixed with engineering', { classification: {
      ...args.classification_proposal, domains: ['general', 'engineering'],
    } }],
    ['plan digest', { plan_digest: '0'.repeat(64) }],
  ] as const) {
    it(`malformed ${label} receiptをmanagedとして受理しない`, async () => {
      const dependencies = {
        apiUrl: 'http://brainbase.test', configuredProjectCodes: ['brainbase'], bindingSecret: 'secret',
        adapterId: 'brainbase-mcp', adapterVersion: '1', now: () => new Date('2026-08-07T00:00:00.000Z'),
        tokenManager: { getToken: async () => jwt({ projectCodes: ['brainbase'] }) },
        fetch: async () => new Response(JSON.stringify(receipt(overrides)), { status: 200 }),
      };
      const result = await handleJudgmentResolutionToolCall('brainbase_judgment_resolve', args, dependencies);
      assert.equal(result?.error?.code, 'brainbase_api_response_invalid');
    });
  }

  it('本番dispatcherが共通managed/unmanaged host resultを返す', async () => {
    const dependencies = {
      apiUrl: 'http://brainbase.test', configuredProjectCodes: ['brainbase'], bindingSecret: 'secret',
      adapterId: 'brainbase-mcp', adapterVersion: '1', now: () => new Date('2026-08-07T00:00:00.000Z'),
      tokenManager: { getToken: async () => jwt({ projectCodes: ['brainbase'] }) },
      fetch: async () => new Response(JSON.stringify(receipt()), { status: 200 }),
    };
    const managed = await serverTesting.dispatchJudgmentResolutionToolCall('brainbase_judgment_resolve', args, dependencies);
    assert.equal(managed?.management_status, 'managed');
    assert.equal(managed?.receipt?.resolution_id, 'jr_mcp');

    const unmanaged = await serverTesting.dispatchJudgmentResolutionToolCall('brainbase_judgment_resolve', args, {
      ...dependencies,
      fetch: async () => new Response(JSON.stringify({ error: { message: 'denied' } }), { status: 403 }),
    });
    assert.equal(unmanaged?.management_status, 'unmanaged');
    assert.equal(unmanaged?.receipt, null);
    assert.ok((unmanaged?.warning ?? '').length > 0);
  });

  for (const [status, overrides] of [
    ['needs_classification', {
      status: 'needs_classification', classification: null, classification_assurance: 'unknown',
      unresolved: ['classification'], rationale: ['clarify'],
    }],
    ['needs_policy_resolution', {
      status: 'needs_policy_resolution', unresolved: ['policy_conflict'], rationale: ['resolve policy conflict'],
    }],
  ] as const) {
    it(`${status} receiptをMCPシリアライズ後もmanagedとして表示する`, async () => {
      const result = await serverTesting.dispatchJudgmentResolutionToolCall('brainbase_judgment_resolve', args, {
        apiUrl: 'http://brainbase.test', configuredProjectCodes: ['brainbase'], bindingSecret: 'secret',
        adapterId: 'brainbase-mcp', adapterVersion: '1', now: () => new Date('2026-08-07T00:00:00.000Z'),
        tokenManager: { getToken: async () => jwt({ projectCodes: ['brainbase'] }) },
        fetch: async () => new Response(JSON.stringify(receipt(overrides)), { status: 200 }),
      });
      const serialized = JSON.parse(JSON.stringify(result));
      assert.equal(serialized.management_status, 'managed');
      assert.equal(serialized.receipt.status, status);
    });
  }

  it('GRAPH_API_URL-only構成でpreflightと同じURLを本番dispatcherが使う', async () => {
    const originalEnv = { ...process.env };
    try {
      delete process.env.BRAINBASE_RESOLVED_API_URL;
      delete process.env.BRAINBASE_API_URL;
      delete process.env.BRAINBASE_API_BASE_URL;
      process.env.BRAINBASE_GRAPH_API_URL = 'https://graph-only.example.com/';
      process.env.BRAINBASE_JUDGMENT_BINDING_SECRET = 'secret';
      const fetchCalls: string[] = [];
      const dependencies = {
        ...serverTesting.createDefaultJudgmentResolutionDependencies(),
        configuredProjectCodes: ['brainbase'],
        tokenManager: { getToken: async () => jwt({ projectCodes: ['brainbase'] }) },
        fetch: async (url: string | URL | globalThis.Request) => {
          fetchCalls.push(String(url));
          return new Response(JSON.stringify(receipt()), { status: 200 });
        },
      };

      const result = await serverTesting.dispatchJudgmentResolutionToolCall(
        'brainbase_judgment_resolve',
        args,
        dependencies,
      );

      assert.equal(result?.management_status, 'managed');
      assert.deepEqual(fetchCalls, ['https://graph-only.example.com/api/judgment/resolve']);
    } finally {
      process.env = originalEnv;
    }
  });

  it('仕様違反receiptを本番fan-inでmanagedに格上げない', async () => {
    const malformed = receipt({
      classification: { ...args.classification_proposal, domains: ['general', 'engineering'] },
      required_capabilities: [{
        capability: 'knowledge.resolve', status: 'required', receipt_required: true,
        input: { intent: 'lookup', audience: 'team', content_type: 'invented_type' },
      }],
    });
    const result = await serverTesting.dispatchJudgmentResolutionToolCall('brainbase_judgment_resolve', args, {
      apiUrl: 'http://brainbase.test', configuredProjectCodes: ['brainbase'], bindingSecret: 'secret',
      adapterId: 'brainbase-mcp', adapterVersion: '1', now: () => new Date('2026-08-07T00:00:00.000Z'),
      tokenManager: { getToken: async () => jwt({ projectCodes: ['brainbase'] }) },
      fetch: async () => new Response(JSON.stringify(malformed), { status: 200 }),
    });
    assert.equal(result?.management_status, 'unmanaged');
    assert.equal(result?.receipt, null);
    assert.ok((result?.warning ?? '').length > 0);
  });
});

describe('judgment host contract', () => {
  // Trace: story-brainbase-judgment-resolver-v1:ac:3
  for (const [label, toolResult] of [
    ['unavailable tool', { status: 'unavailable', scope: { project_codes: [] }, error: { code: 'down', message: 'down' } }],
    ['missing receipt', { status: 'ok', scope: { project_codes: ['brainbase'] } }],
    ['binding 403', { status: 'error', scope: { project_codes: ['brainbase'] }, error: { code: 'brainbase_api_error', message: 'denied', http_status: 403 } }],
  ] as const) {
    it(`${label}をvisible unmanagedへ落とす`, () => {
      const result = normalizeJudgmentHostResult(toolResult);
      assert.equal(result.management_status, 'unmanaged');
      assert.equal(result.receipt, null);
      assert.ok(result.warning.length > 0);
      assert.equal(canProceedWithAction(result, 'write'), false);
      assert.equal(canProceedWithAction(result, 'external'), false);
    });
  }

  it('managed receiptでもaction authorizationを主張しない', () => {
    const result = normalizeJudgmentHostResult({ status: 'ok', scope: { project_codes: ['brainbase'] }, data: receipt() });
    assert.equal(result.management_status, 'managed');
    assert.equal(canProceedWithAction(result, 'read'), true);
    assert.equal(canProceedWithAction(result, 'write'), false);
  });

  it('managed turnはResolverを一度だけ通りactive node definitionsを実行側へ渡す', async () => {
    let resolveCalls = 0;
    let continueCalls = 0;
    const management = normalizeJudgmentHostResult({ status: 'ok', scope: { project_codes: ['brainbase'] }, data: receipt() });
    const result = await runManagedJudgmentTurn({
      resolve: async () => { resolveCalls += 1; return management; },
      actionKind: 'read',
      continueTurn: ({ activeNodeDefinitions }) => {
        continueCalls += 1;
        assert.deepEqual(activeNodeDefinitions.map((node) => node.id), management.receipt?.active_nodes);
        return 'continued';
      },
    });
    assert.equal(resolveCalls, 1);
    assert.equal(continueCalls, 1);
    assert.equal(result.execution_status, 'continued');
    assert.equal(result.output, 'continued');
  });

  for (const [label, management, actionKind] of [
    ['unavailable', normalizeJudgmentHostResult({ status: 'unavailable', scope: { project_codes: [] }, error: { code: 'down', message: 'down' } }), 'read'],
    ['missing receipt', normalizeJudgmentHostResult({ status: 'ok', scope: { project_codes: ['brainbase'] } }), 'read'],
    ['binding denial', normalizeJudgmentHostResult({ status: 'error', scope: { project_codes: ['brainbase'] }, error: { code: 'denied', message: 'denied', http_status: 403 } }), 'external'],
    ['invalid receipt', normalizeJudgmentHostResult({ status: 'error', scope: { project_codes: ['brainbase'] }, error: { code: 'brainbase_api_response_invalid', message: 'invalid' } }), 'write'],
    ['unresolved receipt', normalizeJudgmentHostResult({ status: 'ok', scope: { project_codes: ['brainbase'] }, data: receipt({
      status: 'needs_classification', classification: null, classification_assurance: 'unknown',
      reconciliation_reasons: ['general_not_server_supported'], selected_dag_ids: ['clarification.v1'],
      active_nodes: ['entry', 'reconcile', 'clarification', 'receipt'],
      active_node_definitions: [
        ['entry', 'common'], ['reconcile', 'common'], ['clarification', 'fail_closed'], ['receipt', 'common'],
      ].map(([id, kind]) => ({ id, kind, instruction: `Execute ${id}.`, required_capability_template: null })),
      active_edges: [['entry', 'reconcile'], ['reconcile', 'clarification'], ['clarification', 'receipt']],
      unresolved: ['classification'], rationale: ['clarify'],
    }) }), 'read'],
  ] as const) {
    it(`${label}では後続write・external・応答生成を実行しない`, async () => {
      let continueCalls = 0;
      const result = await runManagedJudgmentTurn({
        resolve: async () => management,
        actionKind,
        continueTurn: () => { continueCalls += 1; return 'must-not-run'; },
      });
      assert.equal(result.execution_status, 'stopped');
      assert.equal(result.output, null);
      assert.equal(continueCalls, 0);
      assert.ok(result.warning.length > 0);
      if (label === 'unresolved receipt') assert.equal(result.management_status, 'managed');
    });
  }

  it('列挙外action kindを独立認可や後続処理へ渡さずfail-closedにする', async () => {
    const management = normalizeJudgmentHostResult({ status: 'ok', scope: { project_codes: ['brainbase'] }, data: receipt() });
    let authorizationCalls = 0;
    let continueCalls = 0;
    const result = await runManagedJudgmentTurn({
      resolve: async () => management,
      actionKind: 'delete' as unknown as 'read',
      authorizeAction: () => { authorizationCalls += 1; return true; },
      continueTurn: () => { continueCalls += 1; return 'must-not-run'; },
    });
    assert.equal(result.management_status, 'managed');
    assert.equal(result.execution_status, 'stopped');
    assert.equal(result.reason, 'judgment_action_kind_invalid');
    assert.equal(authorizationCalls, 0);
    assert.equal(continueCalls, 0);
  });

  it('resolved receiptでもwrite・externalは別のaction authorizationなしに実行しない', async () => {
    const management = normalizeJudgmentHostResult({ status: 'ok', scope: { project_codes: ['brainbase'] }, data: receipt() });
    for (const actionKind of ['write', 'external'] as const) {
      let continueCalls = 0;
      const result = await runManagedJudgmentTurn({
        resolve: async () => management,
        actionKind,
        continueTurn: () => { continueCalls += 1; return 'must-not-run'; },
      });
      assert.equal(result.reason, 'judgment_receipt_is_not_action_authorization');
      assert.equal(result.execution_status, 'stopped');
      assert.equal(continueCalls, 0);
    }
  });

  it('write・externalはJudgmentと独立したaction authorizationが成功した場合だけ継続する', async () => {
    const management = normalizeJudgmentHostResult({ status: 'ok', scope: { project_codes: ['brainbase'] }, data: receipt() });
    for (const actionKind of ['write', 'external'] as const) {
      let authorizationCalls = 0;
      let continueCalls = 0;
      const result = await runManagedJudgmentTurn({
        resolve: async () => management,
        actionKind,
        authorizeAction: ({ actionKind: authorizedKind, receipt: authorizedReceipt, activeNodeDefinitions }) => {
          authorizationCalls += 1;
          assert.equal(authorizedKind, actionKind);
          assert.equal(authorizedReceipt, management.receipt);
          assert.deepEqual(activeNodeDefinitions.map((node) => node.id), management.receipt?.active_nodes);
          return true;
        },
        continueTurn: () => { continueCalls += 1; return 'authorized'; },
      });
      assert.equal(authorizationCalls, 1);
      assert.equal(continueCalls, 1);
      assert.equal(result.execution_status, 'continued');
      assert.equal(result.output, 'authorized');
    }
  });
});
