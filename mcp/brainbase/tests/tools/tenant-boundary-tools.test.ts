import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  handleTenantBoundaryToolCall,
  tenantBoundaryTools,
} from '../../src/tools/tenant-boundary-tools.js';

const tenantContext = {
  protocol_version: '1.0',
  placement: { deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
};

describe('tenant boundary MCP tool', () => {
  it('AC-005: signed contextをMCP専用runtime entrypointへservice auth付きで渡す', async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    const result = await handleTenantBoundaryToolCall('authorize_tenant_resource', {
      tenant_context: tenantContext,
      resource_ref: { object_type: 'project', resource_id: 'project-a' },
    }, {
      apiUrl: 'https://brainbase.example',
      serviceToken: 'service-opaque',
      fetchImpl: async (input, init) => {
        captured = { url: String(input), init };
        return new Response(JSON.stringify({ authorized: true, entry_point: 'mcp' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    assert.deepEqual(result, { authorized: true, entry_point: 'mcp' });
    assert.equal(captured.url, 'https://brainbase.example/api/v1/runtime/tenant-boundaries/mcp:authorize');
    assert.equal(new Headers(captured.init?.headers).get('Brainbase-Protocol-Version'), '1.0');
    assert.equal(new Headers(captured.init?.headers).get('Brainbase-Deployment-Id'), tenantContext.placement.deployment_id);
    assert.deepEqual(JSON.parse(String(captured.init?.body)), {
      tenant_context: tenantContext,
      resource_ref: { object_type: 'project', resource_id: 'project-a' },
    });
  });

  it('secret未設定時は外部callせずfail closedする', async () => {
    let called = false;
    await assert.rejects(() => handleTenantBoundaryToolCall('authorize_tenant_resource', {
      tenant_context: tenantContext,
      resource_ref: { object_type: 'project', resource_id: 'project-a' },
    }, {
      apiUrl: 'https://brainbase.example',
      serviceToken: undefined,
      fetchImpl: async () => {
        called = true;
        return new Response();
      },
    }), /service authentication is unavailable/);
    assert.equal(called, false);
    assert.equal(tenantBoundaryTools[0]?.name, 'authorize_tenant_resource');
  });
});
