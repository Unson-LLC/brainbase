import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  controlPlaneTools,
  handleControlPlaneToolCall,
} from '../../src/tools/control-plane-tools.js';
import { __testing as serverTesting } from '../../src/server.js';

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.`;
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    apiUrl: 'http://brainbase.test',
    configuredProjectCodes: ['brainbase', 'salestailor'],
    tokenManager: {
      getToken: async () => jwt({
        sub: 'per_keigo',
        role: 'member',
        projectCodes: ['brainbase', 'unson'],
      }),
    },
    fetch: async () => new Response(JSON.stringify([
      { id: 'brainbase', name: 'Brainbase', healthStatus: 'mapped' },
      { id: 'unson', name: 'Unson', healthStatus: 'unmapped' },
      { id: 'salestailor', name: 'SalesTailor', healthStatus: 'unavailable' },
    ]), { status: 200, headers: { 'content-type': 'application/json' } }),
    now: () => new Date('2026-07-16T03:04:05.000Z'),
    requestId: () => 'req_control_001',
    ...overrides,
  };
}

describe('Brainbase MCP control-plane tools', () => {
  it('TSK-WEBRET-003 AC-1: project catalog tool is discoverable without caller-supplied scope', () => {
    const tool = controlPlaneTools.find((candidate) => candidate.name === 'brainbase_projects');

    assert.ok(tool);
    assert.deepEqual(tool.inputSchema.properties, {});
    assert.ok(serverTesting.tools.some((candidate) => candidate.name === 'brainbase_projects'));
  });

  it('TSK-WEBRET-003 AC-2: token and configured scopes are intersected and audit evidence is returned', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const result = await handleControlPlaneToolCall('brainbase_projects', {}, dependencies({
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify([
          { id: 'brainbase', name: 'Brainbase', healthStatus: 'mapped' },
          { id: 'unson', name: 'Unson', healthStatus: 'unmapped' },
          { id: 'salestailor', name: 'SalesTailor', healthStatus: 'unavailable' },
        ]), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    }));

    assert.equal(result?.status, 'ok');
    assert.deepEqual(result?.data.projects.map((project) => project.id), ['brainbase']);
    assert.deepEqual(result?.scope.project_codes, ['brainbase']);
    assert.deepEqual(result?.audit, {
      request_id: 'req_control_001',
      tool: 'brainbase_projects',
      operation: 'read',
      actor: 'per_keigo',
      role: 'member',
      project_codes: ['brainbase'],
      observed_at: '2026-07-16T03:04:05.000Z',
      source: 'http://brainbase.test/api/brainbase/projects',
    });
    assert.equal(calls.length, 1);
    assert.equal(new Headers(calls[0].init?.headers).get('x-brainbase-projects'), 'brainbase');
    assert.match(new Headers(calls[0].init?.headers).get('authorization') || '', /^Bearer /);
    assert.doesNotMatch(JSON.stringify(result), /eyJ/);
  });

  it('TSK-WEBRET-003 AC-3: a confirmed empty catalog remains ok instead of unavailable', async () => {
    const result = await handleControlPlaneToolCall('brainbase_projects', {}, dependencies({
      fetch: async () => new Response('[]', { status: 200 }),
    }));

    assert.equal(result?.status, 'ok');
    assert.deepEqual(result?.data.projects, []);
    assert.equal(result?.data.count, 0);
  });

  it('TSK-WEBRET-003 AC-4: transport failure is unavailable and never flattened to an empty catalog', async () => {
    const result = await handleControlPlaneToolCall('brainbase_projects', {}, dependencies({
      fetch: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    }));

    assert.equal(result?.status, 'unavailable');
    assert.equal(result?.error.code, 'brainbase_api_unavailable');
    assert.match(result?.error.message || '', /ECONNREFUSED/);
    assert.equal('data' in (result || {}), false);
    assert.equal(result?.audit.request_id, 'req_control_001');
  });

  it('TSK-WEBRET-003 AC-5: auth rejection is a structured error with audit evidence', async () => {
    const result = await handleControlPlaneToolCall('brainbase_projects', {}, dependencies({
      fetch: async () => new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        statusText: 'Unauthorized',
      }),
    }));

    assert.equal(result?.status, 'error');
    assert.equal(result?.error.code, 'brainbase_auth_rejected');
    assert.equal(result?.error.http_status, 401);
    assert.equal(result?.audit.actor, 'per_keigo');
    assert.equal('data' in (result || {}), false);
  });

  it('TSK-WEBRET-007 AC-1: bootstrap config is available without a browser download', async () => {
    const calls: string[] = [];
    const result = await handleControlPlaneToolCall('brainbase_bootstrap_config', {}, dependencies({
      fetch: async (url: string | URL | Request) => {
        calls.push(String(url));
        return new Response(JSON.stringify({
          ok: true,
          user: {
            id: 'per_keigo',
            name: '佐藤圭吾',
            slackUserId: 'U123',
            workspaceId: 'T123',
          },
          projects: [{ id: 'brainbase', name: 'Brainbase' }],
          configWriteMode: 'create_only',
          configYaml: 'workspace_root: ${HOME}/workspace\nprojects:\n  - id: brainbase\n',
        }), { status: 200 });
      },
    }));

    assert.ok(controlPlaneTools.some((candidate) => candidate.name === 'brainbase_bootstrap_config'));
    assert.ok(serverTesting.tools.some((candidate) => candidate.name === 'brainbase_bootstrap_config'));
    assert.equal(result?.status, 'ok');
    assert.equal(result?.data?.bootstrap_config?.user.id, 'per_keigo');
    assert.equal(result?.data?.bootstrap_config?.config_write_mode, 'create_only');
    assert.deepEqual(result?.data?.bootstrap_config?.projects.map((project) => project.id), ['brainbase']);
    assert.match(result?.data?.bootstrap_config?.config_yaml || '', /workspace_root/);
    assert.equal(result?.data?.count, 1);
    assert.deepEqual(calls, ['http://brainbase.test/api/setup/config']);
    assert.equal(result?.audit.source, calls[0]);
  });

  it('TSK-WEBRET-007 AC-2: bootstrap config rejects projects outside authenticated scope', async () => {
    const result = await handleControlPlaneToolCall('brainbase_bootstrap_config', {}, dependencies({
      fetch: async () => new Response(JSON.stringify({
        ok: true,
        user: {
          id: 'per_keigo',
          name: '佐藤圭吾',
          slackUserId: 'U123',
          workspaceId: 'T123',
        },
        projects: [{ id: 'salestailor', name: 'SalesTailor' }],
        configWriteMode: 'create_only',
        configYaml: 'projects:\n  - id: salestailor\n',
      }), { status: 200 }),
    }));

    assert.equal(result?.status, 'error');
    assert.equal(result?.error?.code, 'brainbase_contract_error');
    assert.match(result?.error?.message || '', /outside the authenticated scope/);
  });

  it('TSK-WEBRET-007 AC-3: Admin diagnostics are discoverable through one read-only tool', () => {
    const tool = controlPlaneTools.find((candidate) => candidate.name === 'brainbase_admin_read');

    assert.ok(tool);
    assert.ok(serverTesting.tools.some((candidate) => candidate.name === 'brainbase_admin_read'));
    assert.deepEqual(tool.inputSchema.required, ['view']);
    assert.deepEqual(tool.inputSchema.properties?.view.enum, [
      'overview',
      'graph_entities',
      'candidates',
      'personal_kg',
      'context_preview',
      'data_flow',
      'health',
    ]);
  });

  it('TSK-WEBRET-007 AC-4: Admin Graph reads forward filters and reject scope expansion', async () => {
    const calls: string[] = [];
    const result = await handleControlPlaneToolCall('brainbase_admin_read', {
      view: 'graph_entities',
      project: 'brainbase',
      type: 'decision',
      limit: 25,
    }, dependencies({
      fetch: async (url: string | URL | Request) => {
        calls.push(String(url));
        return new Response(JSON.stringify({
          source_class: 'graph_ssot',
          status: 'available',
          records: [],
        }), { status: 200 });
      },
    }));
    const rejected = await handleControlPlaneToolCall('brainbase_admin_read', {
      view: 'graph_entities',
      project: 'salestailor',
    }, dependencies({
      fetch: async () => {
        throw new Error('must not fetch');
      },
    }));

    assert.equal(result?.status, 'ok');
    assert.equal(result?.data?.admin_result?.source_class, 'graph_ssot');
    assert.deepEqual(calls, [
      'http://brainbase.test/api/admin/graph/entities?project=brainbase&type=decision&limit=25',
    ]);
    assert.equal(result?.audit.operation, 'read');
    assert.equal(rejected?.status, 'error');
    assert.equal(rejected?.error?.code, 'brainbase_project_not_accessible');
  });

  it('forwards Graph entity id and q filters to the current admin API contract', async () => {
    const calls: string[] = [];
    const result = await handleControlPlaneToolCall('brainbase_admin_read', {
      view: 'graph_entities',
      project: 'brainbase',
      id: 'dec_01KQ8T8SXZ0YA7GQTE1CYEGJGK',
      q: 'VERIFY',
    }, dependencies({
      fetch: async (url: string | URL | Request) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ source_class: 'graph_ssot', status: 'available', records: [] }), { status: 200 });
      },
    }));

    assert.equal(result?.status, 'ok');
    assert.deepEqual(calls, [
      'http://brainbase.test/api/admin/graph/entities?project=brainbase&id=dec_01KQ8T8SXZ0YA7GQTE1CYEGJGK&q=VERIFY',
    ]);
  });

  it('TSK-WEBRET-007 AC-5: context preview remains a scoped read even though its REST transport is POST', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const result = await handleControlPlaneToolCall('brainbase_admin_read', {
      view: 'context_preview',
      project: 'brainbase',
      entity_types: ['project', 'decision'],
      include_edges: true,
      include_memory: false,
      include_philosophy: true,
    }, dependencies({
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({
          source_class: 'ai_context',
          status: 'partial',
          warnings: ['memory omitted'],
          preview: { project_code: 'brainbase' },
        }), { status: 200 });
      },
    }));

    assert.equal(result?.status, 'ok');
    assert.equal(result?.data?.admin_result?.status, 'partial');
    assert.equal(calls[0].url, 'http://brainbase.test/api/admin/context-preview');
    assert.equal(calls[0].init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      project: 'brainbase',
      entityTypes: ['project', 'decision'],
      includeEdges: true,
      includeMemory: false,
      includePhilosophy: true,
    });
    assert.equal(result?.audit.operation, 'read');
  });

  it('TSK-WFRET-002 AC-1: Run Receipt Inbox is discoverable without exposing generic Workflow CRUD', () => {
    const tool = controlPlaneTools.find((candidate) => candidate.name === 'brainbase_run_receipt_inbox');

    assert.ok(tool);
    assert.deepEqual(Object.keys(tool.inputSchema.properties || {}), [
      'project_id',
      'source_type',
      'run_status',
      'evidence_state',
      'limit',
    ]);
    assert.ok(serverTesting.tools.some((candidate) => candidate.name === 'brainbase_run_receipt_inbox'));
    assert.equal(controlPlaneTools.some((candidate) => /workflow/i.test(candidate.name)), false);
  });

  it('TSK-WFRET-002 AC-2: Run Receipt filters and authenticated scope are forwarded with audit evidence', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const item = {
      id: 'run_001',
      project_id: 'brainbase',
      source: { type: 'mana', workflow_id: 'daily-reflection' },
      source_status: 'blocked',
      evidence_state: 'unconfirmed',
      priority: 1,
    };
    const result = await handleControlPlaneToolCall('brainbase_run_receipt_inbox', {
      project_id: 'brainbase',
      source_type: 'mana',
      run_status: 'blocked',
      evidence_state: 'unconfirmed',
      limit: 25,
    }, dependencies({
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({
          items: [item],
          count: 1,
          has_more: false,
          omitted_count: 0,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    }));

    assert.equal(result?.status, 'ok');
    assert.deepEqual(result?.data?.items, [item]);
    assert.equal(result?.data?.count, 1);
    assert.equal(result?.data?.has_more, false);
    assert.equal(result?.data?.omitted_count, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://brainbase.test/api/run-receipts/inbox?project_id=brainbase&source_type=mana&run_status=blocked&evidence_state=unconfirmed&limit=25');
    assert.equal(new Headers(calls[0].init?.headers).get('x-brainbase-projects'), 'brainbase');
    assert.equal(result?.audit.source, calls[0].url);
  });

  it('TSK-WFRET-002 AC-3: a confirmed empty Run Receipt Inbox remains ok', async () => {
    const result = await handleControlPlaneToolCall('brainbase_run_receipt_inbox', {}, dependencies({
      fetch: async () => new Response(JSON.stringify({
        items: [],
        count: 0,
        has_more: false,
        omitted_count: 0,
      }), { status: 200 }),
    }));

    assert.equal(result?.status, 'ok');
    assert.deepEqual(result?.data?.items, []);
    assert.equal(result?.data?.count, 0);
    assert.equal(result?.data?.has_more, false);
    assert.equal(result?.data?.omitted_count, 0);
  });

  it('TSK-WFRET-002 AC-4: Run Receipt transport failure remains unavailable instead of becoming no_data', async () => {
    const result = await handleControlPlaneToolCall('brainbase_run_receipt_inbox', {}, dependencies({
      fetch: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    }));

    assert.equal(result?.status, 'unavailable');
    assert.equal(result?.error?.code, 'brainbase_api_unavailable');
    assert.equal('data' in (result || {}), false);
  });

  it('TSK-WFRET-002 AC-5: an explicit project outside the authenticated scope is rejected before fetch', async () => {
    let fetched = false;
    const result = await handleControlPlaneToolCall('brainbase_run_receipt_inbox', {
      project_id: 'salestailor',
    }, dependencies({
      fetch: async () => {
        fetched = true;
        return new Response('{}', { status: 200 });
      },
    }));

    assert.equal(result?.status, 'error');
    assert.equal(result?.error?.code, 'brainbase_project_not_accessible');
    assert.equal(fetched, false);
    assert.equal('data' in (result || {}), false);
  });

  it('TSK-WFRET-002 AC-6: Run Receipt history and diagnosis are discoverable without generic Workflow tools', () => {
    assert.ok(controlPlaneTools.some((candidate) => candidate.name === 'brainbase_run_receipt_history'));
    assert.ok(controlPlaneTools.some((candidate) => candidate.name === 'brainbase_run_receipt_diagnosis'));
    assert.ok(serverTesting.tools.some((candidate) => candidate.name === 'brainbase_run_receipt_history'));
    assert.ok(serverTesting.tools.some((candidate) => candidate.name === 'brainbase_run_receipt_diagnosis'));
    assert.equal(controlPlaneTools.some((candidate) => /workflow/i.test(candidate.name)), false);
  });

  it('TSK-WFRET-002 AC-7: source identity history is scoped and preserves confirmed empty separately from unavailable', async () => {
    const calls: string[] = [];
    const result = await handleControlPlaneToolCall('brainbase_run_receipt_history', {
      project_id: 'brainbase',
      source_type: 'mana',
      source_identity: 'daily-secretary',
      limit: 10,
    }, dependencies({
      fetch: async (url: string | URL | Request) => {
        calls.push(String(url));
        return new Response(JSON.stringify({
          source: { type: 'mana', identity: 'daily-secretary' },
          items: [],
          count: 0,
          has_more: false,
          omitted_count: 0,
        }), { status: 200 });
      },
    }));

    assert.equal(result?.status, 'ok');
    assert.deepEqual(result?.data?.source, { type: 'mana', identity: 'daily-secretary' });
    assert.deepEqual(result?.data?.items, []);
    assert.equal(result?.data?.count, 0);
    assert.deepEqual(calls, [
      'http://brainbase.test/api/run-receipts/history?project_id=brainbase&source_type=mana&source_identity=daily-secretary&limit=10',
    ]);
  });

  it('TSK-WFRET-002 AC-8: diagnosis preserves blocked and missing evidence as structured action required', async () => {
    const result = await handleControlPlaneToolCall('brainbase_run_receipt_diagnosis', {
      project_id: 'brainbase',
      run_id: 'run/blocked 001',
    }, dependencies({
      fetch: async (url: string | URL | Request) => {
        assert.equal(
          String(url),
          'http://brainbase.test/api/run-receipts/run%2Fblocked%20001/diagnosis?project_id=brainbase',
        );
        return new Response(JSON.stringify({
          receipt: {
            run_id: 'run/blocked 001',
            project_id: 'brainbase',
            source_status: 'blocked',
            evidence_state: 'no_data',
          },
          diagnosis: {
            state: 'action_required',
            issue_codes: ['source_blocked', 'evidence_missing'],
            recommended_action: 'reauthorize',
          },
        }), { status: 200 });
      },
    }));

    assert.equal(result?.status, 'ok');
    assert.equal(result?.data?.receipt?.project_id, 'brainbase');
    assert.deepEqual(result?.data?.diagnosis, {
      state: 'action_required',
      issue_codes: ['source_blocked', 'evidence_missing'],
      recommended_action: 'reauthorize',
    });
  });

  it('TSK-WFRET-002 AC-9: history and diagnosis reject missing or inaccessible project scope before fetch', async () => {
    let fetched = false;
    const noProject = await handleControlPlaneToolCall('brainbase_run_receipt_history', {
      source_type: 'mana',
      source_identity: 'daily-secretary',
    }, dependencies({ fetch: async () => { fetched = true; return new Response('{}'); } }));
    const outsideScope = await handleControlPlaneToolCall('brainbase_run_receipt_diagnosis', {
      project_id: 'salestailor',
      run_id: 'run-001',
    }, dependencies({ fetch: async () => { fetched = true; return new Response('{}'); } }));

    assert.equal(noProject?.status, 'error');
    assert.equal(noProject?.error?.code, 'brainbase_input_invalid');
    assert.equal(outsideScope?.status, 'error');
    assert.equal(outsideScope?.error?.code, 'brainbase_project_not_accessible');
    assert.equal(fetched, false);
  });

  it('TSK-WFRET-003 AC-1: dedicated Automation and Meeting tools replace generic Workflow tools', () => {
    const expected = [
      'brainbase_automation_run_detail',
      'brainbase_automation_human_step_resolve',
      'brainbase_meeting_automation_diagnosis',
    ];

    for (const name of expected) {
      assert.ok(controlPlaneTools.some((candidate) => candidate.name === name));
      assert.ok(serverTesting.tools.some((candidate) => candidate.name === name));
    }
    assert.equal(controlPlaneTools.some((candidate) => /workflow/i.test(candidate.name)), false);
  });

  it('TSK-WFRET-003 AC-2: Automation Run detail is fetched with scoped read audit evidence', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const result = await handleControlPlaneToolCall('brainbase_automation_run_detail', {
      project_id: 'brainbase',
      run_id: 'run/meeting-001',
    }, dependencies({
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({
          run: { id: 'run/meeting-001', project_id: 'brainbase', status: 'waiting_human' },
          run_steps: [{ id: 'step-001', status: 'waiting_human' }],
          human_steps: [{ id: 'human-001', status: 'pending' }],
          outputs: [],
          audit_logs: [],
        }), { status: 200 });
      },
    }));

    assert.equal(result?.status, 'ok');
    assert.equal(result?.data?.run?.project_id, 'brainbase');
    assert.equal(calls[0].url, 'http://brainbase.test/api/workflow-runs/run%2Fmeeting-001');
    assert.equal(calls[0].init?.method, 'GET');
    assert.equal(result?.audit.operation, 'read');
  });

  it('TSK-WFRET-003 AC-3: a human approval uses an explicit scoped write contract', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const result = await handleControlPlaneToolCall('brainbase_automation_human_step_resolve', {
      project_id: 'brainbase',
      run_id: 'run-001',
      step_id: 'human-001',
      resolution: 'approved',
      reason: '内容を確認済み',
    }, dependencies({
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({
          human_step: { id: 'human-001', status: 'approved' },
          resumed_run: { id: 'run-001', project_id: 'brainbase', status: 'running' },
        }), { status: 200 });
      },
    }));

    assert.equal(result?.status, 'ok');
    assert.equal(calls[0].url, 'http://brainbase.test/api/workflow-runs/run-001/human-steps/human-001/resolve');
    assert.equal(calls[0].init?.method, 'POST');
    assert.equal(new Headers(calls[0].init?.headers).get('content-type'), 'application/json');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      resolution: 'approved',
      reason: '内容を確認済み',
    });
    assert.equal(result?.audit.operation, 'write');
  });

  it('TSK-WFRET-003 AC-4: Meeting diagnosis preserves a blocked state and recovery actions', async () => {
    const result = await handleControlPlaneToolCall('brainbase_meeting_automation_diagnosis', {
      project_id: 'brainbase',
    }, dependencies({
      fetch: async (url: string | URL | Request) => {
        assert.equal(
          String(url),
          'http://brainbase.test/api/settings/meeting-sources/diagnosis?project_id=brainbase',
        );
        return new Response(JSON.stringify({
          project_id: 'brainbase',
          state: 'blocked',
          issue_codes: ['no_connected_providers'],
          recommended_actions: ['connect_meeting_source'],
          providers: [],
          last_scheduled_run: null,
        }), { status: 200 });
      },
    }));

    assert.equal(result?.status, 'ok');
    assert.equal(result?.data?.meeting_automation?.state, 'blocked');
    assert.deepEqual(result?.data?.meeting_automation?.issue_codes, ['no_connected_providers']);
  });
});
