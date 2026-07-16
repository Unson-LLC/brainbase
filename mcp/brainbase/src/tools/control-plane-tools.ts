import type { Tool } from '@modelcontextprotocol/sdk/types.js';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface TokenManagerLike {
  getToken(): Promise<string>;
}

interface ControlPlaneDependencies {
  apiUrl: string;
  configuredProjectCodes?: string[];
  tokenManager: TokenManagerLike;
  fetch?: FetchLike;
  now?: () => Date;
  requestId?: () => string;
}

interface ProjectCatalogItem {
  id: string;
  name?: string;
  healthStatus?: string;
  [key: string]: unknown;
}

interface RunReceiptInboxItem {
  project_id: string;
  [key: string]: unknown;
}

interface ControlPlaneData {
  projects?: ProjectCatalogItem[];
  items?: RunReceiptInboxItem[];
  count: number;
  has_more?: boolean;
  omitted_count?: number;
}

interface AuditEvidence {
  request_id: string;
  tool: string;
  operation: 'read';
  actor: string | null;
  role: string | null;
  project_codes: string[];
  observed_at: string;
  source: string;
}

export interface ControlPlaneResult {
  status: 'ok' | 'unavailable' | 'error';
  scope: { project_codes: string[] };
  audit: AuditEvidence;
  data?: ControlPlaneData;
  error?: { code: string; message: string; http_status?: number };
}

interface AccessClaims {
  actor: string | null;
  role: string | null;
  projectCodes: string[];
}

export const controlPlaneTools: Tool[] = [
  {
    name: 'brainbase_projects',
    description:
      'List the authenticated Brainbase project catalog. Returns a structured status that distinguishes confirmed empty results from unavailable or error states, with project-scope and audit evidence.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'brainbase_run_receipt_inbox',
    description:
      'Read the authenticated Brainbase Run Receipt Inbox for cross-runtime automation evidence. Keeps blocked, unconfirmed, no_data, unavailable, and error states distinct. This is an operational receipt reader, not generic Workflow CRUD.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Optional project ID within the authenticated project scope.',
        },
        source_type: {
          type: 'string',
          enum: ['mana', 'codex_automations', 'github_actions', 'salestailor'],
          description: 'Optional automation runtime filter.',
        },
        run_status: {
          type: 'string',
          enum: ['success', 'failed', 'blocked', 'waiting_human', 'cancelled'],
          description: 'Optional source run status filter.',
        },
        evidence_state: {
          type: 'string',
          enum: ['confirmed', 'unconfirmed', 'no_data'],
          description: 'Optional evidence confidence filter.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          description: 'Maximum number of receipt identities to return. Defaults to 100.',
        },
      },
    },
  },
];

const RUN_RECEIPT_SOURCE_TYPES = new Set(['mana', 'codex_automations', 'github_actions', 'salestailor']);
const RUN_RECEIPT_STATUSES = new Set(['success', 'failed', 'blocked', 'waiting_human', 'cancelled']);
const RUN_RECEIPT_EVIDENCE_STATES = new Set(['confirmed', 'unconfirmed', 'no_data']);

function normalizeProjectCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  return normalized || null;
}

function normalizeProjectCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeProjectCode).filter((code): code is string => Boolean(code)))];
}

function decodeAccessClaims(token: string): AccessClaims {
  const jwt = token.startsWith('bbsvc_') ? token.slice('bbsvc_'.length) : token;
  const payloadSegment = jwt.split('.')[1];
  if (!payloadSegment) throw new Error('Token does not contain JWT claims');

  let payload: Record<string, unknown>;
  try {
    const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    payload = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    throw new Error('Token claims could not be decoded');
  }

  return {
    actor: typeof payload.sub === 'string'
      ? payload.sub
      : typeof payload.personId === 'string'
        ? payload.personId
        : null,
    role: typeof payload.role === 'string' ? payload.role.toLowerCase() : null,
    projectCodes: normalizeProjectCodes(payload.projectCodes),
  };
}

function effectiveProjectCodes(tokenCodes: string[], configuredCodes?: string[]): string[] {
  const configured = normalizeProjectCodes(configuredCodes);
  if (configured.length === 0) return tokenCodes;
  const allowed = new Set(configured);
  return tokenCodes.filter((code) => allowed.has(code));
}

function projectId(project: ProjectCatalogItem): string | null {
  return normalizeProjectCode(project.id);
}

