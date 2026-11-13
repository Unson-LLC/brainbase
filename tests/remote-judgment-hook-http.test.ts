import { describe, it, expect } from 'vitest';
import {
  remoteJudgmentHookHostFlags,
  handleRemoteJudgmentHookRequest,
  REMOTE_JUDGMENT_HOOK_MAX_BODY_BYTES,
} from '../src/remote-judgment-hook-http.js';

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
    projectCode: 'trial-project',
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
  for (const overrides of [{ method: 'GET' }, { url: '/other' }]) {
    it(`leaves unrelated requests unhandled: ${JSON.stringify(overrides)}`, async () => {
      expect(await handleRemoteJudgmentHookRequest(request({
        ...overrides, dispatch: async () => { throw new Error('must not dispatch'); },
      }))).toBe(null);
    });
  }

  for (const payload of [null, [], 'text', 42]) {
    it(`rejects a non-object payload: ${JSON.stringify(payload)}`, async () => {
      expect(await handleRemoteJudgmentHookRequest(request({
        body: Buffer.from(JSON.stringify(payload)),
        dispatch: async () => { throw new Error('must not dispatch'); },
      }))).toEqual({ status: 400, body: { error: 'invalid_hook_payload' } });
    });
  }

  for (const identity of [{ session_id: '' }, { turn_id: '' }, { session_id: 1 }, { turn_id: null }]) {
    it(`rejects invalid hook identity: ${JSON.stringify(identity)}`, async () => {
      expect(await handleRemoteJudgmentHookRequest(request({
        body: Buffer.from(JSON.stringify({
          hook_event_name: 'Stop', session_id: 'session-1', turn_id: 'turn-1', ...identity,
        })),
        dispatch: async () => { throw new Error('must not dispatch'); },
      }))).toEqual({ status: 400, body: { error: 'invalid_hook_identity' } });
    });
  }

  for (const output of [undefined, null, [], 'invalid']) {
    it(`fails closed on invalid dispatcher output: ${JSON.stringify(output)}`, async () => {
      expect(await handleRemoteJudgmentHookRequest(request({
        dispatch: async () => ({ output }),
      }))).toEqual({ status: 503, body: { error: 'judgment_hook_output_invalid' } });
    });
  }

  it('rejects a verified principal without a tenant before dispatch', async () => {
    let calls = 0;
    const result = await handleRemoteJudgmentHookRequest(request({
      trustedPrincipal: { personId: 'per_owner', organizationId: 'org-a', projectCodes: ['trial-project'], clearance: [], role: 'member' },
      dispatch: async () => { calls += 1; return { output: {} }; },
    }));
    expect(result?.status).toBe(403);
    expect(result?.body.error).toBe('authenticated_history_principal_unavailable');
    expect(calls).toBe(0);
  });

  it('routes an authenticated payload through the canonical dispatcher', async () => {
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
    expect(result?.status).toBe(200);
    expect(result?.body).toEqual({
      schema_version: '1', accepted: true,
      hook_event_name: 'UserPromptSubmit', session_id: 'session-1', turn_id: 'turn-1',
      receipt_id: 'resolution-1', route_resolution_sha256: 'c'.repeat(64),
      output: { decision: 'block', reason: 'audit_required' },
    });
    expect(calls).toEqual([{
      payload: { hook_event_name: 'UserPromptSubmit', session_id: 'session-1', turn_id: 'turn-1' },
      projectCode: 'trial-project',
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
    expect(result).toEqual({
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

  it('returns canonical route receipt metadata on Stop when the dispatcher provides it', async () => {
    const routeResolutionSha256 = 'd'.repeat(64);
    const result = await handleRemoteJudgmentHookRequest(request({
      body: Buffer.from(JSON.stringify({
        hook_event_name: 'Stop', session_id: 'session-1', turn_id: 'turn-1',
      })),
      dispatch: async () => ({
        output: { systemMessage: 'audit complete' },
        receiptId: 'resolution-stop-1',
        routeResolutionSha256,
      }),
    }));

    expect(result).toEqual({
      status: 200,
      body: {
        schema_version: '1', accepted: true,
        hook_event_name: 'Stop', session_id: 'session-1', turn_id: 'turn-1',
        receipt_id: 'resolution-stop-1', route_resolution_sha256: routeResolutionSha256,
        output: { systemMessage: 'audit complete' },
      },
    });
  });

  it('forwards only the server-verified principal and ignores body identity fields for scope', async () => {
    const trustedPrincipal = {
      personId: 'per_owner',
      organizationId: 'org_owner',
      tenantId: 'ten_owner',
      projectCodes: ['trial-project'],
      clearance: ['internal'],
      role: 'member',
    };
    const calls: Array<{ projectCode: string | undefined; options: unknown }> = [];
    const result = await handleRemoteJudgmentHookRequest(request({
      trustedPrincipal,
      trustedToken: 'personal-jwt',
      body: Buffer.from(JSON.stringify({
        hook_event_name: 'UserPromptSubmit', session_id: 'session-1', turn_id: 'turn-1',
        projectCode: 'attacker-project', project_code: 'attacker-project',
        personId: 'per_attacker', person_id: 'per_attacker',
        organizationId: 'org_attacker', organization_id: 'org_attacker',
      })),
      dispatch: async (_payload: Record<string, unknown>, projectCode: string | undefined, options: unknown) => {
        calls.push({ projectCode, options });
        return {
          output: { decision: 'allow' },
          receiptId: 'resolution-trusted-principal',
          routeResolutionSha256: 'a'.repeat(64),
        };
      },
    }));

    expect(result?.status).toBe(200);
    expect(calls).toEqual([{
      projectCode: 'trial-project',
      options: { host: 'remote', trustedPrincipal, trustedToken: 'personal-jwt' },
    }]);
  });

  it('forwards the canonical company-authority context and service transport token transparently', async () => {
    const trustedPrincipal = {
      personId: 'per_owner',
      organizationId: 'org_owner',
      tenantId: 'ten_owner',
      projectCodes: ['trial-project'],
      clearance: ['internal'],
      role: 'member',
    };
    const companyAuthorityResponse = Buffer.from('{"canonical":"authority"}', 'utf8').toString('base64url');
    let observed: unknown;
    const result = await handleRemoteJudgmentHookRequest(request({
      trustedPrincipal,
      trustedToken: 'bbsvc_runtime',
      trustedAuthKind: 'company-authority',
      companyAuthorityResponse,
      dispatch: async (_payload: Record<string, unknown>, _projectCode: string | undefined, options: unknown) => {
        observed = options;
        return {
          output: { decision: 'allow' },
          receiptId: 'resolution-company-authority',
          routeResolutionSha256: 'e'.repeat(64),
        };
      },
    }));

    expect(result?.status).toBe(200);
    expect(observed).toEqual({
      host: 'remote',
      trustedPrincipal,
      trustedToken: 'bbsvc_runtime',
      trustedAuthKind: 'company-authority',
      companyAuthorityResponse,
    });
  });

  it('rejects a remote project outside the verified principal scope before dispatch', async () => {
    let dispatched = 0;
    const result = await handleRemoteJudgmentHookRequest(request({
      projectCode: 'other-project',
      trustedPrincipal: {
        personId: 'per_owner',
        organizationId: 'org_owner',
        projectCodes: ['trial-project'],
        clearance: ['internal'],
        role: 'member',
      },
      // A body project field cannot elevate the server-selected project scope.
      body: Buffer.from(JSON.stringify({
        hook_event_name: 'UserPromptSubmit', session_id: 'session-1', turn_id: 'turn-1',
        projectCode: 'trial-project', project_code: 'trial-project',
      })),
      dispatch: async () => {
        dispatched += 1;
        return {
          output: { decision: 'allow' },
          receiptId: 'should-not-dispatch',
          routeResolutionSha256: 'a'.repeat(64),
        };
      },
    }));

    expect(result).toEqual({ status: 403, body: { error: 'project_not_authorized' } });
    expect(dispatched).toBe(0);
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
      expect(result).toEqual({
        status: 503, body: { error: 'judgment_hook_route_receipt_missing' },
      });
    });
  }

  it('rejects unauthenticated, malformed, and oversized requests before dispatch', async () => {
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
    expect(unauthorized?.status).toBe(401);
    expect(invalid?.status).toBe(400);
    expect(unsupported).toEqual({ status: 400, body: { error: 'unsupported_hook_event' } });
    expect(missingProject).toEqual({ status: 400, body: { error: 'invalid_project_code' } });
    expect(oversized?.status).toBe(413);
    expect(calls).toBe(0);
  });

  it('returns the dispatcher warning for an orphan Stop', async () => {
    const output = { systemMessage: 'Audit incomplete for this response.' };
    const result = await handleRemoteJudgmentHookRequest(request({
      body: Buffer.from(JSON.stringify({ hook_event_name: 'Stop', session_id: 'session-1', turn_id: 'turn-1' })),
      dispatch: async () => ({ output }),
    }));
    expect(result?.status).toBe(200);
    expect(result?.body.output).toEqual(output);
  });

  it('preserves the dispatcher missing tool-use identity failure', async () => {
    const result = await handleRemoteJudgmentHookRequest(request({
      dispatch: async () => { throw new Error('judgment_tool_use_id_missing'); },
    }));
    expect(result).toEqual({ status: 503, body: { error: 'judgment_tool_use_id_missing' } });
  });

  it('rejects an empty PostToolUse audit result', async () => {
    const result = await handleRemoteJudgmentHookRequest(request({
      body: Buffer.from(JSON.stringify({
        hook_event_name: 'PostToolUse', session_id: 'session-1', turn_id: 'turn-1',
      })),
      dispatch: async () => ({ output: {} }),
    }));
    expect(result).toEqual({
      status: 503, body: { error: 'judgment_hook_audit_not_recorded' },
    });
  });

  it('accepts PostToolUseFailure only when the Host returns a nonempty audit', async () => {
    const payload = {
      hook_event_name: 'PostToolUseFailure', session_id: 'session-1', turn_id: 'turn-1',
      tool_name: 'mcp__brainbase__search', tool_use_id: 'failed-tool-use',
      error: { message: 'raw remote failure' }, is_interrupt: true,
    };
    const rejected = await handleRemoteJudgmentHookRequest(request({
      body: Buffer.from(JSON.stringify(payload)),
      dispatch: async () => ({ output: {} }),
    }));
    expect(rejected).toEqual({
      status: 503, body: { error: 'judgment_hook_audit_not_recorded' },
    });

    const accepted = await handleRemoteJudgmentHookRequest(request({
      body: Buffer.from(JSON.stringify(payload)),
      dispatch: async () => ({ output: { systemMessage: '⚠️ Brainbase検索: search「対象」→ 失敗または結果不明' } }),
    }));
    expect(accepted).toEqual({
      status: 200,
      body: {
        schema_version: '1', accepted: true,
        hook_event_name: 'PostToolUseFailure', session_id: 'session-1', turn_id: 'turn-1',
        output: { systemMessage: '⚠️ Brainbase検索: search「対象」→ 失敗または結果不明' },
      },
    });
  });

  for (const [field, toolName] of [
    ['tool_name', 'mcp__brainbase__brainbase_judgment_state_record'],
    ['toolName', 'mcp__brainbase__brainbase_judgment_state_record'],
    ['tool_name', 'mcp__brainbase__brainbase_judgment_audit_read'],
    ['toolName', 'mcp__brainbase__brainbase_judgment_audit_read'],
    ['tool_name', 'mcp__brainbase__brainbase_judgment_repair_read'],
    ['toolName', 'mcp__brainbase__brainbase_judgment_repair_read'],
  ] as const) {
    it(`accepts an empty audit result for the canonical internal judgment state tool form ${field}:${toolName}`, async () => {
      const result = await handleRemoteJudgmentHookRequest(request({
        body: Buffer.from(JSON.stringify({
          hook_event_name: 'PostToolUse', session_id: 'session-1', turn_id: 'turn-1',
          [field]: toolName,
        })),
        dispatch: async () => ({ output: {} }),
      }));
      expect(result).toEqual({
        status: 200,
        body: {
          schema_version: '1', accepted: true,
          hook_event_name: 'PostToolUse', session_id: 'session-1', turn_id: 'turn-1',
          output: {},
        },
      });
    });
  }

  for (const toolName of [
    'brainbase_judgment_state_record',
    'prefix_brainbase_judgment_state_record',
    'brainbase_judgment_state_record_suffix',
    'brainbase_judgment_audit_read',
    'mcp__brainbase__brainbase_judgment_audit_read_suffix',
    'brainbase_judgment_repair_read',
    'mcp__brainbase__brainbase_judgment_repair_read_suffix',
  ]) {
    it(`rejects an empty audit result for a near-match internal tool name ${toolName}`, async () => {
      const result = await handleRemoteJudgmentHookRequest(request({
        body: Buffer.from(JSON.stringify({
          hook_event_name: 'PostToolUse', session_id: 'session-1', turn_id: 'turn-1',
          tool_name: toolName,
        })),
        dispatch: async () => ({ output: {} }),
      }));
      expect(result).toEqual({
        status: 503, body: { error: 'judgment_hook_audit_not_recorded' },
      });
    });
  }

  it('fails closed when the canonical dispatcher is unavailable', async () => {
    const diagnostics: unknown[] = [];
    const transportError = Object.assign(new TypeError('secret transport detail'), {
      code: 'UND_ERR_CONNECT_TIMEOUT',
    });
    const result = await handleRemoteJudgmentHookRequest(request({
      dispatch: async () => { throw transportError; },
      onDispatchError: (details: unknown) => diagnostics.push(details),
    }));
    expect(result).toEqual({ status: 503, body: { error: 'judgment_hook_unavailable' } });
    expect(diagnostics).toEqual([{
      eventName: 'UserPromptSubmit',
      reason: 'judgment_hook_unavailable',
      errorName: 'TypeError',
      errorCode: 'UND_ERR_CONNECT_TIMEOUT',
    }]);
    expect(JSON.stringify(diagnostics).includes('secret transport detail')).toBe(false);
  });

  it('returns only bounded canonical judgment failure codes', async () => {
    const canonical = await handleRemoteJudgmentHookRequest(request({
      dispatch: async () => { throw new Error('judgment_receipt_context_mismatch'); },
    }));
    const arbitrary = await handleRemoteJudgmentHookRequest(request({
      dispatch: async () => { throw new Error('Bearer secret-must-not-escape'); },
    }));

    expect(canonical).toEqual({
      status: 503,
      body: { error: 'judgment_receipt_context_mismatch' },
    });
    expect(arbitrary).toEqual({
      status: 503,
      body: { error: 'judgment_hook_unavailable' },
    });
  });

  for (const reason of [
    'judgment_history_scope_mismatch',
    'judgment_history_project_denied',
    'judgment_history_shared_bearer_denied',
    'judgment_history_scope_shared_bearer_rejected',
  ]) {
    it(`returns 403 for the scope denial reason ${reason}`, async () => {
      const result = await handleRemoteJudgmentHookRequest(request({
        dispatch: async () => { throw new Error(reason); },
      }));

      expect(result).toEqual({ status: 403, body: { error: reason } });
    });
  }

  it('records only a bounded snake-case cause reason code', async () => {
    const diagnostics: unknown[] = [];
    const safeCause = new Error('brainbase_api_response_invalid');
    const wrapped = new Error('judgment_episode_route_resolve_failed', { cause: safeCause });
    await handleRemoteJudgmentHookRequest(request({
      dispatch: async () => { throw wrapped; },
      onDispatchError: (details: unknown) => diagnostics.push(details),
    }));
    expect(diagnostics).toEqual([{
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
    expect(JSON.stringify(secretDiagnostics).includes('secret-must-not-escape')).toBe(false);
    expect('causeReasonCode' in (secretDiagnostics[0] as Record<string, unknown>)).toBe(false);
  });
});

describe('owner Claude Code judgment Hook on the local bridge', () => {
  const claudePayload = {
    hook_event_name: 'UserPromptSubmit', session_id: 'claude-session', turn_id: 'prompt-1', cwd: '/repo',
  };

  it('dispatches a declared Claude Code turn as claude-code without a project code', async () => {
    const calls: unknown[] = [];
    const result = await handleRemoteJudgmentHookRequest(request({
      body: Buffer.from(JSON.stringify(claudePayload)),
      projectCode: undefined,
      declaredHost: 'claude-code',
      localClaudeCodeAllowed: true,
      dispatch: async (payload: unknown, projectCode: string | undefined, options: unknown) => {
        calls.push({ payload, projectCode, options });
        return { output: { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'ctx' } },
          receiptId: 'resolution-claude', routeResolutionSha256: 'd'.repeat(64) };
      },
    }));
    expect(result?.status).toBe(200);
    expect(calls).toEqual([{ payload: claudePayload, projectCode: undefined, options: { host: 'claude-code' } }]);
  });

  it('rejects the Claude Code declaration outside the owner bridge or with an unknown host', async () => {
    let dispatched = 0;
    const dispatch = async () => { dispatched += 1; return { output: {} }; };
    for (const overrides of [
      { declaredHost: 'claude-code', localClaudeCodeAllowed: false },
      { declaredHost: 'claude-code' },
      { declaredHost: 'codex', localClaudeCodeAllowed: true },
    ]) {
      const result = await handleRemoteJudgmentHookRequest(request({
        body: Buffer.from(JSON.stringify(claudePayload)), dispatch, ...overrides,
      }));
      expect(result).toEqual({ status: 400, body: { error: 'judgment_hook_host_unsupported' } });
    }
    const invalidProject = await handleRemoteJudgmentHookRequest(request({
      body: Buffer.from(JSON.stringify(claudePayload)), dispatch,
      declaredHost: 'claude-code', localClaudeCodeAllowed: true, projectCode: 'Not A Code',
    }));
    expect(invalidProject).toEqual({ status: 400, body: { error: 'invalid_project_code' } });
    expect(dispatched).toBe(0);
  });

  it('keeps the remote runtime contract: project code required and dispatched as remote', async () => {
    const missing = await handleRemoteJudgmentHookRequest(request({ projectCode: undefined }));
    expect(missing).toEqual({ status: 400, body: { error: 'invalid_project_code' } });
    const calls: unknown[] = [];
    await handleRemoteJudgmentHookRequest(request({
      dispatch: async (_payload: unknown, projectCode: string | undefined, options: unknown) => {
        calls.push({ projectCode, options });
        return { output: {}, receiptId: 'r', routeResolutionSha256: 'e'.repeat(64) };
      },
    }));
    // An empty header is no declaration.
    await handleRemoteJudgmentHookRequest(request({
      declaredHost: '',
      dispatch: async (_payload: unknown, projectCode: string | undefined, options: unknown) => {
        calls.push({ projectCode, options });
        return { output: {}, receiptId: 'r', routeResolutionSha256: 'e'.repeat(64) };
      },
    }));
    expect(calls).toEqual([
      { projectCode: 'trial-project', options: { host: 'remote' } },
      { projectCode: 'trial-project', options: { host: 'remote' } },
    ]);
  });

  it('accepts an empty Host audit for a local Claude Code tool event', async () => {
    const result = await handleRemoteJudgmentHookRequest(request({
      body: Buffer.from(JSON.stringify({
        hook_event_name: 'PostToolUse', session_id: 'claude-session', turn_id: 'prompt-1',
        tool_name: 'mcp__brainbase__brainbase_judgment_node_record', tool_use_id: 'toolu_1',
      })),
      projectCode: undefined, declaredHost: 'claude-code', localClaudeCodeAllowed: true,
      dispatch: async () => ({ output: {} }),
    }));
    expect(result?.status).toBe(200);
    expect((result?.body as Record<string, unknown>).output).toEqual({});
  });

  it('accepts PreToolUse only from a declared Claude Code turn', async () => {
    const preToolUse = {
      hook_event_name: 'PreToolUse', session_id: 'claude-session', turn_id: 'prompt-1',
      tool_name: 'mcp__brainbase__brainbase_knowledge_lookup', tool_use_id: 'toolu_1', tool_input: {},
    };
    const denial = { hookSpecificOutput: {
      hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: 'この取得計画はHost検証で拒否しました（stale_lookup_revision）',
    } };
    const calls: unknown[] = [];
    const claude = await handleRemoteJudgmentHookRequest(request({
      body: Buffer.from(JSON.stringify(preToolUse)),
      projectCode: undefined, declaredHost: 'claude-code', localClaudeCodeAllowed: true,
      dispatch: async (_payload: unknown, _projectCode: string | undefined, options: unknown) => {
        calls.push(options);
        return { output: denial };
      },
    }));
    expect(claude?.status).toBe(200);
    expect((claude?.body as Record<string, unknown>).output).toEqual(denial);
    expect(calls).toEqual([{ host: 'claude-code' }]);

    // A remote runtime keeps its existing event set.
    const remote = await handleRemoteJudgmentHookRequest(request({
      body: Buffer.from(JSON.stringify(preToolUse)),
      dispatch: async () => { calls.push('remote'); return { output: {} }; },
    }));
    expect(remote).toEqual({ status: 400, body: { error: 'unsupported_hook_event' } });
    expect(calls.length).toBe(1);
  });
});


describe('person JWT Claude Code judgment Hook on a hosted MCP', () => {
  const trustedPrincipal = {
    personId: 'per_trial', organizationId: 'org_trial', tenantId: 'ten_trial',
    projectCodes: ['trial-project'], clearance: ['internal'], role: 'member',
  };
  function hostedRequest(overrides: Record<string, unknown> = {}) {
    return request({
      declaredHost: 'claude-code', localClaudeCodeAllowed: false,
      personHostedClaudeCodeAllowed: true, trustedAuthKind: 'brainbase-jwt',
      trustedPrincipal, projectCode: 'trial-project', ...overrides,
    });
  }

  it('dispatches an authorized person JWT as claude-code', async () => {
    const calls: unknown[] = [];
    const result = await handleRemoteJudgmentHookRequest(hostedRequest({
      dispatch: async (_payload: unknown, projectCode: string | undefined, options: unknown) => {
        calls.push({ projectCode, options });
        return { output: {}, receiptId: 'trial-route', routeResolutionSha256: 'a'.repeat(64) };
      },
    }));
    expect(result?.status).toBe(200);
    expect(calls).toEqual([{ projectCode: 'trial-project', options: {
      host: 'claude-code', trustedPrincipal, trustedAuthKind: 'brainbase-jwt',
    } }]);
  });

  for (const projectCode of [undefined, '', 'Not A Code']) {
    it(`rejects a missing or invalid hosted project code: ${String(projectCode)}`, async () => {
      const result = await handleRemoteJudgmentHookRequest(hostedRequest({
        projectCode, dispatch: async () => { throw new Error('must not dispatch'); },
      }));
      expect(result?.status).toBe(400);
      expect(result?.body.error).toBe('invalid_project_code');
    });
  }

  it('rejects a project outside the person scope', async () => {
    const result = await handleRemoteJudgmentHookRequest(hostedRequest({
      projectCode: 'other-project', dispatch: async () => { throw new Error('must not dispatch'); },
    }));
    expect(result?.status).toBe(403);
    expect(result?.body.error).toBe('project_not_authorized');
  });

  for (const principal of [undefined, { ...trustedPrincipal, tenantId: ' ' }]) {
    it(`rejects an unavailable hosted principal or tenant: ${principal ? 'tenant' : 'principal'}`, async () => {
      const result = await handleRemoteJudgmentHookRequest(hostedRequest({
        trustedPrincipal: principal, dispatch: async () => { throw new Error('must not dispatch'); },
      }));
      expect(result?.status).toBe(403);
      expect(result?.body.error).toBe('authenticated_history_principal_unavailable');
    });
  }

  for (const trustedAuthKind of [undefined, 'company-authority']) {
    it(`rejects a hosted non-person writer even with the flag: ${trustedAuthKind ?? 'shared-bearer'}`, async () => {
      const result = await handleRemoteJudgmentHookRequest(hostedRequest({
        trustedAuthKind, dispatch: async () => { throw new Error('must not dispatch'); },
      }));
      expect(result?.status).toBe(400);
      expect(result?.body.error).toBe('judgment_hook_host_unsupported');
    });
  }

  it('requires the hosted flag for a person JWT declaration', async () => {
    const result = await handleRemoteJudgmentHookRequest(hostedRequest({ personHostedClaudeCodeAllowed: false }));
    expect(result?.status).toBe(400);
    expect(result?.body.error).toBe('judgment_hook_host_unsupported');
  });

  for (const authKind of ['brainbase-jwt', 'shared-bearer', 'company-authority'] as const) {
    for (const isOwnerLocalBridge of [false, true]) {
      it(`derives host flags for ${authKind} with owner bridge ${isOwnerLocalBridge}`, () => {
        expect(remoteJudgmentHookHostFlags(authKind, isOwnerLocalBridge)).toEqual({
          personHostedClaudeCodeAllowed: authKind === 'brainbase-jwt',
          localClaudeCodeAllowed: authKind === 'shared-bearer' && isOwnerLocalBridge,
        });
      });
    }
  }
});
