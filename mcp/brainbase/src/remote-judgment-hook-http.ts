export const REMOTE_JUDGMENT_HOOK_PATH = '/host/judgment/hook';
export const REMOTE_JUDGMENT_HOOK_MAX_BODY_BYTES = 1024 * 1024;

export interface RemoteJudgmentHookDispatchResult {
  output: Record<string, unknown>;
  receiptId?: string;
  routeResolutionSha256?: string;
}

export type RemoteJudgmentHookDispatch = (
  payload: Record<string, unknown>,
  projectCode: string,
) => Promise<RemoteJudgmentHookDispatchResult>;

export interface RemoteJudgmentHookRequest {
  method?: string;
  url?: string;
  authorization?: string;
  body: Buffer;
  bearerToken: string;
  projectCode?: string;
  isAuthorized: (authorization: string | undefined, expectedToken: string) => boolean;
  dispatch: RemoteJudgmentHookDispatch;
}

export interface RemoteJudgmentHookResponse {
  status: number;
  headers?: Record<string, string>;
  body: Record<string, unknown>;
}

const PROJECT_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SUPPORTED_HOOK_EVENTS = new Set(['UserPromptSubmit', 'PostToolUse', 'Stop']);

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
  if (typeof eventName !== 'string' || !SUPPORTED_HOOK_EVENTS.has(eventName)) {
    return { status: 400, body: { error: 'unsupported_hook_event' } };
  }

  if (!request.projectCode || !PROJECT_CODE_PATTERN.test(request.projectCode)) {
    return { status: 400, body: { error: 'invalid_project_code' } };
  }
  const sessionId = hookPayload.session_id;
  const turnId = hookPayload.turn_id;
  if (typeof sessionId !== 'string' || !sessionId || typeof turnId !== 'string' || !turnId) {
    return { status: 400, body: { error: 'invalid_hook_identity' } };
  }
  try {
    const dispatchResult = await request.dispatch(hookPayload, request.projectCode);
    const { output } = dispatchResult;
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      return { status: 503, body: { error: 'judgment_hook_output_invalid' } };
    }
    if (eventName === 'PostToolUse'
      && (typeof output.systemMessage !== 'string' || !output.systemMessage.trim())) {
      return { status: 503, body: { error: 'judgment_hook_audit_not_recorded' } };
    }
    if (eventName === 'UserPromptSubmit'
      && (typeof dispatchResult.receiptId !== 'string' || !dispatchResult.receiptId.trim()
        || typeof dispatchResult.routeResolutionSha256 !== 'string'
        || !/^[a-f0-9]{64}$/.test(dispatchResult.routeResolutionSha256))) {
      return { status: 503, body: { error: 'judgment_hook_route_receipt_missing' } };
    }
    return {
      status: 200,
      body: {
        schema_version: '1', accepted: true,
        hook_event_name: eventName, session_id: sessionId, turn_id: turnId,
        ...(eventName === 'UserPromptSubmit' ? {
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
    return { status: 503, body: { error: reason } };
  }
}