function optionalStringArgument(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function optionalEnumArgument(
  args: Record<string, unknown>,
  key: string,
  allowed: Set<string>,
): string | null {
  const value = optionalStringArgument(args, key);
  if (value === null) return null;
  if (!allowed.has(value)) {
    throw new Error(`${key} must be one of: ${[...allowed].join(', ')}`);
  }
  return value;
}

function runReceiptInboxSource(
  apiUrl: string,
  args: Record<string, unknown>,
): { source: string; projectId: string | null } {
  const url = new URL('/api/run-receipts/inbox', `${apiUrl.replace(/\/+$/, '')}/`);
  const requestedProject = optionalStringArgument(args, 'project_id');
  const normalizedProject = requestedProject ? normalizeProjectCode(requestedProject) : null;
  if (requestedProject && !normalizedProject) throw new Error('project_id is invalid');

  const sourceType = optionalEnumArgument(args, 'source_type', RUN_RECEIPT_SOURCE_TYPES);
  const runStatus = optionalEnumArgument(args, 'run_status', RUN_RECEIPT_STATUSES);
  const evidenceState = optionalEnumArgument(args, 'evidence_state', RUN_RECEIPT_EVIDENCE_STATES);
  const rawLimit = args.limit;
  let limit: number | null = null;
  if (rawLimit !== undefined && rawLimit !== null && rawLimit !== '') {
    if (typeof rawLimit !== 'number' || !Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > 200) {
      throw new Error('limit must be an integer between 1 and 200');
    }
    limit = rawLimit;
  }

  if (normalizedProject) url.searchParams.set('project_id', normalizedProject);
  if (sourceType) url.searchParams.set('source_type', sourceType);
  if (runStatus) url.searchParams.set('run_status', runStatus);
  if (evidenceState) url.searchParams.set('evidence_state', evidenceState);
  if (limit !== null) url.searchParams.set('limit', String(limit));

  return { source: url.toString(), projectId: normalizedProject };
}

function parseRunReceiptInbox(payload: unknown, scope: string[]): ControlPlaneData {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Expected a Run Receipt Inbox object');
  }
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.items)) throw new Error('Run Receipt Inbox items must be an array');
  const items = record.items.filter((item): item is RunReceiptInboxItem => (
    Boolean(item)
      && typeof item === 'object'
      && !Array.isArray(item)
      && typeof (item as Record<string, unknown>).project_id === 'string'
  ));
  if (items.length !== record.items.length) throw new Error('Run Receipt Inbox contains invalid items');

  const count = record.count;
  const hasMore = record.has_more;
  const omittedCount = record.omitted_count;
  if (!Number.isSafeInteger(count) || (count as number) < items.length) {
    throw new Error('Run Receipt Inbox count is invalid');
  }
  if (typeof hasMore !== 'boolean') throw new Error('Run Receipt Inbox has_more is invalid');
  if (!Number.isSafeInteger(omittedCount) || (omittedCount as number) < 0) {
    throw new Error('Run Receipt Inbox omitted_count is invalid');
  }
  if ((omittedCount as number) !== (count as number) - items.length) {
    throw new Error('Run Receipt Inbox omitted_count does not match count');
  }
  if (hasMore !== ((omittedCount as number) > 0)) {
    throw new Error('Run Receipt Inbox has_more does not match omitted_count');
  }

  const allowed = new Set(scope);
  if (items.some((item) => {
    const normalized = normalizeProjectCode(item.project_id);
    return !normalized || !allowed.has(normalized);
  })) {
    throw new Error('Run Receipt Inbox contains an item outside the authenticated project scope');
  }

  return {
    items,
    count: count as number,
    has_more: hasMore,
    omitted_count: omittedCount as number,
  };
}

function createAudit(
  tool: string,
  source: string,
  claims: AccessClaims,
  projectCodes: string[],
  dependencies: ControlPlaneDependencies,
): AuditEvidence {
  return {
    request_id: dependencies.requestId?.() || globalThis.crypto.randomUUID(),
    tool,
    operation: 'read',
    actor: claims.actor,
    role: claims.role,
    project_codes: projectCodes,
    observed_at: (dependencies.now?.() || new Date()).toISOString(),
    source,
  };
}

function failure(
  status: 'unavailable' | 'error',
  code: string,
  message: string,
  scope: string[],
  audit: AuditEvidence,
  httpStatus?: number,
): ControlPlaneResult {
  return {
    status,
    scope: { project_codes: scope },
    audit,
    error: {
      code,
      message,
      ...(httpStatus ? { http_status: httpStatus } : {}),
    },
  };
}

