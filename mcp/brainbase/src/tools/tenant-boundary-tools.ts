import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const tenantBoundaryTools: Tool[] = [{
  name: 'authorize_tenant_resource',
  description: 'Authorize a tenant-owned Brainbase resource through the signed tenant runtime boundary before MCP read or write operations.',
  inputSchema: {
    type: 'object',
    properties: {
      tenant_context: {
        type: 'object',
        description: 'Canonical signed TenantContextEnvelope issued by Brainbase.',
      },
      resource_ref: {
        type: 'object',
        properties: {
          object_type: { type: 'string' },
          resource_id: { type: 'string' },
        },
        required: ['object_type', 'resource_id'],
        additionalProperties: false,
      },
    },
    required: ['tenant_context', 'resource_ref'],
    additionalProperties: false,
  },
}];

interface TenantBoundaryDependencies {
  apiUrl: string;
  serviceToken: string | undefined;
  fetchImpl?: typeof fetch;
}

export async function handleTenantBoundaryToolCall(
  name: string,
  args: Record<string, unknown>,
  dependencies: TenantBoundaryDependencies,
): Promise<unknown | null> {
  if (name !== 'authorize_tenant_resource') return null;
  if (!dependencies.serviceToken) throw new Error('Tenant runtime service authentication is unavailable');
  const tenantContext = args.tenant_context as Record<string, unknown> | undefined;
  const placement = tenantContext?.placement as Record<string, unknown> | undefined;
  if (typeof tenantContext?.protocol_version !== 'string'
    || typeof placement?.deployment_id !== 'string'
    || !args.resource_ref || typeof args.resource_ref !== 'object' || Array.isArray(args.resource_ref)) {
    throw new Error('Canonical tenant context and resource_ref are required');
  }
  const url = new URL('/api/v1/runtime/tenant-boundaries/mcp:authorize', dependencies.apiUrl);
  const response = await (dependencies.fetchImpl ?? fetch)(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${dependencies.serviceToken}`,
      'Brainbase-Protocol-Version': tenantContext.protocol_version,
      'Brainbase-Deployment-Id': placement.deployment_id,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tenant_context: tenantContext,
      resource_ref: args.resource_ref,
    }),
  });
  if (!response.ok) {
    throw new Error(`Tenant runtime authorization failed with status ${response.status}`);
  }
  return response.json();
}
