import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  handleRemoteJudgmentHookRequest,
  REMOTE_JUDGMENT_HOOK_MAX_BODY_BYTES,
} from '../../src/remote-judgment-hook-http.js';

const authorize = (authorization: string | undefined, token: string) =>
  authorization === `Bearer ${token}`;

function request(overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    url: '/host/judgment/hook',
    authorization: 'Bearer expected',
    body: Buffer.from(JSON.stringify({
      hook_event_name: 'UserPromptSubmit', session_id: 'session-1', turn_id: 'turn-1',
    })),
    bearerToken: 'expected',
    projectCode: 'mana-runtime',
    isAuthorized: authorize,
    dispatch: async () => ({
      output: { decision: 'allow' },
      receiptId: 'resolution-default',
      routeResolutionSha256: 'b'.repeat(64),
    }),
    ...overrides,
  };
}

describe('remote judgment Hook HTTP boundary', () => {
  it('story-remote-judgment-hook:ac:1 story-remote-judgment-hook:ac:2 routes an authenticated payload through the canonical dispatcher', async () => {
    const calls: unknown[] = [];
    const result = await handleRemoteJudgmentHookRequest(request({
      dispatch: async (payload: unknown, projectCode: string) => {
        calls.push({ payload, projectCode });
        return {
          output: { decision: 'block', reason: 'audit_required' },
          receiptId: 'resolution-1',
          routeResolutionSha256: 'c'.repeat(64),
        };
      },
    }));
    assert.equal(result?.status, 200);
    assert.deepEqual(result?.body, {
      schema_version: '1', accepted: true,
      hook_event_name: 'UserPromptSubmit', session_id: 'session-1', turn_id: 'turn-1',
      receipt_id: 'resolution-1', route_resolution_sha256: 'c'.repeat(64),
      output: { decision: 'block', reason: 'audit_required' },
    });
    assert.deepEqual(calls, [{
      payload: { hook_event_name: 'UserPromptSubmit', session_id: 'session-1', turn_id: 'turn-1' },
      projectCode: 'mana-runtime',
    }]);
  });

  it('returns the canonical UserPrompt route receipt identity and digest to remote runtimes', async () => {
    const routeResolutionSha256 = 'a'.repeat(64);
    const result = await handleRemoteJudgmentHookRequest(request({
      dispatch: async () => ({
        output: {
          continue: true,
          suppressOutput: true,
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: 'Judgment route resolved',
          },
        },
        receiptId: 'resolution-1',
        routeResolutionSha256,
      }),
    }));
    assert.deepEqual(result, {
      status: 200,
      body: {
        schema_version: '1', accepted: true,
        hook_event_name: 'UserPromptSubmit', session_id: 'session-1', turn_id: 'turn-1',
        receipt_id: 'resolution-1', route_resolution_sha256: routeResolutionSha256,
        output: {
          continue: true,
          suppressOutput: true,
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: 'Judgment route resolved',
          },
        },
      },
    });
  });

  for (const metadata of [
    { receiptId: undefined, routeResolutionSha256: 'a'.repeat(64) },
    { receiptId: 'resolution-1', routeResolutionSha256: 'not-a-digest' },
  ]) {
    it('fails closed when canonical UserPrompt route metadata is missing or invalid', async () => {
      const result = await handleRemoteJudgmentHookRequest(request({
        dispatch: async () => ({
          output: {
            hookSpecificOutput: {
              hookEventName: 'UserPromptSubmit',
              additionalContext: 'Judgment route resolved',
            },
          },
          ...metadata,
        }),
      }));
      assert.deepEqual(result, {
        status: 503, body: { error: 'judgment_hook_route_receipt_missing' },
      });
    });
  }

  it('story-remote-judgment-hook:ac:3 rejects unauthenticated, malformed, and oversized requests before dispatch', async () => {
    let calls = 0;
    const dispatch = async () => { calls += 1; return { output: {} }; };
    const unauthorized = await handleRemoteJudgmentHookRequest(request({ authorization: undefined, dispatch }));
    const invalid = await handleRemoteJudgmentHookRequest(request({ body: Buffer.from('{'), dispatch }));
    const unsupported = await handleRemoteJudgmentHookRequest(request({
      body: Buffer.from(JSON.stringify({
        hook_event_name: 'SessionStart', session_id: 'session-1', turn_id: 'turn-1',
      })), dispatch,
    }));
    const missingProject = await handleRemoteJudgmentHookRequest(request({ projectCode: undefined, dispatch }));
    const oversized = await handleRemoteJudgmentHookRequest(request({
      body: Buffer.alloc(REMOTE_JUDGMENT_HOOK_MAX_BODY_BYTES + 1),
      dispatch,
    }));
    assert.equal(unauthorized?.status, 401);
    assert.equal(invalid?.status, 400);
    assert.deepEqual(unsupported, { status: 400, body: { error: 'unsupported_hook_event' } });
    assert.deepEqual(missingProject, { status: 400, body: { error: 'invalid_project_code' } });
    assert.equal(oversized?.status, 413);
    assert.equal(calls, 0);
  });

  it('story-remote-judgment-hook-contract-sync:ac:1 returns the canonical one-shot repair block for an orphan Stop', async () => {
    const journalRoot = await mkdtemp(join(tmpdir(), 'remote-judgment-hook-'));
    try {
      const { processHookPayload } = await import('../../../../scripts/codex-hooks/judgment-resolver-host.mjs');
      const result = await handleRemoteJudgmentHookRequest(request({
        body: Buffer.from(JSON.stringify({
          hook_event_name: 'Stop', session_id: 'remote-session', turn_id: 'remote-turn',
          stop_hook_active: false, last_assistant_message: '監査前の回答',
        })),
        dispatch: async (payload: Record<string, unknown>) => ({
          output: await processHookPayload(payload, {
            env: { ...process.env, BRAINBASE_JUDGMENT_JOURNAL_DIR: journalRoot },
          }),
        }),
      }));
      assert.equal(result?.status, 200);
      assert.equal(result?.body.accepted, true);
      assert.equal(result?.body.hook_event_name, 'Stop');
      assert.equal(result?.body.output?.decision, 'block');
      assert.match(result?.body.output?.reason ?? '', /judgment_episode_not_found/);
    } finally {
      await rm(journalRoot, { recursive: true, force: true });
    }
  });

  it('story-remote-judgment-hook-contract-sync:ac:2 preserves the precise missing tool-use identity failure', async () => {
    const journalRoot = await mkdtemp(join(tmpdir(), 'remote-judgment-hook-'));
    try {
      const { processHookPayload } = await import('../../../../scripts/codex-hooks/judgment-resolver-host.mjs');
      const result = await handleRemoteJudgmentHookRequest(request({
        body: Buffer.from(JSON.stringify({
          hook_event_name: 'PostToolUse', session_id: 'remote-session', turn_id: 'remote-turn',
          tool_name: 'mcp__brainbase__brainbase_knowledge_resolve',
        })),
        dispatch: async (payload: Record<string, unknown>) => ({
          output: await processHookPayload(payload, {
            env: { ...process.env, BRAINBASE_JUDGMENT_JOURNAL_DIR: journalRoot },
          }),
        }),
      }));
      assert.deepEqual(result, {
        status: 503, body: { error: 'judgment_tool_use_id_missing' },
      });
    } finally {
      await rm(journalRoot, { recursive: true, force: true });
    }
  });

  it('rejects an empty PostToolUse audit result', async () => {
    const result = await handleRemoteJudgmentHookRequest(request({
      body: Buffer.from(JSON.stringify({
        hook_event_name: 'PostToolUse', session_id: 'session-1', turn_id: 'turn-1',
      })),
      dispatch: async () => ({ output: {} }),
    }));
    assert.deepEqual(result, {
      status: 503, body: { error: 'judgment_hook_audit_not_recorded' },
    });
  });

  it('accepts an empty audit result for the internal judgment state tool', async () => {
    const result = await handleRemoteJudgmentHookRequest(request({
      body: Buffer.from(JSON.stringify({
        hook_event_name: 'PostToolUse', session_id: 'session-1', turn_id: 'turn-1',
        tool_name: 'mcp__brainbase__brainbase_judgment_state_record',
      })),
      dispatch: async () => ({ output: {} }),
    }));
    assert.deepEqual(result, {
      status: 200,
      body: {
        schema_version: '1', accepted: true,
        hook_event_name: 'PostToolUse', session_id: 'session-1', turn_id: 'turn-1',
        output: {},
      },
    });
  });

  it('story-remote-judgment-hook:ac:4 fails closed when the canonical dispatcher is unavailable', async () => {
    const diagnostics: unknown[] = [];
    const transportError = Object.assign(new TypeError('secret transport detail'), {
      code: 'UND_ERR_CONNECT_TIMEOUT',
    });
    const result = await handleRemoteJudgmentHookRequest(request({
      dispatch: async () => { throw transportError; },
      onDispatchError: (details: unknown) => diagnostics.push(details),
    }));
    assert.deepEqual(result, { status: 503, body: { error: 'judgment_hook_unavailable' } });
    assert.deepEqual(diagnostics, [{
      eventName: 'UserPromptSubmit',
      reason: 'judgment_hook_unavailable',
      errorName: 'TypeError',
      errorCode: 'UND_ERR_CONNECT_TIMEOUT',
    }]);
    assert.equal(JSON.stringify(diagnostics).includes('secret transport detail'), false);
  });

  it('returns only bounded canonical judgment failure codes', async () => {
    const canonical = await handleRemoteJudgmentHookRequest(request({
      dispatch: async () => { throw new Error('judgment_receipt_context_mismatch'); },
    }));
    const arbitrary = await handleRemoteJudgmentHookRequest(request({
      dispatch: async () => { throw new Error('Bearer secret-must-not-escape'); },
    }));

    assert.deepEqual(canonical, {
      status: 503,
      body: { error: 'judgment_receipt_context_mismatch' },
    });
    assert.deepEqual(arbitrary, {
      status: 503,
      body: { error: 'judgment_hook_unavailable' },
    });
  });

  it('records only a bounded snake-case cause reason code', async () => {
    const diagnostics: unknown[] = [];
    const safeCause = new Error('brainbase_api_response_invalid');
    const wrapped = new Error('judgment_episode_route_resolve_failed', { cause: safeCause });
    await handleRemoteJudgmentHookRequest(request({
      dispatch: async () => { throw wrapped; },
      onDispatchError: (details: unknown) => diagnostics.push(details),
    }));
    assert.deepEqual(diagnostics, [{
      eventName: 'UserPromptSubmit',
      reason: 'judgment_episode_route_resolve_failed',
      errorName: 'Error',
      causeReasonCode: 'brainbase_api_response_invalid',
    }]);

    const secretDiagnostics: unknown[] = [];
    await handleRemoteJudgmentHookRequest(request({
      dispatch: async () => {
        throw new Error('judgment_episode_route_resolve_failed', {
          cause: new Error('Bearer secret-must-not-escape'),
        });
      },
      onDispatchError: (details: unknown) => secretDiagnostics.push(details),
    }));
    assert.equal(JSON.stringify(secretDiagnostics).includes('secret-must-not-escape'), false);
    assert.equal('causeReasonCode' in (secretDiagnostics[0] as Record<string, unknown>), false);
  });
});
