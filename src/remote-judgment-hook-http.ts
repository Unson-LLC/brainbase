import type { JudgmentJournalTurnInput } from './judgment-journal-turn-publisher.js';

/** Minimal identity verified by the consuming host's authentication boundary. */
export interface RemoteJudgmentHookPrincipal {
  personId: string;
  organizationId: string;
  tenantId?: string;
  projectCodes: string[];
}

export const REMOTE_JUDGMENT_HOOK_PATH = '/host/judgment/hook';
export const REMOTE_JUDGMENT_HOOK_MAX_BODY_BYTES = 1024 * 1024;

export interface RemoteJudgmentHookDispatchResult {
  output: Record<string, unknown>;
  receiptId?: string;
  routeResolutionSha256?: string;
}

/**
 * `remote`: a remote runtime. `claude-code`: Claude Code on
 * the owner's loopback bridge or authenticated with a person's hosted JWT.
 */
export type RemoteJudgmentHookHost = 'remote' | 'claude-code';

/**
 * Authentication context verified by the Host before it reaches the hook
 * dispatcher.  A shared bearer intentionally has no trusted principal or
 * auth kind and therefore is not represented here.
 */
export type RemoteJudgmentHookAuthKind = 'brainbase-jwt' | 'company-authority';

/** Derive flags from verified authentication and the host's owner-loopback check. */
export function remoteJudgmentHookHostFlags(
  authKind: RemoteJudgmentHookAuthKind | 'shared-bearer',
  isOwnerLocalBridge: boolean,
): { personHostedClaudeCodeAllowed: boolean; localClaudeCodeAllowed: boolean } {
  return {
    personHostedClaudeCodeAllowed: authKind === 'brainbase-jwt',
    localClaudeCodeAllowed: authKind === 'shared-bearer' && isOwnerLocalBridge === true,
  };
}

export interface RemoteJudgmentHookDispatchOptions {
  host: RemoteJudgmentHookHost;
  /** Principal verified by the Host authentication boundary, when available. */
  trustedPrincipal?: RemoteJudgmentHookPrincipal;
  /** The verified caller token, kept inside the dispatch boundary for canonical readback. */
  trustedToken?: string;
  /** Authentication kind verified by the Host authentication boundary. */
  trustedAuthKind?: RemoteJudgmentHookAuthKind;
  /** Raw encoded Company Authority response verified by the canonical API. */
  companyAuthorityResponse?: string;
}

export type RemoteJudgmentHookDispatch = (
  payload: Record<string, unknown>,
  projectCode: string | undefined,
  options: RemoteJudgmentHookDispatchOptions,
) => Promise<RemoteJudgmentHookDispatchResult>;

export interface RemoteJudgmentHookRequest {
  method?: string;
  url?: string;
  authorization?: string;
  body: Buffer;
  bearerToken: string;
  projectCode?: string;
  /** Principal verified by the Host authentication boundary, never by request body fields. */
  trustedPrincipal?: RemoteJudgmentHookPrincipal;
  /** Verified caller token; never included in the response or diagnostic payload. */
  trustedToken?: string;
  /** Authentication kind verified by the Host authentication boundary. */
  trustedAuthKind?: RemoteJudgmentHookAuthKind;
  /** Raw encoded Company Authority response verified by the canonical API. */
  companyAuthorityResponse?: string;
  /** The x-brainbase-judgment-host header, when the caller declared one. */
  declaredHost?: string;
  /** True only on the owner's loopback bridge for a shared-bearer request. */
  localClaudeCodeAllowed?: boolean;
  /** True only for a person authenticated by the hosted MCP's JWT boundary. */
  personHostedClaudeCodeAllowed?: boolean;
  isAuthorized: (authorization: string | undefined, expectedToken: string) => boolean;
  dispatch: RemoteJudgmentHookDispatch;
  /** Optional HTTP publisher for person-authenticated hosted Claude Code Stop events. */
  journalTurnPublisher?: (input: JudgmentJournalTurnInput) => Promise<void>;
  onDispatchError?: (details: {
    eventName: string;
    reason: string;
    errorName: string;
    errorCode?: string;
    causeReasonCode?: string;
  }) => void;
}

export interface RemoteJudgmentHookResponse {
  status: number;
  headers?: Record<string, string>;
  body: Record<string, unknown>;
}

