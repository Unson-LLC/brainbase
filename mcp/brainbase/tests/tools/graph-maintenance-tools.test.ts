import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { graphMaintenanceTools, handleGraphMaintenanceToolCall } from '../../src/tools/graph-maintenance-tools.js';
import { __testing as serverTesting } from '../../src/server.js';

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

const deps = (fetch: typeof globalThis.fetch, projectCodes = ['brainbase']) => ({
  apiUrl: 'http://brainbase.test', configuredProjectCodes: projectCodes, fetch,
  tokenManager: { getToken: async () => jwt({ sub: 'per_owner', projectCodes, organizationId: 'org_unson' }) },
});

describe('Graph maintenance MCP tools', () => {
  it('7つの保守toolをproduction serverへ登録する', () => {
    const names = serverTesting.tools.map((tool) => tool.name);
    assert.deepEqual(graphMaintenanceTools.map((tool) => tool.name), [
      'graph_export_snapshot', 'graph_record_human_gate_receipt', 'graph_plan_mutations', 'graph_apply_plan',
      'graph_get_plan_receipt', 'graph_rollback_plan', 'graph_validate',
    ]);
    for (const tool of graphMaintenanceTools) assert.ok(names.includes(tool.name), `missing tool: ${tool.name}`);
  });

  it('Bearerとproject scopeを付けてsnapshot APIを呼ぶ', async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const result = await handleGraphMaintenanceToolCall('graph_export_snapshot', { project_code: 'brainbase' }, deps(async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({ snapshot_id: 'gms_1', snapshot_hash: `sha256:${'a'.repeat(64)}`, entities: [], edges: [] }), { status: 201 });
    }));
    assert.equal(result?.status, 'ok');
    assert.equal(request?.url, 'http://brainbase.test/api/info/graph/maintenance/snapshots');
    assert.match(new Headers(request?.init?.headers).get('authorization') || '', /^Bearer /);
    assert.equal(new Headers(request?.init?.headers).get('x-brainbase-projects'), 'brainbase');
  });

  it('7つのtoolをREST契約どおりのmethod/path/bodyで呼ぶ', async () => {
    const snapshotHash = `sha256:${'a'.repeat(64)}`;
    const cases: Array<{
      name: string;
      args: Record<string, unknown>;
      method: string;
      path: string;
      body?: Record<string, unknown>;
      status: number;
      payload: Record<string, unknown>;
    }> = [
      {
        name: 'graph_export_snapshot',
        args: { project_code: 'brainbase' },
        method: 'POST',
        path: '/api/info/graph/maintenance/snapshots',
        body: { project_code: 'brainbase' },
        status: 201,
        payload: { snapshot_id: 'gms_1', snapshot_hash: snapshotHash, entities: [], edges: [] },
      },
      {
        name: 'graph_record_human_gate_receipt',
        args: { project_code: 'brainbase', decision_id: 'dec_1', receipt_id: 'gate_1', evidence: { operation_scope: { operation: 'link_decision_subject', decision_id: 'dec_1', decision_expected_version: 1, subject_entity_id: 'product_1', subject_expected_version: 1, target_project_code: 'aitle', expected_version: 0 }, source: 'human-review' } },
        method: 'POST',
        path: '/api/info/graph/maintenance/human-gate-receipts',
        body: { project_code: 'brainbase', decision_id: 'dec_1', receipt_id: 'gate_1', evidence: { operation_scope: { operation: 'link_decision_subject', decision_id: 'dec_1', decision_expected_version: 1, subject_entity_id: 'product_1', subject_expected_version: 1, target_project_code: 'aitle', expected_version: 0 }, source: 'human-review' } },
        status: 201,
        payload: { receipt_id: 'gate_1', decision_id: 'dec_1', status: 'approved' },
      },
      {
        name: 'graph_plan_mutations',
        args: {
          project_code: 'brainbase', snapshot_id: 'gms_1', idempotency_key: 'phase0-1',
          reason: 'contract test', operations: [],
        },
        method: 'POST',
        path: '/api/info/graph/maintenance/plans',
        body: {
          project_code: 'brainbase', snapshot_id: 'gms_1', idempotency_key: 'phase0-1',
          reason: 'contract test', operations: [],
        },
        status: 201,
        payload: { plan_id: 'gmp_1', status: 'planned', dry_run: true },
      },
      {
        name: 'graph_apply_plan',
        args: { project_code: 'brainbase', plan_id: 'gmp_1', snapshot_hash: snapshotHash },
        method: 'POST',
        path: '/api/info/graph/maintenance/plans/gmp_1/apply',
        body: { project_code: 'brainbase', snapshot_hash: snapshotHash },
        status: 200,
        payload: { receipt_id: 'gmr_apply_1', receipt_type: 'apply', status: 'completed' },
      },
      {
        name: 'graph_get_plan_receipt',
        args: { project_code: 'brainbase', plan_id: 'gmp_1' },
        method: 'GET',
        path: '/api/info/graph/maintenance/plans/gmp_1/receipt?project_code=brainbase',
        status: 200,
        payload: { plan_id: 'gmp_1', receipts: [] },
      },
      {
        name: 'graph_rollback_plan',
        args: { project_code: 'brainbase', plan_id: 'gmp_1', apply_receipt_id: 'gmr_apply_1' },
        method: 'POST',
        path: '/api/info/graph/maintenance/plans/gmp_1/rollback',
        body: { project_code: 'brainbase', apply_receipt_id: 'gmr_apply_1' },
        status: 200,
        payload: { receipt_id: 'gmr_rollback_1', receipt_type: 'rollback', status: 'completed' },
      },
      {
        name: 'graph_validate',
        args: { project_code: 'brainbase' },
        method: 'POST',
        path: '/api/info/graph/maintenance/validate',
        body: { project_code: 'brainbase' },
        status: 200,
        payload: { valid: true, snapshot_hash: snapshotHash },
      },
    ];
    for (const testCase of cases) {
      const projectCodes = testCase.name === 'graph_record_human_gate_receipt' ? ['brainbase', 'aitle'] : ['brainbase'];
      const expectedToken = await deps(async () => new Response('{}'), projectCodes).tokenManager.getToken();
      let request: { url: string; init?: RequestInit } | undefined;
      const result = await handleGraphMaintenanceToolCall(testCase.name, testCase.args, deps(async (url, init) => {
        request = { url: String(url), init };
        return new Response(JSON.stringify(testCase.payload), { status: testCase.status });
      }, projectCodes));

      assert.deepEqual(result, {
        status: 'ok',
        scope: { project_codes: projectCodes },
        data: testCase.payload,
      });
      assert.equal(request?.url, `http://brainbase.test${testCase.path}`);
      assert.equal(request?.init?.method, testCase.method);
      assert.equal(new Headers(request?.init?.headers).get('authorization'), `Bearer ${expectedToken}`);
      assert.equal(new Headers(request?.init?.headers).get('x-brainbase-projects'), projectCodes.join(','));
      if (testCase.body) {
        assert.equal(new Headers(request?.init?.headers).get('content-type'), 'application/json');
        assert.deepEqual(JSON.parse(String(request?.init?.body)), testCase.body);
      } else {
        assert.equal(request?.init?.body, undefined);
        assert.equal(new Headers(request?.init?.headers).get('content-type'), null);
      }
    }
  });

  it('Apply receiptは公開schema上任意でDecision Planだけserverが必須化する', () => {
    const applyTool = graphMaintenanceTools.find((tool) => tool.name === 'graph_apply_plan');
    assert.ok(applyTool);
    assert.deepEqual(applyTool.inputSchema.required, ['project_code', 'plan_id', 'snapshot_hash']);
    assert.ok('human_gate_receipt' in applyTool.inputSchema.properties);
  });

  it('Apply receiptのsuppression_summaryはzero-count reasonを拒否する', () => {
    const receiptTool = graphMaintenanceTools.find((tool) => tool.name === 'graph_record_human_gate_receipt');
    const scopeSchema = receiptTool?.inputSchema.properties?.evidence?.properties?.operation_scope;
    assert.ok(scopeSchema && 'oneOf' in scopeSchema);
    const applyScopeSchema = scopeSchema.oneOf.find((variant: any) => (
      variant.properties.operation.enum[0] === 'apply_plan'
    ));
    assert.ok(applyScopeSchema);
    const suppressionSummarySchema = applyScopeSchema.properties.suppression_summary;
    const validate = new Ajv({ strict: false }).compile(suppressionSummarySchema);

    assert.equal(validate({
      before: { edge_count: 1, reasons: { noncanonical_cross_tenant_marker: 0 } },
      after: { edge_count: 0, reasons: {} },
    }), false);
  });

  it('RESTの非2xx応答をstatus/error/http_statusへ変換する', async () => {
    const cases = [
      { name: 'graph_export_snapshot', args: { project_code: 'brainbase' } },
      { name: 'graph_record_human_gate_receipt', args: { project_code: 'brainbase', decision_id: 'dec_1', receipt_id: 'gate_1' } },
      { name: 'graph_plan_mutations', args: { project_code: 'brainbase', snapshot_id: 'gms_1', idempotency_key: 'k', reason: 'r', operations: [] } },
      { name: 'graph_apply_plan', args: { project_code: 'brainbase', plan_id: 'gmp_1', snapshot_hash: `sha256:${'a'.repeat(64)}` } },
      { name: 'graph_get_plan_receipt', args: { project_code: 'brainbase', plan_id: 'gmp_1' } },
      { name: 'graph_rollback_plan', args: { project_code: 'brainbase', plan_id: 'gmp_1', apply_receipt_id: 'gmr_1' } },
      { name: 'graph_validate', args: { project_code: 'brainbase' } },
    ];

    for (const testCase of cases) {
      const result = await handleGraphMaintenanceToolCall(testCase.name, testCase.args, deps(async () => (
        new Response(JSON.stringify({ error: 'snapshot hash conflict' }), { status: 409, statusText: 'Conflict' })
      )));
      assert.deepEqual(result, {
        status: 'error',
        scope: { project_codes: ['brainbase'] },
        error: {
          code: 'graph_maintenance_api_error',
          message: 'snapshot hash conflict',
          http_status: 409,
        },
      });
    }
  });

  it('RESTの構造化codeとdetailsをMCP利用者へ保持する', async () => {
    const details = { expected_operation_scope: { operation: 'link_decision_subject', decision_id: 'dec_1' } };
    const result = await handleGraphMaintenanceToolCall('graph_plan_mutations', {
      project_code: 'brainbase', snapshot_id: 'gms_1', idempotency_key: 'k', reason: 'r', operations: [],
    }, deps(async () => new Response(JSON.stringify({
      error: 'Human Gate receipt does not approve this Decision subject operation',
      code: 'GRAPH_HUMAN_GATE_SCOPE_MISMATCH',
      details,
    }), { status: 409, statusText: 'Conflict' })));

    assert.deepEqual(result, {
      status: 'error',
      scope: { project_codes: ['brainbase'] },
      error: {
        code: 'GRAPH_HUMAN_GATE_SCOPE_MISMATCH',
        message: 'Human Gate receipt does not approve this Decision subject operation',
        http_status: 409,
        details,
      },
    });
  });

  it('JSONでないREST応答を成功として扱わない', async () => {
    const result = await handleGraphMaintenanceToolCall('graph_validate', { project_code: 'brainbase' }, deps(async () => (
      new Response('upstream unavailable', { status: 200 })
    )));
    assert.equal(result?.status, 'error');
    assert.equal(result?.error?.code, 'graph_maintenance_response_invalid');
    assert.equal(result?.error?.http_status, 200);
  });

  it('scope外projectはHTTPへ到達する前に拒否する', async () => {
    let fetched = false;
    const result = await handleGraphMaintenanceToolCall('graph_validate', { project_code: 'other' }, deps(async () => {
      fetched = true;
      return new Response('{}');
    }));
    assert.equal(fetched, false);
    assert.equal(result?.status, 'error');
    assert.equal(result?.error?.code, 'brainbase_project_not_accessible');
  });

  it('Human Gateのtarget project scope外はHTTPへ到達する前にstructured scope errorを返す', async () => {
    let fetched = false;
    const result = await handleGraphMaintenanceToolCall('graph_record_human_gate_receipt', {
      project_code: 'brainbase', decision_id: 'dec_1', receipt_id: 'gate_1',
      evidence: { operation_scope: {
        operation: 'link_decision_subject', decision_id: 'dec_1', decision_expected_version: 1,
        subject_entity_id: 'product_aitle', subject_expected_version: 1,
        target_project_code: 'aitle', expected_version: 0,
      } },
    }, deps(async () => {
      fetched = true;
      return new Response('{}', { status: 201 });
    }));

    assert.equal(fetched, false);
    assert.deepEqual(result, {
      status: 'error',
      scope: { project_codes: ['brainbase'] },
      error: {
        code: 'brainbase_project_not_accessible',
        message: 'Project is not accessible: aitle',
      },
    });
  });

  it('cross-scope snapshotとrehome targetは全scopeのpreflightを要求する', async () => {
    let body;
    const ok = await handleGraphMaintenanceToolCall('graph_export_snapshot', {
      project_code: 'brainbase', include_project_codes: ['vibepro'],
    }, deps(async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ snapshot_id: 'gms_cross' }), { status: 201 });
    }, ['brainbase', 'vibepro']));
    assert.equal(ok?.status, 'ok');
    assert.deepEqual(body, { project_code: 'brainbase', include_project_codes: ['vibepro'] });

    let validateBody;
    const validated = await handleGraphMaintenanceToolCall('graph_validate', {
      project_code: 'brainbase', include_project_codes: ['vibepro'],
    }, deps(async (_url, init) => {
      validateBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ valid: true }));
    }, ['brainbase', 'vibepro']));
    assert.equal(validated?.status, 'ok');
    assert.deepEqual(validateBody, { project_code: 'brainbase', include_project_codes: ['vibepro'] });

    let fetched = false;
    const denied = await handleGraphMaintenanceToolCall('graph_plan_mutations', {
      project_code: 'brainbase', snapshot_id: 'gms_cross', idempotency_key: 'rehome-1', reason: 'rehome',
      operations: [{ operation: 'rehome_entity', entity_id: 'dec_1', expected_version: 1,
        target_project_code: 'aitle', target_project_entity_id: 'prj_aitle', target_project_expected_version: 1,
        membership_edge_id: 'edg_old', membership_expected_version: 1, new_membership_expected_version: 0 }],
    }, deps(async () => { fetched = true; return new Response('{}'); }));
    assert.equal(fetched, false);
    assert.equal(denied?.status, 'error');
    assert.equal(denied?.error?.code, 'brainbase_project_not_accessible');
  });

  it('Decision subject linkはtarget project scopeをHTTP前に要求する', async () => {
    const receiptTool = graphMaintenanceTools.find((tool) => tool.name === 'graph_record_human_gate_receipt');
    const evidenceSchema = receiptTool?.inputSchema.properties?.evidence;
    assert.ok(evidenceSchema && 'additionalProperties' in evidenceSchema);
    assert.equal(evidenceSchema.additionalProperties, false);
    assert.deepEqual(evidenceSchema.required, ['operation_scope']);
    assert.deepEqual(Object.keys(evidenceSchema.properties).sort(), ['operation_scope', 'reason', 'review_ref', 'source']);
    const scopeSchema = evidenceSchema.properties.operation_scope;
    assert.ok(scopeSchema && 'oneOf' in scopeSchema);
    assert.deepEqual(scopeSchema.oneOf.map((variant: any) => variant.properties.operation.enum[0]), [
      'link_decision_subject', 'link_decision_project_subject', 'apply_plan', 'retire_entity',
    ]);
    const applyScopeSchema = scopeSchema.oneOf.find((variant: any) => (
      variant.properties.operation.enum[0] === 'apply_plan'
    ));
    assert.ok(applyScopeSchema);
    assert.equal(applyScopeSchema.required.includes('decision_ids'), false);
    assert.deepEqual(applyScopeSchema.properties.decision_ids, {
      type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, uniqueItems: true,
    });
    assert.ok(applyScopeSchema.required.includes('suppression_summary'));
    assert.deepEqual(applyScopeSchema.properties.suppression_summary, {
      type: 'object',
      properties: {
        before: {
          type: 'object',
          properties: {
            edge_count: { type: 'integer', minimum: 0 },
            reasons: {
              type: 'object',
              properties: {
                noncanonical_cross_tenant_marker: { type: 'integer', minimum: 1 },
                unresolved_or_inaccessible_endpoint: { type: 'integer', minimum: 1 },
              },
              additionalProperties: false,
            },
          },
          required: ['edge_count', 'reasons'],
          additionalProperties: false,
        },
        after: {
          type: 'object',
          properties: {
            edge_count: { type: 'integer', minimum: 0 },
            reasons: {
              type: 'object',
              properties: {
                noncanonical_cross_tenant_marker: { type: 'integer', minimum: 1 },
                unresolved_or_inaccessible_endpoint: { type: 'integer', minimum: 1 },
              },
              additionalProperties: false,
            },
          },
          required: ['edge_count', 'reasons'],
          additionalProperties: false,
        },
      },
      required: ['before', 'after'],
      additionalProperties: false,
    });
    assert.equal(applyScopeSchema.additionalProperties, false);

    const planTool = graphMaintenanceTools.find((tool) => tool.name === 'graph_plan_mutations');
    const operationSchema = planTool?.inputSchema.properties?.operations?.items;
    assert.ok(operationSchema && 'properties' in operationSchema);
    assert.ok(operationSchema.properties.operation.enum.includes('link_decision_subject'));

    let fetched = false;
    const denied = await handleGraphMaintenanceToolCall('graph_plan_mutations', {
      project_code: 'brainbase', snapshot_id: 'gms_cross', idempotency_key: 'subject-1', reason: 'subject link',
      operations: [{ operation: 'link_decision_subject', decision_id: 'dec_1', decision_expected_version: 1,
        subject_entity_id: 'product_aitle', subject_expected_version: 1, target_project_code: 'aitle', expected_version: 0 }],
    }, deps(async () => { fetched = true; return new Response('{}'); }));
    assert.equal(fetched, false);
    assert.equal(denied?.status, 'error');
    assert.equal(denied?.error?.code, 'brainbase_project_not_accessible');

    let body: Record<string, unknown> | undefined;
    const operation = {
      operation: 'link_decision_subject', decision_id: 'dec_1', decision_expected_version: 2,
      subject_entity_id: 'product_aitle', subject_expected_version: 4,
      target_project_code: 'aitle', expected_version: 0,
    };
    const allowed = await handleGraphMaintenanceToolCall('graph_plan_mutations', {
      project_code: 'brainbase', snapshot_id: 'gms_cross', idempotency_key: 'subject-2',
      reason: 'subject link', human_gate_receipt: 'gate_1', operations: [operation],
    }, deps(async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ plan_id: 'gmp_subject', status: 'planned', dry_run: true }), { status: 201 });
    }, ['brainbase', 'aitle']));
    assert.equal(allowed?.status, 'ok');
    assert.deepEqual(body, {
      project_code: 'brainbase', snapshot_id: 'gms_cross', idempotency_key: 'subject-2',
      reason: 'subject link', human_gate_receipt: 'gate_1', operations: [operation],
    });
  });

  it('Project subject materialize/linkを必要fieldとHuman Gate scope付きで公開する', async () => {
    const receiptTool = graphMaintenanceTools.find((tool) => tool.name === 'graph_record_human_gate_receipt');
    const scopeSchema = receiptTool?.inputSchema.properties?.evidence?.properties?.operation_scope;
    assert.ok(scopeSchema && 'oneOf' in scopeSchema);
    assert.ok(scopeSchema.oneOf.some((variant: any) => (
      variant.properties.operation.enum[0] === 'link_decision_project_subject'
      && variant.required.includes('target_project_code')
      && variant.required.includes('subject_expected_version')
    )));

    const planTool = graphMaintenanceTools.find((tool) => tool.name === 'graph_plan_mutations');
    const operationSchema = planTool?.inputSchema.properties?.operations?.items;
    assert.ok(operationSchema && 'properties' in operationSchema);
    assert.ok(operationSchema.properties.operation.enum.includes('materialize_project_subject'));
    assert.ok(operationSchema.properties.operation.enum.includes('link_decision_project_subject'));
    assert.ok('catalog_project_id' in operationSchema.properties);
    for (const serverOwnedField of ['catalog_version', 'name', 'source_ref']) {
      assert.ok(!(serverOwnedField in operationSchema.properties), `server-owned field leaked: ${serverOwnedField}`);
    }

    let fetched = false;
    const denied = await handleGraphMaintenanceToolCall('graph_record_human_gate_receipt', {
      project_code: 'brainbase', decision_id: 'dec_ua', receipt_id: 'gate_ua',
      evidence: { operation_scope: {
        operation: 'link_decision_project_subject', decision_id: 'dec_ua', decision_expected_version: 1,
        subject_entity_id: 'brainbase-universal-arts-ai-support', subject_expected_version: 1,
        target_project_code: 'universal-arts', expected_version: 0,
      } },
    }, deps(async () => { fetched = true; return new Response('{}', { status: 201 }); }));
    assert.equal(fetched, false);
    assert.equal(denied?.status, 'error');
    assert.equal(denied?.error?.code, 'brainbase_project_not_accessible');

    const operations = [{
      operation: 'materialize_project_subject',
      catalog_project_id: 'brainbase-universal-arts-ai-support', expected_version: 0,
    }, {
      operation: 'link_decision_project_subject',
      decision_id: 'dec_ua', decision_expected_version: 1,
      subject_entity_id: 'brainbase-universal-arts-ai-support', subject_expected_version: 1,
      target_project_code: 'brainbase', edge_id: 'edge_ua_subject', expected_version: 0,
      human_gate_receipt: 'gate_ua',
    }];
    let body: Record<string, unknown> | undefined;
    const allowed = await handleGraphMaintenanceToolCall('graph_plan_mutations', {
      project_code: 'brainbase', snapshot_id: 'gms_ua', idempotency_key: 'ua-subject-1',
      reason: 'materialize and link project subject', human_gate_receipt: 'gate_ua', operations,
    }, deps(async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ plan_id: 'gmp_ua', status: 'planned', dry_run: true }), { status: 201 });
    }));
    assert.equal(allowed?.status, 'ok');
    assert.deepEqual(body, {
      project_code: 'brainbase', snapshot_id: 'gms_ua', idempotency_key: 'ua-subject-1',
      reason: 'materialize and link project subject', human_gate_receipt: 'gate_ua', operations,
    });
  });
});
