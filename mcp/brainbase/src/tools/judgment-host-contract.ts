import type { ToolResult } from './authenticated-api-tool.js';

export type JudgmentManagementResult = {
  management_status: 'managed' | 'unmanaged';
  reason: string;
  warning: string;
  receipt: Record<string, unknown> | null;
};

export type ManagedTurnResult<T> = {
  management_status: 'managed' | 'unmanaged';
  execution_status: 'continued' | 'stopped';
  reason: string;
  warning: string;
  receipt: Record<string, unknown> | null;
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
    warning: `Judgment Resolver is unmanaged (${reason}); do not perform write or external actions.`,
    receipt: null,
  };
}

export function canProceedWithAction(
  result: JudgmentManagementResult,
  actionKind: 'none' | 'read' | 'write' | 'external',
): boolean {
  return result.management_status === 'managed'
    && (actionKind === 'none' || actionKind === 'read');
}

export async function runManagedJudgmentTurn<T>({
  resolve,
  actionKind,
  authorizeAction,
  continueTurn,
}: {
  resolve: () => Promise<JudgmentManagementResult>;
  actionKind: 'none' | 'read' | 'write' | 'external';
  authorizeAction?: (context: {
    actionKind: 'write' | 'external';
    receipt: Record<string, unknown>;
    activeNodeDefinitions: Array<Record<string, unknown>>;
  }) => Promise<boolean> | boolean;
  continueTurn: (context: {
    receipt: Record<string, unknown>;
    activeNodeDefinitions: Array<Record<string, unknown>>;
  }) => Promise<T> | T;
}): Promise<ManagedTurnResult<T>> {
  const management = await resolve();
  const receipt = management.receipt;
  if (management.management_status !== 'managed' || receipt === null) {
    return {
      ...management,
      execution_status: 'stopped',
      output: null,
    };
  }
  if (!['none', 'read', 'write', 'external'].includes(actionKind)) {
    return {
      management_status: 'managed',
      execution_status: 'stopped',
      reason: 'judgment_action_kind_invalid',
      warning: `Judgment turn has an unsupported action kind (${String(actionKind)}); do not continue the turn.`,
      receipt,
      output: null,
    };
  }
  if (receipt.status !== 'resolved') {
    const reason = `judgment_${String(receipt.status || 'unresolved')}`;
    return {
      management_status: 'managed',
      execution_status: 'stopped',
      reason,
      warning: `Judgment Resolver stopped this managed turn (${reason}); clarification or policy resolution is required.`,
      receipt,
      output: null,
    };
  }
  const activeNodeDefinitions = receipt.active_node_definitions;
  if (!Array.isArray(activeNodeDefinitions)) {
    return {
      management_status: 'unmanaged',
      execution_status: 'stopped',
      reason: 'judgment_active_node_definitions_missing',
      warning: 'Judgment Resolver receipt has no executable active node definitions; do not continue the turn.',
      receipt: null,
      output: null,
    };
  }
  if (!canProceedWithAction(management, actionKind)
    && (authorizeAction === undefined || !await authorizeAction({
      actionKind: actionKind as 'write' | 'external',
      receipt,
      activeNodeDefinitions: activeNodeDefinitions as Array<Record<string, unknown>>,
    }))) {
    const reason = 'judgment_receipt_is_not_action_authorization';
    return {
      management_status: 'managed',
      execution_status: 'stopped',
      reason,
      warning: 'Judgment receipt constrains reasoning but does not authorize write or external actions.',
      receipt,
      output: null,
    };
  }
  const output = await continueTurn({
    receipt,
    activeNodeDefinitions: activeNodeDefinitions as Array<Record<string, unknown>>,
  });
  return {
    management_status: 'managed',
    execution_status: 'continued',
    reason: management.reason,
    warning: '',
    receipt,
    output,
  };
}
