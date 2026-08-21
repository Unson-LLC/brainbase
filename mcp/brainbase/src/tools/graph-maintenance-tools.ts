import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  authenticateProject, fetchAuthenticatedJson, toolError,
  type AuthenticatedApiDependencies as Dependencies, type ToolResult,
} from './authenticated-api-tool.js';

const project = { project_code: { type: 'string', minLength: 1 } } as const;
const operationNames = ['patch_entity', 'merge_entities', 'retire_entity', 'move_scope', 'rehome_entity', 'upsert_edge', 'retire_edge', 'normalize_alias'] as const;
const planId = { plan_id: { type: 'string', minLength: 1 } } as const;

export const graphMaintenanceTools: Tool[] = [
  {
    name: 'graph_export_snapshot',
    description: 'Export and persist a tenant/project-scoped Graph Entity/Edge snapshot with versions and a deterministic hash.',
    inputSchema: { type: 'object', properties: { ...project, include_project_codes: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true } }, required: ['project_code'], additionalProperties: false },
  },
  {
    name: 'graph_plan_mutations',
    description: 'Dry-run a bounded Graph maintenance plan. This does not mutate Graph state.',
    inputSchema: {
      type: 'object',
      properties: {
        ...project,
        snapshot_id: { type: 'string', minLength: 1 },
        idempotency_key: { type: 'string', minLength: 1, maxLength: 200 },
        reason: { type: 'string', minLength: 1, maxLength: 1000 },
        human_gate_receipt: { type: 'string', minLength: 1 },
        operations: {
          type: 'array', maxItems: 100,
          items: {
            type: 'object',
            properties: {
              operation: { type: 'string', enum: operationNames },
              entity_id: { type: 'string' }, source_entity_id: { type: 'string' }, target_entity_id: { type: 'string' },
              edge_id: { type: 'string' }, from_id: { type: 'string' }, to_id: { type: 'string' }, rel_type: { type: 'string' },
              expected_version: { type: 'integer', minimum: 0 }, source_expected_version: { type: 'integer', minimum: 1 },
              target_expected_version: { type: 'integer', minimum: 1 }, target_project_code: { type: 'string' },
              target_project_entity_id: { type: 'string', minLength: 1 }, membership_edge_id: { type: 'string', minLength: 1 },
              target_project_expected_version: { type: 'integer', minimum: 1 }, membership_expected_version: { type: 'integer', minimum: 1 },
              new_membership_expected_version: { type: 'integer', minimum: 0, maximum: 0 },
              patch: { type: 'object' }, payload: { type: 'object' }, aliases: { type: 'array', items: { type: 'string' } },
              role_min: { type: 'string', enum: ['member', 'gm', 'ceo'] },
              sensitivity: { type: 'string', enum: ['internal', 'restricted', 'finance', 'hr', 'contract'] },
              human_gate_receipt: { type: 'string' },
            },
            required: ['operation'], additionalProperties: false,
          },
        },
      },
      required: ['project_code', 'snapshot_id', 'idempotency_key', 'reason', 'operations'], additionalProperties: false,
    },
  },
  {
    name: 'graph_apply_plan', description: 'Idempotently apply a dry-run plan when its snapshot hash still matches.',
    inputSchema: { type: 'object', properties: { ...project, ...planId, snapshot_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' } }, required: ['project_code', 'plan_id', 'snapshot_hash'], additionalProperties: false },
  },
  {
    name: 'graph_get_plan_receipt', description: 'Read immutable apply and rollback receipts for a Graph maintenance plan.',
    inputSchema: { type: 'object', properties: { ...project, ...planId }, required: ['project_code', 'plan_id'], additionalProperties: false },
  },
  {
    name: 'graph_rollback_plan', description: 'Rollback an applied plan using its exact apply receipt and persisted before image.',
    inputSchema: { type: 'object', properties: { ...project, ...planId, apply_receipt_id: { type: 'string', minLength: 1 } }, required: ['project_code', 'plan_id', 'apply_receipt_id'], additionalProperties: false },
  },
  {
    name: 'graph_validate', description: 'Validate ontology, referential integrity, duplicates, orphans, versions, and snapshot hash.',
    inputSchema: { type: 'object', properties: { ...project, include_project_codes: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true } }, required: ['project_code'], additionalProperties: false },
  },
];

function requestFor(name: string, args: Record<string, unknown>) {
  const id = encodeURIComponent(String(args.plan_id || ''));
  if (name === 'graph_export_snapshot') return { path: '/api/info/graph/maintenance/snapshots', method: 'POST', body: { project_code: args.project_code, ...(args.include_project_codes ? { include_project_codes: args.include_project_codes } : {}) } };
  if (name === 'graph_plan_mutations') return { path: '/api/info/graph/maintenance/plans', method: 'POST', body: args };
  if (name === 'graph_apply_plan') return { path: `/api/info/graph/maintenance/plans/${id}/apply`, method: 'POST', body: { project_code: args.project_code, snapshot_hash: args.snapshot_hash } };
  if (name === 'graph_get_plan_receipt') return { path: `/api/info/graph/maintenance/plans/${id}/receipt?project_code=${encodeURIComponent(String(args.project_code))}`, method: 'GET' };
  if (name === 'graph_rollback_plan') return { path: `/api/info/graph/maintenance/plans/${id}/rollback`, method: 'POST', body: { project_code: args.project_code, apply_receipt_id: args.apply_receipt_id } };
  return { path: '/api/info/graph/maintenance/validate', method: 'POST', body: { project_code: args.project_code, ...(args.include_project_codes ? { include_project_codes: args.include_project_codes } : {}) } };
}

export async function handleGraphMaintenanceToolCall(name: string, args: Record<string, unknown>, dependencies: Dependencies): Promise<ToolResult | null> {
  if (!graphMaintenanceTools.some((tool) => tool.name === name)) return null;
  const context = await authenticateProject(args, dependencies, { requireProject: true });
  if ('status' in context) return context;
  const requestedScopes = (name === 'graph_export_snapshot' || name === 'graph_validate') && Array.isArray(args.include_project_codes)
    ? [...new Set([String(args.project_code), ...args.include_project_codes.map(String)])]
    : name === 'graph_plan_mutations' && Array.isArray(args.operations)
      ? [...new Set([String(args.project_code), ...args.operations.flatMap((operation) => {
          if (!operation || typeof operation !== 'object') return [];
          const code = (operation as { target_project_code?: unknown }).target_project_code;
          return typeof code === 'string' && code ? [code] : [];
        })])]
      : [String(args.project_code)];
  const inaccessible = requestedScopes.find((code) => !context.scope.includes(code));
  if (inaccessible) return toolError('error', 'brainbase_project_not_accessible', `Project is not accessible: ${inaccessible}`, context.scope);
  const fetched = await fetchAuthenticatedJson(dependencies, context, requestFor(name, args));
  if (!fetched.ok) return fetched.result;
  if (!fetched.response.ok) {
    const message = fetched.payloadParsed && fetched.payload && typeof fetched.payload === 'object'
      ? String((fetched.payload as { error?: unknown }).error || fetched.response.statusText)
      : fetched.response.statusText;
    return toolError(fetched.response.status >= 500 ? 'unavailable' : 'error', 'graph_maintenance_api_error', message, context.scope, fetched.response.status);
  }
  if (!fetched.payloadParsed || !fetched.payload || typeof fetched.payload !== 'object') {
    return toolError('error', 'graph_maintenance_response_invalid', 'Brainbase API returned malformed Graph maintenance data', context.scope, fetched.response.status);
  }
  return { status: 'ok', scope: { project_codes: context.scope }, data: fetched.payload };
}
