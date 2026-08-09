import type { ToolResult } from './authenticated-api-tool.js';

export type JudgmentManagementResult = {
  management_status: 'managed' | 'unmanaged';
  reason: string;
  warning: string;
  receipt: Record<string, unknown> | null;
};

export type ManagedTurnResult<T> = JudgmentManagementResult & {
  execution_status: 'continued' | 'stopped';
  output: T | null;
};

function isManagedReceipt(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  const binding = receipt.host_binding;
  return typeof receipt.resolution_id === 'string'
    && binding !== null
    && typeof binding === 'object'
    && !Array.isArray(binding)
    && (binding as Record<string, unknown>).status === 'managed';
}

export function normalizeJudgmentHostResult(result: ToolResult): JudgmentManagementResult {
  if (result.status === 'ok' && isManagedReceipt(result.data)) {
    return {
      management_status: 'managed',
      reason: 'verified_judgment_receipt',
      warning: '',
      receipt: result.data,
    };
  }
  const reason = result.error?.code ?? (result.status === 'ok' ? 'judgment_receipt_missing' : 'judgment_resolver_unavailable');
  return {
    management_status: 'unmanaged',
    reason,
    warning: `Judgment Resolver is unmanaged (${reason}); model generation must not begin.`,
    receipt: null,
  };
}

/**
 * Adopt one verified receipt before model generation and pass its active DAG to
 * the model boundary. Action authorization belongs to the normal executor and
 * is intentionally not re-decided here.
 */
export async function runManagedJudgmentTurn<T>({
  resolve,
  continueTurn,
}: {
  resolve: () => Promise<JudgmentManagementResult>;
  continueTurn: (context: {
    receipt: Record<string, unknown>;
    activeNodeDefinitions: Array<Record<string, unknown>>;
  }) => Promise<T> | T;
}): Promise<ManagedTurnResult<T>> {
  const management = await resolve();
  const receipt = management.receipt;
  if (management.management_status !== 'managed' || receipt === null) {
    return { ...management, execution_status: 'stopped', output: null };
  }
  const activeNodeDefinitions = receipt.active_node_definitions;
  if (!Array.isArray(activeNodeDefinitions)) {
    return {
      management_status: 'unmanaged',
      execution_status: 'stopped',
      reason: 'judgment_active_node_definitions_missing',
      warning: 'Judgment Resolver receipt has no active node definitions; model generation must not begin.',
      receipt: null,
      output: null,
    };
  }
  const output = await continueTurn({
    receipt,
    activeNodeDefinitions: activeNodeDefinitions as Array<Record<string, unknown>>,
  });
  return { ...management, execution_status: 'continued', warning: '', output };
}