export async function handleControlPlaneToolCall(
  name: string,
  args: Record<string, unknown>,
  dependencies: ControlPlaneDependencies,
): Promise<ControlPlaneResult | null> {
  if (!['brainbase_projects', 'brainbase_run_receipt_inbox'].includes(name)) return null;

  let source = name === 'brainbase_projects'
    ? `${dependencies.apiUrl.replace(/\/+$/, '')}/api/brainbase/projects`
    : `${dependencies.apiUrl.replace(/\/+$/, '')}/api/run-receipts/inbox`;
  let token: string;
  try {
    token = await dependencies.tokenManager.getToken();
  } catch (error) {
    const claims = { actor: null, role: null, projectCodes: [] };
    const audit = createAudit(name, source, claims, [], dependencies);
    return failure(
      'unavailable',
      'brainbase_auth_unavailable',
      error instanceof Error ? error.message : String(error),
      [],
      audit,
    );
  }

  let claims: AccessClaims;
  try {
    claims = decodeAccessClaims(token);
  } catch (error) {
    const unknownClaims = { actor: null, role: null, projectCodes: [] };
    const audit = createAudit(name, source, unknownClaims, [], dependencies);
    return failure(
      'error',
      'brainbase_auth_context_invalid',
      error instanceof Error ? error.message : String(error),
      [],
      audit,
    );
  }

  const scope = effectiveProjectCodes(claims.projectCodes, dependencies.configuredProjectCodes);
  let requestedProject: string | null = null;
  if (name === 'brainbase_run_receipt_inbox') {
    try {
      const request = runReceiptInboxSource(dependencies.apiUrl, args);
      source = request.source;
      requestedProject = request.projectId;
    } catch (error) {
      const audit = createAudit(name, source, claims, scope, dependencies);
      return failure(
        'error',
        'brainbase_input_invalid',
        error instanceof Error ? error.message : String(error),
        scope,
        audit,
      );
    }
  }

  const audit = createAudit(name, source, claims, scope, dependencies);
  if (requestedProject && !scope.includes(requestedProject)) {
    return failure(
      'error',
      'brainbase_project_not_accessible',
      `project '${requestedProject}' is not accessible`,
      scope,
      audit,
    );
  }

  let response: Response;
  try {
    response = await (dependencies.fetch || globalThis.fetch)(source, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-brainbase-projects': scope.join(','),
      },
    });
  } catch (error) {
    return failure(
      'unavailable',
      'brainbase_api_unavailable',
      error instanceof Error ? error.message : String(error),
      scope,
      audit,
    );
  }

  if (response.status === 401 || response.status === 403) {
    return failure(
      'error',
      'brainbase_auth_rejected',
      `${response.status} ${response.statusText}`.trim(),
      scope,
      audit,
      response.status,
    );
  }

  if (!response.ok) {
    const unavailable = response.status >= 500;
    return failure(
      unavailable ? 'unavailable' : 'error',
      unavailable ? 'brainbase_api_unavailable' : 'brainbase_api_error',
      `${response.status} ${response.statusText}`.trim(),
      scope,
      audit,
      response.status,
    );
  }

  if (name === 'brainbase_run_receipt_inbox') {
    try {
      const data = parseRunReceiptInbox(await response.json(), scope);
      return {
        status: 'ok',
        scope: { project_codes: scope },
        audit,
        data,
      };
    } catch (error) {
      return failure(
        'error',
        'brainbase_contract_error',
        error instanceof Error ? error.message : String(error),
        scope,
        audit,
      );
    }
  }

  let projects: ProjectCatalogItem[];
  try {
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error('Expected an array project catalog');
    projects = payload.filter((project): project is ProjectCatalogItem => (
      Boolean(project) && typeof project === 'object' && typeof project.id === 'string'
    ));
    if (projects.length !== payload.length) throw new Error('Project catalog contains invalid entries');
  } catch (error) {
    return failure(
      'error',
      'brainbase_contract_error',
      error instanceof Error ? error.message : String(error),
      scope,
      audit,
    );
  }

  const allowed = new Set(scope);
  const scopedProjects = projects.filter((project) => {
    const id = projectId(project);
    return id ? allowed.has(id) : false;
  });

  return {
    status: 'ok',
    scope: { project_codes: scope },
    audit,
    data: {
      projects: scopedProjects,
      count: scopedProjects.length,
    },
  };
}
