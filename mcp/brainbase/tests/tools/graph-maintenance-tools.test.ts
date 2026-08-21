import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
  it('6つの保守toolをproduction serverへ登録する', () => {
    const names = serverTesting.tools.map((tool) => tool.name);
    assert.deepEqual(graphMaintenanceTools.map((tool) => tool.name), [
      'graph_export_snapshot', 'graph_plan_mutations', 'graph_apply_plan',
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

  it('6つのtoolをREST契約どおりのmethod/path/bodyで呼ぶ', async () => {
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
    const expectedToken = await deps(async () => new Response('{}')).tokenManager.getToken();

    for (const testCase of cases) {
      let request: { url: string; init?: RequestInit } | undefined;
      const result = await handleGraphMaintenanceToolCall(testCase.name, testCase.args, deps(async (url, init) => {
        request = { url: String(url), init };
        return new Response(JSON.stringify(testCase.payload), { status: testCase.status });
      }));

      assert.deepEqual(result, {
        status: 'ok',
        scope: { project_codes: ['brainbase'] },
        data: testCase.payload,
      });
      assert.equal(request?.url, `http://brainbase.test${testCase.path}`);
      assert.equal(request?.init?.method, testCase.method);
      assert.equal(new Headers(request?.init?.headers).get('authorization'), `Bearer ${expectedToken}`);
      assert.equal(new Headers(request?.init?.headers).get('x-brainbase-projects'), 'brainbase');
      if (testCase.body) {
        assert.equal(new Headers(request?.init?.headers).get('content-type'), 'application/json');
        assert.deepEqual(JSON.parse(String(request?.init?.body)), testCase.body);
      } else {
        assert.equal(request?.init?.body, undefined);
        assert.equal(new Headers(request?.init?.headers).get('content-type'), null);
      }
    }
  });

  it('RESTの非2xx応答をstatus/error/http_statusへ変換する', async () => {
    const cases = [
      { name: 'graph_export_snapshot', args: { project_code: 'brainbase' } },
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
});
