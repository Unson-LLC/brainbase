import { TokenManager } from './token-manager.js';
import { stat } from 'node:fs/promises';

export interface TenantTokenRouteConfig {
  organization_id: string;
  token_file: string;
}

export interface TenantTokenRoute {
  tenant: string;
  organizationId: string;
  projectCodes: string[];
  token: string;
}

interface TenantCredential {
  tenant: string;
  organizationId: string;
  tokenFile: string;
  tokenManager: TokenManager;
}

export class TenantRoutingError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'TenantRoutingError';
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function decodeClaims(token: string): { organizationId: string; projectCodes: string[] } {
  const parts = token.split('.');
  if (parts.length !== 3) throw new TenantRoutingError('invalid_tenant_token', 'Configured tenant token is not a JWT.');
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new TenantRoutingError('invalid_tenant_token', 'Configured tenant token has an invalid JWT payload.');
  }
  const organizationId = nonEmptyString(payload.organizationId)
    ?? nonEmptyString(payload.organization_id)
    ?? nonEmptyString(payload.tenantId);
  if (!organizationId) {
    throw new TenantRoutingError('invalid_tenant_token', 'Configured tenant token has no organization identifier.');
  }
  const rawProjects = Array.isArray(payload.projectCodes)
    ? payload.projectCodes
    : Array.isArray(payload.project_codes)
      ? payload.project_codes
      : [];
  const projectCodes = [...new Set(rawProjects.map(nonEmptyString).filter((value): value is string => Boolean(value)))];
  return { organizationId, projectCodes };
}

function parseConfig(raw: string): TenantTokenRouteConfig[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new TenantRoutingError('invalid_tenant_config', 'BRAINBASE_MCP_TENANT_ROUTES_JSON must be valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TenantRoutingError('invalid_tenant_config', 'Tenant routes must be a JSON object keyed by tenant name.');
  }
  return Object.entries(value as Record<string, unknown>).map(([tenant, route]) => {
    if (!route || typeof route !== 'object' || Array.isArray(route)) {
      throw new TenantRoutingError('invalid_tenant_config', `Tenant route ${tenant} must be an object.`);
    }
    const record = route as Record<string, unknown>;
    if ('access_token' in record || 'refresh_token' in record || 'token' in record) {
      throw new TenantRoutingError('inline_credential_forbidden', `Tenant route ${tenant} must reference a token file, not inline credentials.`);
    }
    const organizationId = nonEmptyString(record.organization_id);
    const tokenFile = nonEmptyString(record.token_file);
    if (!tenant.trim() || !organizationId || !tokenFile) {
      throw new TenantRoutingError('invalid_tenant_config', `Tenant route ${tenant} requires organization_id and token_file.`);
    }
    return { organization_id: organizationId, token_file: tokenFile, tenant: tenant.trim() } as TenantTokenRouteConfig & { tenant: string };
  });
}

export class TenantTokenRouter {
  constructor(private readonly credentials: TenantCredential[]) {}

  private async loadRoute(credential: TenantCredential): Promise<TenantTokenRoute> {
    const tokenFileStat = await stat(credential.tokenFile).catch(() => {
      throw new TenantRoutingError('tenant_token_unavailable', `Tenant route ${credential.tenant} token file is unavailable.`);
    });
    if (!tokenFileStat.isFile() || (tokenFileStat.mode & 0o077) !== 0) {
      throw new TenantRoutingError(
        'insecure_token_file',
        `Tenant route ${credential.tenant} token file must be a regular file with mode 0600 or stricter.`,
      );
    }
    const token = await credential.tokenManager.getToken().catch((error: unknown) => {
      if (error instanceof Error && error.message.startsWith('Tenant mismatch:')) {
        throw new TenantRoutingError(
          'tenant_organization_mismatch',
          `Tenant route ${credential.tenant} token does not belong to its configured organization.`,
        );
      }
      throw error;
    });
    const claims = decodeClaims(token);
    if (claims.organizationId !== credential.organizationId) {
      throw new TenantRoutingError(
        'tenant_organization_mismatch',
        `Tenant route ${credential.tenant} expected organization ${credential.organizationId} but token belongs to ${claims.organizationId}.`,
      );
    }
    return { tenant: credential.tenant, organizationId: claims.organizationId, projectCodes: claims.projectCodes, token };
  }

  async resolve(args: Record<string, unknown>): Promise<TenantTokenRoute | undefined> {
    const tenant = nonEmptyString(args.tenant);
    const projectCode = nonEmptyString(args.project_code);
    const legacyProject = nonEmptyString(args.project);
    if (projectCode && legacyProject && projectCode !== legacyProject) {
      throw new TenantRoutingError('conflicting_project', 'project and project_code identify different tenant routes.');
    }
    const project = projectCode ?? legacyProject;
    if (!tenant && !project) return undefined;

    const tenantCredentials = tenant
      ? this.credentials.filter(credential => credential.tenant === tenant || credential.organizationId === tenant)
      : this.credentials;
    if (tenant && tenantCredentials.length !== 1) {
      throw new TenantRoutingError('unknown_tenant', `No unique configured tenant route exists for ${tenant}.`);
    }
    const tenantMatches = await Promise.all(tenantCredentials.map(credential => this.loadRoute(credential)));
    const projectMatches = project
      ? tenantMatches.filter(route => route.projectCodes.includes(project))
      : tenantMatches;
    if (project && projectMatches.length === 0) {
      throw new TenantRoutingError('unknown_project', `Project ${project} is not available in the selected tenant route.`);
    }
    if (projectMatches.length !== 1) {
      throw new TenantRoutingError('ambiguous_tenant', `Routing hints matched ${projectMatches.length} tenant routes.`);
    }
    return projectMatches[0];
  }
}

export function createTenantTokenRouterFromEnvironment(apiUrl: string): TenantTokenRouter | undefined {
  const raw = process.env.BRAINBASE_MCP_TENANT_ROUTES_JSON?.trim();
  if (!raw) return undefined;
  const routes = parseConfig(raw) as Array<TenantTokenRouteConfig & { tenant: string }>;
  if (routes.length === 0) throw new TenantRoutingError('invalid_tenant_config', 'At least one tenant route is required.');
  return new TenantTokenRouter(routes.map(route => ({
    tenant: route.tenant,
    organizationId: route.organization_id,
    tokenFile: route.token_file,
    tokenManager: new TokenManager(apiUrl, route.token_file, {
      allowEnvironmentToken: false,
      expectedOrganizationId: route.organization_id,
    }),
  })));
}
