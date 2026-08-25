export type AuthenticatedApiDependencies = {
  apiUrl: string;
  configuredProjectCodes?: string[];
  tokenManager: { getToken(): Promise<string> };
  fetch?: typeof globalThis.fetch;
};

export type ToolResult = {
  status: 'ok' | 'error' | 'unavailable';
  scope: { project_codes: string[] };
  data?: unknown;
  error?: { code: string; message: string; http_status?: number; details?: unknown };
};

export type AuthenticatedProjectContext = {
  token: string;
  scope: string[];
};

export function toolError(
  status: 'error' | 'unavailable',
  code: string,
  message: string,
  scope: string[],
  httpStatus?: number,
  details?: unknown,
): ToolResult {
  return {
    status,
    scope: { project_codes: scope },
    error: {
      code,
      message,
      ...(httpStatus ? { http_status: httpStatus } : {}),
      ...(details !== undefined ? { details } : {}),
    },
  };
}
function decodeProjectCodes(token: string): string[] {
  const parts = token.split('.');
  if (parts.length < 2) throw new Error('invalid access token');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  const raw = Array.isArray(claims.projectCodes)
    ? claims.projectCodes
    : Array.isArray(claims.project_codes)
      ? claims.project_codes
      : [];
  return raw.filter((value): value is string => typeof value === 'string');
}

export async function authenticateProject(
  args: Record<string, unknown>,
  dependencies: AuthenticatedApiDependencies,
  options: { requireProject?: boolean } = {},
): Promise<AuthenticatedProjectContext | ToolResult> {
  let token: string;
  try {
    token = await dependencies.tokenManager.getToken();
  } catch (error) {
    return toolError('unavailable', 'brainbase_auth_unavailable', error instanceof Error ? error.message : String(error), []);
  }

  let claimsScope: string[];
  try {
    claimsScope = decodeProjectCodes(token);
  } catch (error) {
    return toolError('error', 'brainbase_auth_context_invalid', error instanceof Error ? error.message : String(error), []);
  }

  const configured = dependencies.configuredProjectCodes;
  const scope = configured?.length ? claimsScope.filter((code) => configured.includes(code)) : claimsScope;
  const requestedProject = typeof args.project_code === 'string' ? args.project_code : '';
  if ((options.requireProject && !requestedProject) || (requestedProject && !scope.includes(requestedProject))) {
    return toolError('error', 'brainbase_project_not_accessible', `project '${requestedProject}' is not accessible`, scope);
  }
  return { token, scope };
}

export async function fetchAuthenticatedJson(
  dependencies: AuthenticatedApiDependencies,
  context: AuthenticatedProjectContext,
  request: { path: string; method: string; body?: unknown; headers?: Record<string, string> },
): Promise<
  | { ok: true; response: Response; payload: unknown; payloadParsed: boolean }
  | { ok: false; result: ToolResult }
> {
  let response: Response;
  try {
    response = await (dependencies.fetch || globalThis.fetch)(
      `${dependencies.apiUrl.replace(/\/+$/, '')}${request.path}`,
      {
        method: request.method,
        headers: {
          ...request.headers,
          Authorization: `Bearer ${context.token}`,
          'x-brainbase-projects': context.scope.join(','),
          ...(request.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
      },
    );
  } catch (error) {
    return {
      ok: false,
      result: toolError('unavailable', 'brainbase_api_unavailable', error instanceof Error ? error.message : String(error), context.scope),
    };
  }

  try {
    return { ok: true, response, payload: await response.json(), payloadParsed: true };
  } catch {
    return { ok: true, response, payload: null, payloadParsed: false };
  }
}
