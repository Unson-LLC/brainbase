/** Portable Honcho v3 HTTP boundary. Credentials and identity are host ports. */
export const HONCHO_CONTRACT_VERSION = 'honcho.v1' as const;

export interface HonchoConfig {
  apiUrl: string;
  workspaceId: string;
}

export interface HonchoRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean>;
  body?: Record<string, unknown> | unknown[] | null;
}

export class HonchoContractError extends Error {
  readonly code = 'honcho_contract_invalid';

  constructor(field: string, message = `Honcho field is invalid: ${field}`) {
    super(message);
    this.name = 'HonchoContractError';
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new HonchoContractError(field);
  return value.trim();
}

export function normalizeHonchoConfig(value: unknown): HonchoConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HonchoContractError('config');
  const candidate = value as Record<string, unknown>;
  const rawUrl = requiredText(candidate.apiUrl, 'apiUrl');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HonchoContractError('apiUrl', 'apiUrl must be an absolute URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new HonchoContractError('apiUrl', 'apiUrl must use http or https');
  if (url.username || url.password || url.search || url.hash) {
    throw new HonchoContractError('apiUrl', 'apiUrl must not contain credentials, query, or hash components');
  }
  return {
    apiUrl: url.toString().replace(/\/+$/u, ''),
    workspaceId: requiredText(candidate.workspaceId ?? 'brainbase', 'workspaceId')
  };
}

export function honchoWorkspacePath(workspaceId: string): string {
  return `/v3/workspaces/${encodeURIComponent(requiredText(workspaceId, 'workspaceId'))}`;
}

export function createHonchoRequest(input: HonchoRequest): HonchoRequest {
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(input.method)) {
    throw new HonchoContractError('method');
  }
  const path = requiredText(input.path, 'path');
  if (!path.startsWith('/') || path.includes('://') || path.includes('\n') || path.includes('\r')) {
    throw new HonchoContractError('path');
  }
  if (input.query) {
    for (const [key, value] of Object.entries(input.query)) {
      if (!key || value === undefined || value === null) throw new HonchoContractError('query');
    }
  }
  return {
    method: input.method,
    path,
    query: input.query ? { ...input.query } : undefined,
    body: input.body === undefined ? undefined : input.body === null ? null : structuredClone(input.body)
  };
}

export function honchoRequestUrl(config: HonchoConfig, request: HonchoRequest): string {
  const normalized = normalizeHonchoConfig(config);
  const safeRequest = createHonchoRequest(request);
  const url = new URL(`${normalized.apiUrl}${safeRequest.path}`);
  for (const [key, value] of Object.entries(safeRequest.query ?? {})) url.searchParams.set(key, String(value));
  return url.toString();
}

export interface HonchoMessageInput {
  peer: string;
  content: string;
}

export function normalizeHonchoMessages(value: unknown): HonchoMessageInput[] {
  if (!Array.isArray(value) || value.length === 0) throw new HonchoContractError('messages');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new HonchoContractError(`messages.${index}`);
    const candidate = item as Record<string, unknown>;
    return {
      peer: requiredText(candidate.peer, `messages.${index}.peer`),
      content: requiredText(candidate.content, `messages.${index}.content`)
    };
  });
}
