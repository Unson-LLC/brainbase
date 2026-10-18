/** Local MCP process and tool-call contracts. Host transports remain injected. */
export const MCP_RUNTIME_CONTRACT_VERSION = 'mcp_runtime.v1' as const;

export interface LocalMcpRuntimeDescriptor {
  packageName: string;
  command: string;
  transport: 'stdio';
  storage: 'local';
  hostedDependency: false;
}

export interface McpToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface McpToolReceipt {
  tool: string;
  status: 'accepted' | 'completed' | 'failed' | 'unknown';
  receiptKind: 'tool_result' | 'send_ack' | 'error';
  verified: boolean;
}

export class McpRuntimeContractError extends Error {
  readonly code = 'mcp_runtime_contract_invalid';

  constructor(field: string, message = `MCP runtime field is invalid: ${field}`) {
    super(message);
    this.name = 'McpRuntimeContractError';
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new McpRuntimeContractError(field);
  return value.trim();
}

export function normalizeLocalMcpRuntimeDescriptor(value: unknown): LocalMcpRuntimeDescriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new McpRuntimeContractError('descriptor');
  const candidate = value as Record<string, unknown>;
  if (candidate.transport !== 'stdio') throw new McpRuntimeContractError('transport', 'local MCP transport must be stdio');
  if (candidate.storage !== 'local') throw new McpRuntimeContractError('storage', 'local MCP storage must be local');
  if (candidate.hostedDependency !== false) throw new McpRuntimeContractError('hostedDependency', 'local MCP must not require a hosted dependency');
  return {
    packageName: text(candidate.packageName, 'packageName'),
    command: text(candidate.command, 'command'),
    transport: 'stdio',
    storage: 'local',
    hostedDependency: false
  };
}

export function normalizeMcpToolCall(value: unknown): McpToolCall {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new McpRuntimeContractError('call');
  const candidate = value as Record<string, unknown>;
  if (!candidate.arguments || typeof candidate.arguments !== 'object' || Array.isArray(candidate.arguments)) {
    throw new McpRuntimeContractError('arguments');
  }
  return {
    name: text(candidate.name, 'name'),
    arguments: structuredClone(candidate.arguments) as Record<string, unknown>
  };
}

export function createMcpToolReceipt(input: Pick<McpToolReceipt, 'tool' | 'status' | 'receiptKind' | 'verified'>): McpToolReceipt {
  const tool = text(input.tool, 'tool');
  if (!['accepted', 'completed', 'failed', 'unknown'].includes(input.status)) throw new McpRuntimeContractError('status');
  if (!['tool_result', 'send_ack', 'error'].includes(input.receiptKind)) throw new McpRuntimeContractError('receiptKind');
  if (typeof input.verified !== 'boolean') throw new McpRuntimeContractError('verified');
  return { tool, status: input.status, receiptKind: input.receiptKind, verified: input.verified };
}
