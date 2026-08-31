import { describe, it } from 'node:test';
import assert from 'node:assert';
import { authenticateMcpHttpRequest } from '../../src/auth/http-auth.js';

describe('MCP HTTP authentication strategy', () => {
  it('keeps the shared bearer mode as an explicit migration fallback', async () => {
    const result = await authenticateMcpHttpRequest('Bearer shared', {
      mode: 'shared-bearer',
      sharedBearerToken: 'shared',
      verifyUrl: '',
    });
    assert.deepStrictEqual(result, { ok: true, token: 'shared', kind: 'shared-bearer' });
  });

  it('validates a personal Brainbase JWT through the API and returns its principal', async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    const result = await authenticateMcpHttpRequest('Bearer personal-jwt', {
      mode: 'brainbase-jwt',
      sharedBearerToken: '',
      verifyUrl: 'https://api.example.test/api/auth/verify',
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), authorization: new Headers(init?.headers).get('authorization') ?? undefined });
        return new Response(JSON.stringify({
          ok: true,
          access: {
            personId: 'per_kato',
            organizationId: 'org_growin',
            projectCodes: ['growin'],
            clearance: ['internal'],
            role: 'member',
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    assert.deepStrictEqual(calls, [{
      url: 'https://api.example.test/api/auth/verify',
      authorization: 'Bearer personal-jwt',
    }]);
    assert.deepStrictEqual(result, {
      ok: true,
      token: 'personal-jwt',
      kind: 'brainbase-jwt',
      principal: {
        personId: 'per_kato',
        organizationId: 'org_growin',
        projectCodes: ['growin'],
        clearance: ['internal'],
        role: 'member',
      },
    });
  });

  it('fails closed for invalid, unverifiable, or organization-mismatched JWTs', async () => {
    const base = {
      mode: 'brainbase-jwt' as const,
      sharedBearerToken: '',
      verifyUrl: 'https://api.example.test/api/auth/verify',
    };
    assert.deepStrictEqual(await authenticateMcpHttpRequest(undefined, base), { ok: false });
    assert.deepStrictEqual(await authenticateMcpHttpRequest('Basic no', base), { ok: false });
    assert.deepStrictEqual(await authenticateMcpHttpRequest('Bearer bad', {
      ...base,
      fetchImpl: async () => new Response('{}', { status: 401 }),
    }), { ok: false });
    assert.deepStrictEqual(await authenticateMcpHttpRequest('Bearer wrong-org', {
      ...base,
      requiredOrganizationId: 'org_growin',
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        access: { personId: 'per_x', organizationId: 'org_other', projectCodes: ['growin'] },
      }), { status: 200 }),
    }), { ok: false });
  });
});
