/**
 * Local MCP process and tool-call contracts.
 *
 * The runtime in this module deliberately owns only the SDK server and its
 * tool dispatch. HTTP, bearer tokens, tenant selection, graph/index access,
 * and provider I/O stay in the host and are supplied through tool callbacks
 * or an injected SDK transport.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
  type ServerNotification,
  type ServerRequest,
  type Tool
} from '@modelcontextprotocol/sdk/types.js';

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

export type LocalMcpToolHandler = (
  arguments_: Record<string, unknown>,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
) => CallToolResult | Promise<CallToolResult>;

export interface LocalMcpRuntimeTool {
  definition: Tool;
  handler: LocalMcpToolHandler;
}

export interface LocalMcpRuntimeOptions {
  name: string;
  version: string;
  instructions?: string;
  tools: readonly LocalMcpRuntimeTool[];
  /** The host may inject HTTP, stdio, or an in-memory SDK transport. */
  transport?: Transport;
}

export interface LocalMcpRuntimeHandle {
  readonly server: Server;
  readonly transport: Transport;
  close(): Promise<void>;
}

export class McpRuntimeContractError extends Error {
  readonly code = 'mcp_runtime_contract_invalid';

  constructor(field: string, message = `MCP runtime field is invalid: ${field}`) {
    super(message);
    this.name = 'McpRuntimeContractError';
  }
}

function cloneToolDefinition(definition: Tool): Tool {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new McpRuntimeContractError('tool.definition');
  }
  if (typeof definition.name !== 'string' || !definition.name.trim()) {
    throw new McpRuntimeContractError('tool.definition.name');
  }
  if (!definition.inputSchema || definition.inputSchema.type !== 'object') {
    throw new McpRuntimeContractError('tool.definition.inputSchema');
  }
  try {
    return structuredClone(definition);
  } catch {
    throw new McpRuntimeContractError('tool.definition', 'tool definition must be structured-cloneable');
  }
}

function textResult(text: string, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {})
  };
}

function normalizeRuntimeOptions(options: LocalMcpRuntimeOptions): {
  name: string;
  version: string;
  instructions?: string;
  tools: LocalMcpRuntimeTool[];
  transport?: Transport;
} {
  const name = text(options.name, 'name');
  const version = text(options.version, 'version');
  if (!Array.isArray(options.tools)) throw new McpRuntimeContractError('tools');

  const tools: LocalMcpRuntimeTool[] = [];
  const names = new Set<string>();
  for (const tool of options.tools) {
    if (!tool || typeof tool !== 'object' || typeof tool.handler !== 'function') {
      throw new McpRuntimeContractError('tool.handler');
    }
    const definition = cloneToolDefinition(tool.definition);
    if (names.has(definition.name)) {
      throw new McpRuntimeContractError('tools', `duplicate MCP tool name: ${definition.name}`);
    }
    names.add(definition.name);
    tools.push({ definition, handler: tool.handler });
  }

  return {
    name,
    version,
    ...(options.instructions === undefined ? {} : { instructions: text(options.instructions, 'instructions') }),
    tools,
    transport: options.transport
  };
}

/**
 * Create an SDK MCP server with a host-independent tool registry.
 *
 * The returned Server is intentionally transport agnostic. A host can connect
 * it to stdio, Streamable HTTP, or an in-memory transport without the OSS
 * package importing auth, tenant, deployment, or provider code.
 */
export function createLocalMcpServer(options: LocalMcpRuntimeOptions): Server {
  const normalized = normalizeRuntimeOptions(options);
  const toolsByName = new Map(normalized.tools.map((tool) => [tool.definition.name, tool]));
  const server = new Server(
    { name: normalized.name, version: normalized.version },
    {
      capabilities: { tools: {} },
      ...(normalized.instructions ? { instructions: normalized.instructions } : {})
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => ({
    tools: normalized.tools.map((tool) => structuredClone(tool.definition))
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
    const registered = toolsByName.get(request.params.name);
    if (!registered) return textResult(`Unknown tool: ${request.params.name}`, true);

    const arguments_ = request.params.arguments ?? {};
    try {
      return await registered.handler(structuredClone(arguments_), extra);
    } catch {
      return textResult(`Tool execution failed: ${request.params.name}`, true);
    }
  });

  return server;
}

/**
 * Start a local SDK runtime and return an explicit lifecycle handle.
 *
 * The default is stdio for local clients. Hosts that own HTTP/auth may inject
 * their transport and retain the same engine and tool contract.
 */
export async function runLocalMcpServer(options: LocalMcpRuntimeOptions): Promise<LocalMcpRuntimeHandle> {
  const normalized = normalizeRuntimeOptions(options);
  const server = createLocalMcpServer(normalized);
  const transport = normalized.transport ?? new StdioServerTransport();
  try {
    await server.connect(transport);
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw error;
  }

  let closed = false;
  return {
    server,
    transport,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await server.close();
    }
  };
}

export const createMcpRuntimeServer = createLocalMcpServer;
export const startLocalMcpRuntime = runLocalMcpServer;

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
