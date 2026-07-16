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
  data?: { projects: ProjectCatalogItem[]; count: number };
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
];

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
  _args: Record<string, unknown>,
  dependencies: ControlPlaneDependencies,
): Promise<ControlPlaneResult | null> {
  if (name !== 'brainbase_projects') return null;

  const source = `${dependencies.apiUrl.replace(/\/+$/, '')}/api/brainbase/projects`;
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
  const audit = createAudit(name, source, claims, scope, dependencies);

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
