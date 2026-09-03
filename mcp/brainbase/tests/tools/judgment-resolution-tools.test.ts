import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalJson,
  computeJudgmentRequestDigest,
  createJudgmentBindingHeaders,
  handleJudgmentResolutionToolCall,
  judgmentResolutionTools,
  resolveJudgmentBeforeModel,
} from '../../src/tools/judgment-resolution-tools.js';
import {
  normalizeJudgmentHostResult,
  runManagedJudgmentTurn,
} from '../../src/tools/judgment-host-contract.js';
import { __testing as serverTesting } from '../../src/server.js';

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

const contextWithoutDigest = {
  schema_version: 'brainbase-conversation-context-v1',
  session_ref: 'a'.repeat(64),
  messages: [{ sequence: 0, turn_id: 'host-turn-mcp', role: 'user', phase: null, text: 'この文章の意味を説明して' }],
  prior_receipts: [],
  runtime: { host: 'codex', model: 'gpt-5', permission_mode: 'workspace-write', project_binding: 'brainbase' },
  instruction_bindings: [],
  completeness: 'complete',
};

const args = {
  request: 'この文章の意味を説明して',
  turn_id: 'host-turn-mcp',
  project_code: 'brainbase',
  conversation_context: {
    ...contextWithoutDigest,
    source_digest: createHash('sha256').update(canonicalJson(contextWithoutDigest)).digest('hex'),
  },
};

const classification = {
  intent: 'answer', domains: ['general'], action_kind: 'none', risk: 'low', confidence: 'confirmed', signals: [],
};

