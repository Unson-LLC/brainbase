import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const TOOL_NAME = 'brainbase_get_shareable_person_profile';
const SLACK_USER_ID_PATTERN = /^U[A-Z0-9]+$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_COMPANY_AUTHORITY_RESPONSE_BYTES = 12 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const PROFILE_FIELD_NAMES = ['name', 'affiliation', 'role'] as const;
const DISCLOSURE_FIELD_NAMES = [
  'digest',
  'workspace_id',
  'channel_id',
  'thread_ts',
  'requester_person_id',
  'target_person_id',
  'policy_revision',
] as const;

type ProfileFieldName = typeof PROFILE_FIELD_NAMES[number];

export type ShareablePersonProfileDisclosure = {
  digest: string;
  workspace_id: string;
  channel_id: string;
  thread_ts: string | null;
  requester_person_id: string;
  target_person_id: string;
  policy_revision: string;
};

export type ShareablePersonProfileFields = Partial<Record<ProfileFieldName, string>>;

export type ShareablePersonProfile = {
  status: 'ok' | 'unavailable';
  target_slack_user_id: string;
  fields: ShareablePersonProfileFields;
  disclosure?: ShareablePersonProfileDisclosure;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ShareablePersonProfileToolDependencies = {
  apiUrl: string;
  serviceToken?: string;
  companyAuthorityResponse?: string;
  fetch?: FetchLike;
};

export const shareablePersonProfileTools: Tool[] = [{
  name: TOOL_NAME,
  description:
    'Retrieve only the name, affiliation, and role that Brainbase has explicitly authorized for the actual Slack requester and reply destination. '
    + 'The target must be an exact Slack user ID; requester, tenant, workspace, channel, thread, and disclosure policy come from the trusted execution context.',
  inputSchema: {
    type: 'object',
    properties: {
      target_slack_user_id: {
        type: 'string',
        pattern: SLACK_USER_ID_PATTERN.source,
        description: 'Exact Slack user ID for the person whose shareable profile is requested.',
      },
    },
    required: ['target_slack_user_id'],
    additionalProperties: false,
  },
}];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function hasAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function requiredTargetSlackUserId(args: Record<string, unknown>): string {
  if (!isRecord(args)
    || !hasOnlyKeys(args, ['target_slack_user_id'])
    || typeof args.target_slack_user_id !== 'string'
    || !SLACK_USER_ID_PATTERN.test(args.target_slack_user_id)) {
    throw new Error('target_slack_user_id must be an exact Slack user ID');
  }
  return args.target_slack_user_id;
}

function unavailable(targetSlackUserId: string): ShareablePersonProfile {
  return {
    status: 'unavailable',
    target_slack_user_id: targetSlackUserId,
    fields: {},
  };
}

export function decodeCompanyAuthorityResponse(encoded: unknown): unknown | null {
  if (typeof encoded !== 'string' || encoded.length === 0) return null;
  if (Buffer.byteLength(encoded, 'utf8') > MAX_COMPANY_AUTHORITY_RESPONSE_BYTES
    || !BASE64URL_PATTERN.test(encoded)) return null;

  let decoded: Buffer;
  try {
    decoded = Buffer.from(encoded, 'base64url');
  } catch {
    return null;
  }
  if (decoded.length === 0
    || decoded.length > MAX_COMPANY_AUTHORITY_RESPONSE_BYTES
    || decoded.toString('base64url') !== encoded) return null;

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
  } catch {
    return null;
  }
  try {
    const value = JSON.parse(text) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function validateDisclosure(value: unknown): ShareablePersonProfileDisclosure | null {
  if (!isRecord(value) || !hasOnlyKeys(value, DISCLOSURE_FIELD_NAMES)) return null;
  if (typeof value.digest !== 'string'
    || typeof value.workspace_id !== 'string'
    || typeof value.channel_id !== 'string'
    || (value.thread_ts !== null && typeof value.thread_ts !== 'string')
    || typeof value.requester_person_id !== 'string'
    || typeof value.target_person_id !== 'string'
    || typeof value.policy_revision !== 'string'
    || !SHA256_HEX_PATTERN.test(value.digest)
    || !value.workspace_id.trim()
    || !value.channel_id.trim()
    || (value.thread_ts !== null && !value.thread_ts.trim())
    || !value.requester_person_id.trim()
    || !value.target_person_id.trim()
    || !value.policy_revision.trim()) {
    return null;
  }
  return {
    digest: value.digest,
    workspace_id: value.workspace_id,
    channel_id: value.channel_id,
    thread_ts: value.thread_ts,
    requester_person_id: value.requester_person_id,
    target_person_id: value.target_person_id,
    policy_revision: value.policy_revision,
  };
}

function validateProfileResponse(value: unknown, targetSlackUserId: string): ShareablePersonProfile | null {
  if (!isRecord(value)
    || !hasAllowedKeys(value, ['status', 'target_slack_user_id', 'fields', 'disclosure'])
    || (value.status !== 'ok' && value.status !== 'unavailable')
    || value.target_slack_user_id !== targetSlackUserId
    || !isRecord(value.fields)
    || !hasAllowedKeys(value.fields, PROFILE_FIELD_NAMES)) {
    return null;
  }

  const fields: ShareablePersonProfileFields = {};
  for (const field of PROFILE_FIELD_NAMES) {
    if (Object.hasOwn(value.fields, field)) {
      if (typeof value.fields[field] !== 'string' || !value.fields[field].trim()) return null;
      fields[field] = value.fields[field] as string;
    }
  }

  const disclosure = value.disclosure === undefined
    ? undefined
    : validateDisclosure(value.disclosure);
  if (value.disclosure !== undefined && disclosure === null) return null;
  if (value.status === 'ok'
    && (Object.keys(fields).length === 0 || disclosure === undefined)) return null;
  if (value.status === 'unavailable'
    && (Object.keys(fields).length > 0 || value.disclosure !== undefined)) return null;

  return {
    status: value.status,
    target_slack_user_id: targetSlackUserId,
    fields,
    ...(disclosure ? { disclosure } : {}),
  };
}

export async function handleShareablePersonProfileToolCall(
  name: string,
  args: Record<string, unknown>,
  dependencies: ShareablePersonProfileToolDependencies,
): Promise<ShareablePersonProfile | null> {
  if (name !== TOOL_NAME) return null;
  const targetSlackUserId = requiredTargetSlackUserId(args);
  if (!dependencies.serviceToken || !dependencies.companyAuthorityResponse) {
    return unavailable(targetSlackUserId);
  }

  const companyAuthorityResponse = decodeCompanyAuthorityResponse(dependencies.companyAuthorityResponse);
  if (!companyAuthorityResponse) return unavailable(targetSlackUserId);

  let url: URL;
  try {
    url = new URL('/api/v1/runtime/person-profile:read', dependencies.apiUrl);
  } catch {
    return unavailable(targetSlackUserId);
  }
  let response: Response;
  try {
    response = await (dependencies.fetch ?? globalThis.fetch)(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${dependencies.serviceToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        company_authority_response: companyAuthorityResponse,
        target_slack_user_id: targetSlackUserId,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return unavailable(targetSlackUserId);
  }

  if (!response.ok) {
    // Consume the body without parsing or returning it. Error responses may
    // contain private Graph details and are never part of this MCP contract.
    try { await response.text(); } catch { /* keep the fixed unavailable result */ }
    return unavailable(targetSlackUserId);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await response.text()) as unknown;
  } catch {
    return unavailable(targetSlackUserId);
  }
  return validateProfileResponse(payload, targetSlackUserId) ?? unavailable(targetSlackUserId);
}

export const __testing = {
  decodeCompanyAuthorityResponse,
  validateProfileResponse,
};
