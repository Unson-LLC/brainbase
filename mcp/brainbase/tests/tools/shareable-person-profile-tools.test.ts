import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  __testing,
  handleShareablePersonProfileToolCall,
  shareablePersonProfileTools,
  type ShareablePersonProfileToolDependencies,
} from '../../src/tools/shareable-person-profile-tools.js';
import { __testing as serverTesting } from '../../src/server.js';

const targetSlackUserId = 'U08SKE17CGJ';
const authority = {
  signed: 'authority-context',
  tenant_context: { actor: { principal_type: 'person' } },
};
const encodedAuthority = Buffer.from(JSON.stringify(authority), 'utf8').toString('base64url');

function dependencies(
  fetchImpl: typeof globalThis.fetch,
  overrides: Partial<ShareablePersonProfileToolDependencies> = {},
): ShareablePersonProfileToolDependencies {
  return {
    apiUrl: 'https://brainbase.internal/',
    serviceToken: 'bbsvc-runtime',
    companyAuthorityResponse: encodedAuthority,
    fetch: fetchImpl,
    ...overrides,
  };
}

function successPayload() {
  return {
    status: 'ok',
    target_slack_user_id: targetSlackUserId,
    fields: { name: '大田原雅之', affiliation: 'Unson', role: 'member' },
    disclosure: {
      digest: 'd'.repeat(64),
      workspace_id: 'T0882T8N9UH',
      channel_id: 'C0BHVFJGFK3',
      thread_ts: '1789524262.758019',
      requester_person_id: 'per_requester',
      target_person_id: 'per_target',
      policy_revision: '1',
    },
  };
}