function receipt(overrides: Record<string, unknown> = {}) {
  const value: Record<string, unknown> = {
    resolution_id: 'jr_mcp',
    resolved_at: '2026-08-07T00:00:00.000Z',
    turn_id: args.turn_id,
    request_digest: computeJudgmentRequestDigest(args),
    context_digest: createHash('sha256').update(canonicalJson(args.conversation_context)).digest('hex'),
    status: 'resolved',
    autonomy_decision: 'continue',
    autonomy_reason_code: 'routine_in_scope',
    allowed_runtime_escalation_reasons: [
      'irreversible_action', 'missing_authority', 'owner_value_choice',
      'required_input_unavailable', 'evidenced_terminal_blocker',
    ],
    autonomy_policy_ids: [],
    runtime_version: 'judgment-runtime-2.1.0',
    manifest_digest: 'b'.repeat(64),
    host_binding: { adapter_id: 'brainbase-mcp', adapter_version: '1', status: 'managed', enforcement_level: 'host_contract' },
    project_code: 'brainbase',
    classification,
    classification_evidence: { source: 'current_request', source_turn_ids: [args.turn_id], matcher_ids: ['intent:answer'] },
    classification_assurance: 'verified',
    reconciliation_reasons: [],
    selected_dag_ids: ['direct.v1'],
    applicable_policies: [],
    suppressed_policies: [],
    required_capabilities: [],
    active_nodes: ['entry', 'reconcile', 'goal', 'direct-answer', 'merge', 'receipt'],
    active_node_definitions: [
      ['entry', 'common'], ['reconcile', 'common'], ['goal', 'judgment'],
      ['direct-answer', 'judgment'], ['merge', 'common'], ['receipt', 'common'],
    ].map(([id, kind]) => ({ id, kind, instruction: `Execute ${id}.`, required_capability_template: null })),
    active_edges: [['entry', 'reconcile'], ['reconcile', 'goal'], ['goal', 'direct-answer'], ['direct-answer', 'merge'], ['merge', 'receipt']],
    unresolved: [],
    rationale: ['resolved'],
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

function dependencies(fetchImpl: typeof globalThis.fetch, configuredProjectCodes = ['brainbase']) {
  return {
    apiUrl: 'http://brainbase.test',
    configuredProjectCodes,
    bindingSecret: 'mcp-secret',
    adapterId: 'brainbase-mcp',
    adapterVersion: '1',
    now: () => new Date('2026-08-07T00:00:00.000Z'),
    tokenManager: { getToken: async () => jwt({ projectCodes: ['brainbase'] }) },
    fetch: fetchImpl,
  };
}

describe('judgment resolver Host bridge', () => {
  it('resolve_turnをmodel-callable toolとして公開しmodel解釈を原文へ結合する', async () => {
    assert.deepEqual(judgmentResolutionTools.map((tool) => tool.name), ['brainbase_resolve_turn']);
    assert.equal(serverTesting.tools.some((tool) => tool.name === 'brainbase_resolve_turn'), true);
    const mergedArgs = { ...args, model_interpretation: classification };
    let posted: unknown = null;
    const result = await handleJudgmentResolutionToolCall('brainbase_resolve_turn', {
      turn_input: args,
      model_interpretation: classification,
    }, dependencies(async (_url, init) => {
      posted = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(receipt({
        request_digest: computeJudgmentRequestDigest(mergedArgs),
      })), { status: 200 });
    }));
    assert.equal(result?.status, 'ok');
    assert.deepEqual(posted, mergedArgs);
  });

  it('turn_input_path参照ならjournal内のturn-inputファイルをserver側で読み込む', async () => {
    const mergedArgs = { ...args, model_interpretation: classification };
    const journalRoot = mkdtempSync(join(tmpdir(), 'brainbase-judgment-journal-'));
    mkdirSync(join(journalRoot, 'session-ref'));
    const path = join(journalRoot, 'session-ref', 'turn-ref.turn-input.json');
    writeFileSync(path, JSON.stringify(args));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'brainbase-outside-'));
    const outsidePath = join(outsideRoot, 'turn-ref.turn-input.json');
    writeFileSync(outsidePath, JSON.stringify(args));
    let posted: unknown = null;
    const deps = {
      ...dependencies(async (_url, init) => {
        posted = JSON.parse(String(init?.body));
        return new Response(JSON.stringify(receipt({
          request_digest: computeJudgmentRequestDigest(mergedArgs),
        })), { status: 200 });
      }),
      judgmentJournalRoot: journalRoot,
    };
    try {
      const result = await handleJudgmentResolutionToolCall('brainbase_resolve_turn', {
        turn_input: { turn_input_path: path },
        model_interpretation: classification,
      }, deps);
      assert.equal(result?.status, 'ok');
      assert.deepEqual(posted, mergedArgs);
      const outside = await handleJudgmentResolutionToolCall('brainbase_resolve_turn', {
        turn_input: { turn_input_path: outsidePath },
        model_interpretation: classification,
      }, deps);
      assert.equal(outside?.status, 'error');
      const missing = await handleJudgmentResolutionToolCall('brainbase_resolve_turn', {
        turn_input: { turn_input_path: join(journalRoot, 'missing.turn-input.json') },
        model_interpretation: classification,
      }, deps);
      assert.equal(missing?.status, 'error');
    } finally {
      rmSync(journalRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it('turn_refならjournal内のturn-inputファイルをserver側で読み込み、JSONもpathもmodelを経由しない', async () => {
    const mergedArgs = { ...args, model_interpretation: classification };
    const journalRoot = mkdtempSync(join(tmpdir(), 'brainbase-judgment-journal-'));
    const sessionRef = 'a'.repeat(64);
    const turnRef = 'b'.repeat(64);
    mkdirSync(join(journalRoot, sessionRef));
    writeFileSync(join(journalRoot, sessionRef, `${turnRef}.turn-input.json`), JSON.stringify(args));
    let posted: unknown = null;
    const deps = {
      ...dependencies(async (_url, init) => {
        posted = JSON.parse(String(init?.body));
        return new Response(JSON.stringify(receipt({
          request_digest: computeJudgmentRequestDigest(mergedArgs),
        })), { status: 200 });
      }),
      judgmentJournalRoot: journalRoot,
    };
    try {
      const result = await handleJudgmentResolutionToolCall('brainbase_resolve_turn', {
        turn_ref: `${sessionRef}/${turnRef}`,
        model_interpretation: classification,
      }, deps);
      assert.equal(result?.status, 'ok');
      assert.deepEqual(posted, mergedArgs);

      // Legacy cached tool schema: old Codex threads still send a turn_input
      // object, but its content may itself be {"turn_ref": "..."}.
      posted = null;
      const legacy = await handleJudgmentResolutionToolCall('brainbase_resolve_turn', {
        turn_input: { turn_ref: `${sessionRef}/${turnRef}` },
        model_interpretation: classification,
      }, deps);
      assert.equal(legacy?.status, 'ok');
      assert.deepEqual(posted, mergedArgs);

      const malformed = await handleJudgmentResolutionToolCall('brainbase_resolve_turn', {
        turn_ref: 'not-a-valid-ref',
        model_interpretation: classification,
      }, deps);
      assert.equal(malformed?.status, 'error');

      const missing = await handleJudgmentResolutionToolCall('brainbase_resolve_turn', {
        turn_ref: `${sessionRef}/${'c'.repeat(64)}`,
        model_interpretation: classification,
      }, deps);
      assert.equal(missing?.status, 'error');
    } finally {
      rmSync(journalRoot, { recursive: true, force: true });
    }
  });

  it('Host内部callだけが署名付きAPI requestを送る', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const result = await resolveJudgmentBeforeModel(args, dependencies(async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(receipt()), { status: 200 });
    }));
    assert.equal(result.status, 'ok');
    assert.equal(calls[0].url, 'http://brainbase.test/api/judgment/resolve');
    assert.equal(JSON.parse(String(calls[0].init?.body)).conversation_context.schema_version, 'brainbase-conversation-context-v1');
    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(headers['x-brainbase-judgment-adapter'], 'brainbase-mcp');
    assert.match(headers['x-brainbase-judgment-signature'], /^[a-f0-9]{64}$/u);
  });

  it('project bindingは判断文脈でありMCP authが判断全体を先に拒否しない', async () => {
    let called = false;
    const outsideArgs = {
      ...args,
      project_code: 'salestailor',
      conversation_context: {
        ...args.conversation_context,
        runtime: { ...args.conversation_context.runtime, project_binding: 'salestailor' },
      },
    };
    const outsideReceipt = receipt({
      request_digest: computeJudgmentRequestDigest(outsideArgs),
      context_digest: createHash('sha256').update(canonicalJson(outsideArgs.conversation_context)).digest('hex'),
      project_code: 'salestailor',
    });
    const result = await resolveJudgmentBeforeModel(outsideArgs, dependencies(async () => {
      called = true;
      return new Response(JSON.stringify(outsideReceipt), { status: 200 });
    }));
    assert.equal(called, true);
    assert.equal(result.status, 'ok');
  });

  it('repository共有goldenとcross-runtime bindingを満たす', () => {
    const path = fileURLToPath(new URL('../../../../config/judgment-runtime-golden-vectors.json', import.meta.url));
    const golden = JSON.parse(readFileSync(path, 'utf8'));
    const headers = createJudgmentBindingHeaders(golden.binding.request, {
      bindingSecret: golden.binding.secret,
      adapterId: golden.binding.adapter_id,
      adapterVersion: golden.binding.adapter_version,
      issuedAt: golden.binding.issued_at,
    });
    assert.equal(headers['x-brainbase-judgment-request-digest'], golden.binding.expected_request_digest);
    assert.equal(headers['x-brainbase-judgment-signature'], golden.binding.expected_signature);
  });

  it('receiptをturn・request・context・adapterへ再束縛する', async () => {
    for (const invalid of [
      receipt({ turn_id: 'other-turn' }),
      receipt({ request_digest: '0'.repeat(64) }),
      receipt({ context_digest: '0'.repeat(64) }),
      receipt({ host_binding: { adapter_id: 'other', adapter_version: '1', status: 'managed', enforcement_level: 'host_contract' } }),
      receipt({ classification_evidence: null }),
      receipt({ autonomy_decision: 'escalate' }),
      receipt({ autonomy_reason_code: 'risk_or_external' }),
      receipt({ allowed_runtime_escalation_reasons: ['missing_authority'] }),
    ]) {
      const result = await resolveJudgmentBeforeModel(args, dependencies(async () => new Response(JSON.stringify(invalid), { status: 200 })));
      assert.equal(result.error?.code, 'brainbase_api_response_invalid');
    }
  });

  it('model解釈なしのbootstrap receiptはserverのreconciliation reasonsをunresolvedとして受理する', async () => {
    const bootstrap = receipt({
      status: 'needs_classification',
      autonomy_decision: 'escalate',
      autonomy_reason_code: 'classification_missing',
      allowed_runtime_escalation_reasons: [],
      runtime_version: 'judgment-runtime-2.4.3',
      classification: null,
      classification_evidence: { source: 'resolver', source_turn_ids: [], matcher_ids: [] },
      classification_assurance: 'unknown',
      reconciliation_reasons: ['model_interpretation_missing'],
      selected_dag_ids: ['clarification.v1'],
      active_nodes: ['entry', 'reconcile', 'clarification', 'receipt'],
      active_node_definitions: [
        ['entry', 'common'], ['reconcile', 'common'], ['clarification', 'fail_closed'], ['receipt', 'common'],
      ].map(([id, kind]) => ({ id, kind, instruction: `Execute ${id}.`, required_capability_template: null })),
      active_edges: [['entry', 'reconcile'], ['reconcile', 'clarification'], ['clarification', 'receipt']],
      unresolved: ['model_interpretation_missing'],
      rationale: ['Model semantic interpretation is required before the server can issue a TurnContract.'],
    });
    const accepted = await resolveJudgmentBeforeModel(args, dependencies(async () => new Response(JSON.stringify(bootstrap), { status: 200 })));
    assert.equal(accepted.status, 'ok');

    const mismatch = receipt({ ...bootstrap, unresolved: ['classification'] });
    const rejected = await resolveJudgmentBeforeModel(args, dependencies(async () => new Response(JSON.stringify(mismatch), { status: 200 })));
    assert.equal(rejected.error?.code, 'brainbase_api_response_invalid');
  });

  it('API 4xxの具体的なvalidation codeを隠さない', async () => {
    const result = await resolveJudgmentBeforeModel(args, dependencies(async () => new Response(JSON.stringify({
      error: { code: 'judgment_resolution_input_invalid', message: 'conversation_context is required' },
    }), { status: 400 })));
    assert.equal(result.status, 'error');
    assert.equal(result.error?.code, 'judgment_resolution_input_invalid');
    assert.equal(result.error?.http_status, 400);
  });

  it('production dispatcherはHost向けmanaged/unmanaged resultに正規化する', async () => {
    const managed = await serverTesting.dispatchJudgmentResolutionBeforeModel(
      args,
      dependencies(async () => new Response(JSON.stringify(receipt()), { status: 200 })),
    );
    assert.equal(managed.management_status, 'managed');
    assert.equal(managed.receipt?.resolution_id, 'jr_mcp');

    const unmanaged = await serverTesting.dispatchJudgmentResolutionBeforeModel(
      args,
      dependencies(async () => new Response(JSON.stringify({ error: { code: 'denied', message: 'denied' } }), { status: 403 })),
    );
    assert.equal(unmanaged.management_status, 'unmanaged');
    assert.equal(unmanaged.receipt, null);
  });
});

