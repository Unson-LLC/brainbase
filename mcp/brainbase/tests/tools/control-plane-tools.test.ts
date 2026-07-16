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
});
