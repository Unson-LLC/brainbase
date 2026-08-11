import { describe, expect, it } from 'vitest';

import {
  handleOnboardingToolCall,
  onboardingTools,
} from '../../mcp/brainbase/src/tools/onboarding-tools.js';

function jwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

function dependencies(fetch) {
  return {
    apiUrl: 'http://brainbase.test',
    configuredProjectCodes: ['brainbase'],
    tokenManager: {
      getToken: async () => jwt({ sub: 'per_owner', projectCodes: ['brainbase'] }),
    },
    fetch,
  };
}

describe('Brainbase onboarding MCP response contract', () => {
  it('schema_failure: source receipt schema rejects undeclared credential fields', () => {
    const ingest = onboardingTools.find((tool) => tool.name === 'brainbase_onboarding_ingest');
    const source = ingest?.inputSchema.properties.source;
    const permissionSnapshot = source.properties.permission_snapshot;

    expect(permissionSnapshot.additionalProperties).toBe(false);
    expect(permissionSnapshot.properties.token).toBeUndefined();
    expect(permissionSnapshot.properties.client_secret).toBeUndefined();
  });

  it('parse_failure: malformed 2xx JSON cannot become success or confirmed empty', async () => {
    const result = await handleOnboardingToolCall(
      'brainbase_onboarding_get',
      { run_id: 'onb_1', project_code: 'brainbase' },
      dependencies(async () => new Response('{broken', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
    );

    expect(result).toEqual({
      status: 'error',
      scope: { project_codes: ['brainbase'] },
      error: {
        code: 'brainbase_api_response_invalid',
        message: 'Brainbase API returned malformed JSON',
        http_status: 200,
      },
    });
  });

  it('schema_failure: credential-bearing successful response payload is rejected', async () => {
    const result = await handleOnboardingToolCall(
      'brainbase_onboarding_get',
      { run_id: 'onb_1', project_code: 'brainbase' },
      dependencies(async () => new Response(JSON.stringify({
        id: 'onb_1',
        access_token: 'plaintext-secret',
      }), { status: 200 })),
    );

    expect(result).toEqual({
      status: 'error',
      scope: { project_codes: ['brainbase'] },
      error: {
        code: 'brainbase_api_response_invalid',
        message: 'Brainbase API returned credential-bearing data',
        http_status: 200,
      },
    });
  });

  it('provider_failure: credential-bearing 5xx remains unavailable without leaking data', async () => {
    const result = await handleOnboardingToolCall(
      'brainbase_onboarding_get',
      { run_id: 'onb_1', project_code: 'brainbase' },
      dependencies(async () => new Response(JSON.stringify({
        access_token: 'plaintext-secret',
      }), { status: 503 })),
    );

    expect(result).toEqual({
      status: 'unavailable',
      scope: { project_codes: ['brainbase'] },
      error: {
        code: 'brainbase_api_unavailable',
        message: 'Brainbase API is unavailable',
        http_status: 503,
      },
    });
    expect(JSON.stringify(result)).not.toContain('plaintext-secret');
  });
});
