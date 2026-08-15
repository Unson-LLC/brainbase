import type { Tool } from '@modelcontextprotocol/sdk/types.js';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface MeetingMinutesContextToolDependencies {
  apiUrl: string;
  getToken: () => Promise<string>;
  fetch?: FetchLike;
}

type ReceiptStatus = 'resolved' | 'confirmed_empty' | 'partial' | 'unavailable';

export interface MeetingMinutesContextToolResult {
  status: 'ok' | 'partial' | 'unavailable' | 'error';
  receipt?: Record<string, unknown>;
  error?: { code: string; message: string; http_status?: number };
}

export const meetingMinutesContextTools: Tool[] = [{
  name: 'brainbase_get_meeting_minutes_context',
  description:
    'Retrieve the exact identity-bound Brainbase context Receipt prepared for one meeting-minutes run. '
    + 'Always pass all four identity fields from the generation request. Partial or unavailable context is explicit and must not be treated as empty.',
  inputSchema: {
    type: 'object',
    properties: {
      receipt_id: { type: 'string' },
      run_id: { type: 'string' },
      project_code: { type: 'string' },
      transcript_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    },
    required: ['receipt_id', 'run_id', 'project_code', 'transcript_sha256'],
    additionalProperties: false,
  },
}];

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`);
  return value.trim();
}

function errorResult(code: string, message: string, httpStatus?: number): MeetingMinutesContextToolResult {
  return { status: 'error', error: { code, message, ...(httpStatus ? { http_status: httpStatus } : {}) } };
}

function validateReceipt(
  value: unknown,
  expected: { receiptId: string; runId: string; projectCode: string; transcriptSha256: string },
): MeetingMinutesContextToolResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return errorResult('meeting_minutes_context_invalid_receipt', 'Brainbase returned an invalid context Receipt');
  }
  const receipt = value as Record<string, unknown>;
  const identity = receipt.identity;
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    return errorResult('meeting_minutes_context_invalid_receipt', 'Brainbase returned a Receipt without identity');
  }
  const bound = identity as Record<string, unknown>;
  if (
    receipt.receipt_id !== expected.receiptId
    || bound.run_id !== expected.runId
    || bound.project_code !== expected.projectCode
    || bound.transcript_sha256 !== expected.transcriptSha256
  ) {
    return errorResult('meeting_minutes_context_identity_mismatch', 'Brainbase context Receipt identity did not match this run');
  }
  const status = receipt.status as ReceiptStatus;
  if (!['resolved', 'confirmed_empty', 'partial', 'unavailable'].includes(status)) {
    return errorResult('meeting_minutes_context_invalid_receipt', 'Brainbase returned an unknown context Receipt status');
  }
  return {
    status: status === 'resolved' || status === 'confirmed_empty' ? 'ok' : status,
    receipt,
  };
}

export async function handleMeetingMinutesContextToolCall(
  name: string,
  args: Record<string, unknown>,
  dependencies: MeetingMinutesContextToolDependencies,
): Promise<MeetingMinutesContextToolResult | null> {
  if (name !== 'brainbase_get_meeting_minutes_context') return null;
  try {
    const receiptId = requiredString(args, 'receipt_id');
    const runId = requiredString(args, 'run_id');
    const projectCode = requiredString(args, 'project_code');
    const transcriptSha256 = requiredString(args, 'transcript_sha256');
    if (!/^[0-9a-f]{64}$/.test(transcriptSha256)) throw new Error('transcript_sha256 must be a lowercase SHA-256');
    const token = await dependencies.getToken();
    if (!token) return errorResult('meeting_minutes_context_auth_unavailable', 'Brainbase service token is unavailable');
    const url = new URL(`/api/meeting-minutes/context-receipts/${encodeURIComponent(receiptId)}`, dependencies.apiUrl);
    url.searchParams.set('run_id', runId);
    url.searchParams.set('project_code', projectCode);
    url.searchParams.set('transcript_sha256', transcriptSha256);
    const response = await (dependencies.fetch ?? globalThis.fetch)(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      redirect: 'error',
    });
    const text = await response.text();
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { return errorResult('meeting_minutes_context_invalid_response', 'Brainbase returned non-JSON context', response.status); }
    if (!response.ok) {
      const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      return errorResult(
        typeof record.code === 'string' ? record.code : 'meeting_minutes_context_request_failed',
        typeof record.error === 'string' ? record.error : 'Brainbase context request failed',
        response.status,
      );
    }
    return validateReceipt(payload, { receiptId, runId, projectCode, transcriptSha256 });
  } catch (error) {
    return errorResult('meeting_minutes_context_request_failed', error instanceof Error ? error.message : String(error));
  }
}