const PROJECT_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SUPPORTED_HOOK_EVENTS = new Set(['UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure', 'Stop']);
// The owner's Claude Code also sends a knowledge lookup's PreToolUse, so the
// Host can reserve the attempt it later records. A remote runtime keeps the
// events above.
const CLAUDE_CODE_HOOK_EVENTS = new Set([...SUPPORTED_HOOK_EVENTS, 'PreToolUse']);
const SAFE_REASON_CODE = /^[a-z][a-z0-9_]{1,80}$/;
const FORBIDDEN_SCOPE_REASON_CODES = new Set([
  'judgment_history_scope_mismatch',
  'judgment_history_project_denied',
  'judgment_history_shared_bearer_denied',
  // Current scope binder wording; retain the explicit deny classification if
  // the binder has not yet adopted the shorter reason code above.
  'judgment_history_scope_shared_bearer_rejected',
]);

function isInternalJudgmentControlTool(payload: Record<string, unknown>): boolean {
  const toolName = payload.tool_name ?? payload.toolName;
  return typeof toolName === 'string'
    && ['mcp__brainbase__brainbase_judgment_state_record',
      'mcp__brainbase__brainbase_judgment_audit_read',
      'mcp__brainbase__brainbase_judgment_repair_read'].includes(toolName);
}