describe('judgment Host contract', () => {
  it('unmanaged resultではmodel生成を開始しない', async () => {
    let continued = false;
    const result = await runManagedJudgmentTurn({
      resolve: async () => normalizeJudgmentHostResult({
        status: 'unavailable', scope: { project_codes: [] }, error: { code: 'down', message: 'down' },
      }),
      continueTurn: () => { continued = true; return 'must-not-run'; },
    });
    assert.equal(result.execution_status, 'stopped');
    assert.equal(continued, false);
  });

  it('accepted receiptはturn内で一度だけ取得してactive DAGをmodel境界へ渡す', async () => {
    let resolveCalls = 0;
    let continueCalls = 0;
    const management = normalizeJudgmentHostResult({ status: 'ok', scope: { project_codes: ['brainbase'] }, data: receipt() });
    const result = await runManagedJudgmentTurn({
      resolve: async () => { resolveCalls += 1; return management; },
      continueTurn: ({ receipt: accepted, activeNodeDefinitions }) => {
        continueCalls += 1;
        assert.equal(accepted, management.receipt);
        assert.deepEqual(activeNodeDefinitions.map((node) => node.id), management.receipt?.active_nodes);
        return 'continued';
      },
    });
    assert.equal(resolveCalls, 1);
    assert.equal(continueCalls, 1);
    assert.equal(result.execution_status, 'continued');
  });

  it('clarification receiptも判断済みなのでmodelに質問を生成させる', async () => {
    const clarification = receipt({
      status: 'needs_classification',
      classification: null,
      classification_evidence: { source: 'resolver', source_turn_ids: [], matcher_ids: [] },
      classification_assurance: 'unknown',
      reconciliation_reasons: ['conversation_referent_missing'],
      selected_dag_ids: ['clarification.v1'],
      active_nodes: ['entry', 'reconcile', 'clarification', 'receipt'],
      active_node_definitions: [
        ['entry', 'common'], ['reconcile', 'common'], ['clarification', 'fail_closed'], ['receipt', 'common'],
      ].map(([id, kind]) => ({ id, kind, instruction: `Execute ${id}.`, required_capability_template: null })),
      active_edges: [['entry', 'reconcile'], ['reconcile', 'clarification'], ['clarification', 'receipt']],
      unresolved: ['conversation_referent_missing'],
      rationale: ['clarify'],
    });
    let continued = false;
    const result = await runManagedJudgmentTurn({
      resolve: async () => normalizeJudgmentHostResult({ status: 'ok', scope: { project_codes: ['brainbase'] }, data: clarification }),
      continueTurn: () => { continued = true; return 'ask'; },
    });
    assert.equal(result.management_status, 'managed');
    assert.equal(result.execution_status, 'continued');
    assert.equal(continued, true);
  });

  it('active node definitionsがないreceiptはmodel境界で停止する', async () => {
    const management = normalizeJudgmentHostResult({ status: 'ok', scope: { project_codes: ['brainbase'] }, data: { resolution_id: 'jr', host_binding: { status: 'managed' } } });
    const result = await runManagedJudgmentTurn({ resolve: async () => management, continueTurn: () => 'must-not-run' });
    assert.equal(result.execution_status, 'stopped');
    assert.equal(result.reason, 'judgment_active_node_definitions_missing');
  });
});
