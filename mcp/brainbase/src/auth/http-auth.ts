export type McpHttpAuthMode = 'shared-bearer' | 'brainbase-jwt' | 'hybrid';

export interface McpPrincipal {
  personId: string;
  organizationId: string;
  projectCodes: string[];
  clearance: string[];
  role: string;
}

export type McpHttpAuthResult =
  | { ok: false }
  | { ok: true; token: string; kind: 'shared-bearer'; principal?: undefined }
  | { ok: true; token: string; kind: 'brainbase-jwt'; principal: McpPrincipal };

export interface McpHttpAuthOptions {
  mode: McpHttpAuthMode;
  sharedBearerToken: string;
  verifyUrl: string;
  requiredOrganizationId?: string;
  fetchImpl?: typeof fetch;
}

function bearerValue(authorization: string | undefined): string | null {
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return token || null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

export async function authenticateMcpHttpRequest(
  authorization: string | undefined,
  options: McpHttpAuthOptions,
): Promise<McpHttpAuthResult> {
  const token = bearerValue(authorization);
  if (!token) return { ok: false };

  if ((options.mode === 'shared-bearer' || options.mode === 'hybrid')
    && options.sharedBearerToken
    && token === options.sharedBearerToken) {
    return { ok: true, token, kind: 'shared-bearer' };
  }
  if (options.mode === 'shared-bearer' || !options.verifyUrl) return { ok: false };

  try {
    const response = await (options.fetchImpl ?? fetch)(options.verifyUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!response.ok) return { ok: false };
    const body = await response.json() as Record<string, unknown>;
    const access = body.access && typeof body.access === 'object'
      ? body.access as Record<string, unknown>
      : null;
    const personId = typeof access?.personId === 'string' ? access.personId.trim() : '';
    const organizationId = typeof access?.organizationId === 'string' ? access.organizationId.trim() : '';
    if (body.ok !== true || !personId || !organizationId) return { ok: false };
    if (options.requiredOrganizationId && organizationId !== options.requiredOrganizationId) return { ok: false };
    return {
      ok: true,
      token,
      kind: 'brainbase-jwt',
      principal: {
        personId,
        organizationId,
        projectCodes: stringList(access?.projectCodes),
        clearance: stringList(access?.clearance),
        role: typeof access?.role === 'string' && access.role.trim() ? access.role : 'member',
      },
    };
  } catch {
    return { ok: false };
  }
}