function safeCauseReasonCode(error: unknown): string | undefined {
  let current = typeof error === 'object' && error && 'cause' in error ? error.cause : undefined;
  const visited = new Set<unknown>();
  for (let depth = 0; depth < 6 && current && !visited.has(current); depth += 1) {
    visited.add(current);
    if (current instanceof Error && SAFE_REASON_CODE.test(current.message)) return current.message;
    current = typeof current === 'object' && 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

export async function handleRemoteJudgmentHookRequest(
  request: RemoteJudgmentHookRequest,
): Promise<RemoteJudgmentHookResponse | null> {
  if (request.method !== 'POST' || request.url !== REMOTE_JUDGMENT_HOOK_PATH) return null;

  if (!request.isAuthorized(request.authorization, request.bearerToken)) {
    return {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer' },
      body: { error: 'unauthorized' },
    };
  }
  if (request.body.length > REMOTE_JUDGMENT_HOOK_MAX_BODY_BYTES) {
    return { status: 413, body: { error: 'judgment_hook_payload_too_large' } };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(request.body.toString('utf8'));
  } catch {
    return { status: 400, body: { error: 'invalid_json' } };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { status: 400, body: { error: 'invalid_hook_payload' } };
  }
  const hookPayload = payload as Record<string, unknown>;
  const eventName = hookPayload.hook_event_name ?? hookPayload.hookEventName;
  if (typeof eventName !== 'string' || !CLAUDE_CODE_HOOK_EVENTS.has(eventName)) {
    return { status: 400, body: { error: 'unsupported_hook_event' } };
  }

  const personHostedClaudeCode = request.personHostedClaudeCodeAllowed === true
    && request.trustedAuthKind === 'brainbase-jwt';
  const host: RemoteJudgmentHookHost = request.declaredHost === undefined || request.declaredHost === ''
    ? 'remote' : 'claude-code';
  if (host === 'claude-code'
    && (request.declaredHost !== 'claude-code' || (request.localClaudeCodeAllowed !== true && !personHostedClaudeCode))) {
    return { status: 400, body: { error: 'judgment_hook_host_unsupported' } };
  }
  if (host === 'remote' && !SUPPORTED_HOOK_EVENTS.has(eventName)) {
    return { status: 400, body: { error: 'unsupported_hook_event' } };
  }
  // A local Claude Code turn may leave the project to the Host, which derives
  // it from the turn's cwd exactly as for Codex.
  const requiresProjectScope = host === 'remote' || (host === 'claude-code' && personHostedClaudeCode);
  if (host === 'claude-code' && personHostedClaudeCode
    && !request.trustedPrincipal?.tenantId?.trim()) {
    return { status: 403, body: { error: 'authenticated_history_principal_unavailable' } };
  }
  if ((requiresProjectScope || request.projectCode !== undefined)
    && (!request.projectCode || !PROJECT_CODE_PATTERN.test(request.projectCode))) {
    return { status: 400, body: { error: 'invalid_project_code' } };
  }
  if (requiresProjectScope && request.trustedPrincipal
    && (!request.projectCode || !request.trustedPrincipal.projectCodes.includes(request.projectCode))) {
    return { status: 403, body: { error: 'project_not_authorized' } };
  }
  if (request.trustedPrincipal && !request.trustedPrincipal.tenantId?.trim()) {
    return { status: 403, body: { error: 'authenticated_history_principal_unavailable' } };
  }
  const sessionId = hookPayload.session_id;
  const turnId = hookPayload.turn_id;
  if (typeof sessionId !== 'string' || !sessionId || typeof turnId !== 'string' || !turnId) {
    return { status: 400, body: { error: 'invalid_hook_identity' } };
  }
  try {
    const dispatchOptions: RemoteJudgmentHookDispatchOptions = request.trustedPrincipal
      ? {
        host,
        trustedPrincipal: request.trustedPrincipal,
        ...(request.trustedToken ? { trustedToken: request.trustedToken } : {}),
        ...(request.trustedAuthKind ? { trustedAuthKind: request.trustedAuthKind } : {}),
        ...(request.companyAuthorityResponse
          ? { companyAuthorityResponse: request.companyAuthorityResponse }
          : {}),
      }
      : { host };
    const dispatchResult = await request.dispatch(hookPayload, request.projectCode, dispatchOptions);
    const { output } = dispatchResult;
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      return { status: 503, body: { error: 'judgment_hook_output_invalid' } };
    }
    // The remote runtime's stream validator needs an audit line per tool. A
    // local Claude Code turn has no such validator; the Host decides alone.
    if (host === 'remote' && (eventName === 'PostToolUse' || eventName === 'PostToolUseFailure')
      && !isInternalJudgmentControlTool(hookPayload)
      && (typeof output.systemMessage !== 'string' || !output.systemMessage.trim())) {
      return { status: 503, body: { error: 'judgment_hook_audit_not_recorded' } };
    }
    if (eventName === 'UserPromptSubmit'
      && (typeof dispatchResult.receiptId !== 'string' || !dispatchResult.receiptId.trim()
        || typeof dispatchResult.routeResolutionSha256 !== 'string'
        || !/^[a-f0-9]{64}$/.test(dispatchResult.routeResolutionSha256))) {
      return { status: 503, body: { error: 'judgment_hook_route_receipt_missing' } };
    }
    if (eventName === 'Stop' && host === 'claude-code' && personHostedClaudeCode
      && request.localClaudeCodeAllowed !== true) {
      const report = (reason: string) => {
        try { console.warn(reason); } catch { /* Logging cannot affect the hook response. */ }
      };
      if (!request.journalTurnPublisher) report('judgment_journal_not_configured');
      else if (!request.trustedToken) report('judgment_journal_token_missing');
      else {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.resolve().then(() => request.journalTurnPublisher!({
              sessionId, turnId, projectCode: request.projectCode!, trustedToken: request.trustedToken!,
              trustedPrincipal: { personId: request.trustedPrincipal!.personId, tenantId: request.trustedPrincipal!.tenantId! },
            })),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(new Error()), 1500);
            }),
          ]);
        } catch { report('judgment_journal_publish_failed'); }
        finally { if (timer) clearTimeout(timer); }
      }
    }
    const hasRouteReceipt = typeof dispatchResult.receiptId === 'string'
      && dispatchResult.receiptId.trim().length > 0
      && typeof dispatchResult.routeResolutionSha256 === 'string'
      && /^[a-f0-9]{64}$/.test(dispatchResult.routeResolutionSha256);
    return {
      status: 200,
      body: {
        schema_version: '1', accepted: true,
        hook_event_name: eventName, session_id: sessionId, turn_id: turnId,
        ...((eventName === 'UserPromptSubmit' || eventName === 'Stop') && hasRouteReceipt ? {
          receipt_id: dispatchResult.receiptId,
          route_resolution_sha256: dispatchResult.routeResolutionSha256,
        } : {}),
        output,
      },
    };
  } catch (error) {
    const reason = error instanceof Error
      && /^judgment_[a-z0-9_]{1,80}$/.test(error.message)
      ? error.message
      : 'judgment_hook_unavailable';
    const errorCode = error && typeof error === 'object'
      && 'code' in error && typeof error.code === 'string'
      && /^[A-Z0-9_]{1,80}$/.test(error.code)
      ? error.code
      : undefined;
    const causeReasonCode = safeCauseReasonCode(error);
    request.onDispatchError?.({
      eventName,
      reason,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      ...(errorCode ? { errorCode } : {}),
      ...(causeReasonCode && causeReasonCode !== reason ? { causeReasonCode } : {}),
    });
    const status = FORBIDDEN_SCOPE_REASON_CODES.has(reason) ? 403 : 503;
    return { status, body: { error: reason } };
  }
}
