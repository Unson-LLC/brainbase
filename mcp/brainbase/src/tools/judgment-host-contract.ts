import type { ToolResult } from './authenticated-api-tool.js';

export type JudgmentManagementResult = {
  management_status: 'managed' | 'unmanaged';
  reason: string;
  warning: string;
  receipt: Record<string, unknown> | null;
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
  if (actionKind === 'write' || actionKind === 'external') return false;
  return result.management_status === 'managed';
}