describe('shareable person profile MCP tool', () => {
  it('publishes one exact target ID argument and is classified read-only', () => {
    assert.deepEqual(shareablePersonProfileTools.map((tool) => tool.name), [
      'brainbase_get_shareable_person_profile',
    ]);
    const inputSchema = shareablePersonProfileTools[0]!.inputSchema as {
      required?: string[];
      additionalProperties?: boolean;
      properties?: Record<string, { pattern?: string }>;
    };
    assert.deepEqual(inputSchema.required, ['target_slack_user_id']);
    assert.equal(inputSchema.additionalProperties, false);
    assert.equal(inputSchema.properties?.target_slack_user_id?.pattern, '^U[A-Z0-9]+$');
    assert.equal(serverTesting.tools.some((tool) => tool.name === 'brainbase_get_shareable_person_profile'), true);
  });

  it('forwards only the trusted decoded authority and exact target to the internal endpoint', async () => {
    let requestedUrl = '';
    let requestedInit: RequestInit | undefined;
    const result = await handleShareablePersonProfileToolCall(
      'brainbase_get_shareable_person_profile',
      { target_slack_user_id: targetSlackUserId },
      dependencies(async (input, init) => {
        requestedUrl = String(input);
        requestedInit = init;
        return new Response(JSON.stringify(successPayload()), { status: 200 });
      }),
    );

    assert.equal(requestedUrl, 'https://brainbase.internal/api/v1/runtime/person-profile:read');
    assert.equal(requestedInit?.method, 'POST');
    assert.equal(requestedInit?.redirect, 'error');
    assert.equal(requestedInit?.signal instanceof AbortSignal, true);
    assert.deepEqual(requestedInit?.headers, {
      Authorization: 'Bearer bbsvc-runtime',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    assert.deepEqual(JSON.parse(String(requestedInit?.body)), {
      company_authority_response: authority,
      target_slack_user_id: targetSlackUserId,
    });
    assert.deepEqual(result, successPayload());
  });

  it('does not call the endpoint without a trusted authority or service token', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    };
    const withoutAuthority = await handleShareablePersonProfileToolCall(
      'brainbase_get_shareable_person_profile',
      { target_slack_user_id: targetSlackUserId },
      dependencies(fetchImpl, { companyAuthorityResponse: undefined }),
    );
    const withoutServiceToken = await handleShareablePersonProfileToolCall(
      'brainbase_get_shareable_person_profile',
      { target_slack_user_id: targetSlackUserId },
      dependencies(fetchImpl, { serviceToken: undefined }),
    );
    assert.deepEqual(withoutAuthority, {
      status: 'unavailable', target_slack_user_id: targetSlackUserId, fields: {},
    });
    assert.deepEqual(withoutServiceToken, {
      status: 'unavailable', target_slack_user_id: targetSlackUserId, fields: {},
    });
    assert.equal(calls, 0);
  });

  it('rejects malformed authority, extra arguments, and non-exact target IDs', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response(JSON.stringify(successPayload()), { status: 200 });
    };
    const malformed = await handleShareablePersonProfileToolCall(
      'brainbase_get_shareable_person_profile',
      { target_slack_user_id: targetSlackUserId },
      dependencies(fetchImpl, { companyAuthorityResponse: 'not-base64' }),
    );
    assert.deepEqual(malformed, {
      status: 'unavailable', target_slack_user_id: targetSlackUserId, fields: {},
    });
    await assert.rejects(
      handleShareablePersonProfileToolCall(
        'brainbase_get_shareable_person_profile',
        { target_slack_user_id: targetSlackUserId, requester_person_id: 'spoofed' },
        dependencies(fetchImpl),
      ),
      /exact Slack user ID/,
    );
    await assert.rejects(
      handleShareablePersonProfileToolCall(
        'brainbase_get_shareable_person_profile',
        { target_slack_user_id: 'U-not-exact' },
        dependencies(fetchImpl),
      ),
      /exact Slack user ID/,
    );
    assert.equal(calls, 0);
  });

  it('maps transport and backend errors to a fixed empty response without leaking bodies', async () => {
    const rejected = await handleShareablePersonProfileToolCall(
      'brainbase_get_shareable_person_profile',
      { target_slack_user_id: targetSlackUserId },
      dependencies(async () => { throw new Error('private graph details'); }),
    );
    assert.deepEqual(rejected, {
      status: 'unavailable', target_slack_user_id: targetSlackUserId, fields: {},
    });

    const backendError = await handleShareablePersonProfileToolCall(
      'brainbase_get_shareable_person_profile',
      { target_slack_user_id: targetSlackUserId },
      dependencies(async () => new Response(JSON.stringify({ error: 'private graph details' }), { status: 403 })),
    );
    assert.deepEqual(backendError, {
      status: 'unavailable', target_slack_user_id: targetSlackUserId, fields: {},
    });
    assert.doesNotMatch(JSON.stringify(backendError), /private graph details/);

    const invalidUrl = await handleShareablePersonProfileToolCall(
      'brainbase_get_shareable_person_profile',
      { target_slack_user_id: targetSlackUserId },
      dependencies(async () => new Response('{}', { status: 200 }), { apiUrl: 'not-a-url' }),
    );
    assert.deepEqual(invalidUrl, {
      status: 'unavailable', target_slack_user_id: targetSlackUserId, fields: {},
    });
  });

  it('rejects extra profile fields and unavailable responses carrying fields', async () => {
    const extraProfileField = await handleShareablePersonProfileToolCall(
      'brainbase_get_shareable_person_profile',
      { target_slack_user_id: targetSlackUserId },
      dependencies(async () => new Response(JSON.stringify({
        ...successPayload(), fields: { ...successPayload().fields, email: 'secret@example.com' },
      }), { status: 200 })),
    );
    const unavailableWithFields = await handleShareablePersonProfileToolCall(
      'brainbase_get_shareable_person_profile',
      { target_slack_user_id: targetSlackUserId },
      dependencies(async () => new Response(JSON.stringify({
        status: 'unavailable', target_slack_user_id: targetSlackUserId, fields: { name: 'secret' },
      }), { status: 200 })),
    );
    const unavailableWithDisclosure = await handleShareablePersonProfileToolCall(
      'brainbase_get_shareable_person_profile',
      { target_slack_user_id: targetSlackUserId },
      dependencies(async () => new Response(JSON.stringify({
        status: 'unavailable', target_slack_user_id: targetSlackUserId, fields: {},
        disclosure: successPayload().disclosure,
      }), { status: 200 })),
    );
    assert.deepEqual(extraProfileField, {
      status: 'unavailable', target_slack_user_id: targetSlackUserId, fields: {},
    });
    assert.deepEqual(unavailableWithFields, {
      status: 'unavailable', target_slack_user_id: targetSlackUserId, fields: {},
    });
    assert.deepEqual(unavailableWithDisclosure, {
      status: 'unavailable', target_slack_user_id: targetSlackUserId, fields: {},
    });
  });

  it('requires a disclosure receipt for successful responses and validates the decoder bound', () => {
    assert.deepEqual(__testing.decodeCompanyAuthorityResponse(encodedAuthority), authority);
    assert.equal(__testing.decodeCompanyAuthorityResponse(''), null);
    assert.equal(__testing.decodeCompanyAuthorityResponse(Buffer.from('x'.repeat(12 * 1024 + 1)).toString('base64url')), null);
    assert.equal(__testing.validateProfileResponse({
      status: 'ok', target_slack_user_id: targetSlackUserId, fields: { name: 'name' },
      disclosure: { ...successPayload().disclosure, digest: '' },
    }, targetSlackUserId), null);
    assert.equal(__testing.validateProfileResponse({
      status: 'ok', target_slack_user_id: targetSlackUserId, fields: { name: 'name' },
      disclosure: { ...successPayload().disclosure, digest: 'not-a-sha256' },
    }, targetSlackUserId), null);
    assert.equal(__testing.validateProfileResponse({
      status: 'ok', target_slack_user_id: targetSlackUserId, fields: { name: '   ' },
      disclosure: successPayload().disclosure,
    }, targetSlackUserId), null);
    assert.equal(__testing.validateProfileResponse({
      status: 'ok', target_slack_user_id: targetSlackUserId, fields: { name: 'name' },
    }, targetSlackUserId), null);
    assert.deepEqual(__testing.validateProfileResponse(successPayload(), targetSlackUserId), successPayload());
  });
});
