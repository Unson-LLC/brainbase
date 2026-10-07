import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type CallToolResult,
  type ServerNotification,
  type ServerRequest
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { resolveDataDir } from './paths.js';
import { loadPersonalOs } from './ssot.js';
import { getContext, listEntities, onboardingStatus, searchAll, searchPersonalKg } from './tools.js';

const argsSchema = z.object({
  dataDir: z.string().optional(),
  query: z.string().optional(),
  limit: z.number().int().positive().max(50).optional(),
  type: z.enum(['person', 'org', 'project', 'relationship', 'decision']).optional()
});

export type ToolCallAuthorizationRequest = {
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolCallAuthorizationContext = RequestHandlerExtra<ServerRequest, ServerNotification>;

export const toolCallAuthorizationRejectionCodes = [
  'agent_credential_expired',
  'agent_credential_revoked',
  'agent_tenant_mismatch',
  'agent_policy_stale',
  'agent_scope_denied',
  'tenant_mismatch',
  'policy_stale',
  'scope_denied'
] as const;

export type ToolCallAuthorizationRejectionCode =
  (typeof toolCallAuthorizationRejectionCodes)[number];

export type ToolCallAuthorizationDecision =
  | boolean
  | {
      authorized: boolean;
      code?: ToolCallAuthorizationRejectionCode;
      correlationId?: string;
    };

export type AuthorizeToolCall = (
  request: ToolCallAuthorizationRequest,
  context: ToolCallAuthorizationContext
) => ToolCallAuthorizationDecision | Promise<ToolCallAuthorizationDecision>;

export type CreateServerOptions = {
  authorizeToolCall?: AuthorizeToolCall;
};

const TOOL_CALL_NOT_AUTHORIZED_CODE = 'tool_call_not_authorized';
const TOOL_CALL_NOT_AUTHORIZED_MESSAGE = 'Tool call was not authorized.';
const SAFE_CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const toolCallAuthorizationRejectionCodeSet = new Set<string>(
  toolCallAuthorizationRejectionCodes
);

type SafeAuthorizationFailure = {
  code?: ToolCallAuthorizationRejectionCode;
  correlationId?: string;
};

function readSafeAuthorizationFailure(value: unknown): SafeAuthorizationFailure {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    return {};
  }

  try {
    const candidate = value as {
      code?: unknown;
      correlationId?: unknown;
    };
    const code =
      typeof candidate.code === 'string' && toolCallAuthorizationRejectionCodeSet.has(candidate.code)
        ? (candidate.code as ToolCallAuthorizationRejectionCode)
        : undefined;
    const correlationId =
      typeof candidate.correlationId === 'string' &&
      SAFE_CORRELATION_ID_PATTERN.test(candidate.correlationId)
        ? candidate.correlationId
        : undefined;

    return {
      ...(code ? { code } : {}),
      ...(correlationId ? { correlationId } : {})
    };
  } catch {
    return {};
  }
}

function toolCallAuthorizationError(value?: unknown): CallToolResult {
  const failure = readSafeAuthorizationFailure(value);
  const error = {
    code: failure.code ?? TOOL_CALL_NOT_AUTHORIZED_CODE,
    message: TOOL_CALL_NOT_AUTHORIZED_MESSAGE,
    ...(failure.correlationId ? { correlationId: failure.correlationId } : {})
  };
  const structuredContent = { error };

  return {
    isError: true,
    structuredContent,
    content: [
      {
        type: 'text',
        text: JSON.stringify(structuredContent)
      }
    ]
  };
}

export const toolDefinitions = [
  {
    name: 'get_context',
    description: 'Return initial AI context from local Graph and Personal KG canonical files.',
    inputSchema: {
      type: 'object',
      properties: {
        dataDir: { type: 'string' }
      }
    }
  },
  {
    name: 'list_entities',
    description: 'List person, org, project, relationship, and decision entities from local SSOT.',
    inputSchema: {
      type: 'object',
      properties: {
        dataDir: { type: 'string' },
        type: { enum: ['person', 'org', 'project', 'relationship', 'decision'] }
      }
    }
  },
  {
    name: 'search',
    description: 'Search canonical local Graph, Personal KG, relationships, and decisions.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        dataDir: { type: 'string' },
        query: { type: 'string' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'search_personal_kg',
    description: 'Search owner-local Personal KG only.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        dataDir: { type: 'string' },
        query: { type: 'string' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'onboarding_status',
    description: 'Report seeded areas, first value demo readiness, missing setup, and local connection status.',
    inputSchema: {
      type: 'object',
      properties: {
        dataDir: { type: 'string' }
      }
    }
  }
] as const;

export async function callBrainbaseTool(name: string, rawArgs: unknown = {}): Promise<unknown> {
  const args = argsSchema.parse(rawArgs ?? {});
  const dataDir = resolveDataDir(args.dataDir);
  const os = await loadPersonalOs(dataDir);

  switch (name) {
    case 'get_context':
      return getContext(os);
    case 'list_entities':
      return listEntities(os, args.type);
    case 'search':
      if (!args.query) {
        throw new Error('search requires query');
      }
      return { results: searchAll(os, args.query, args.limit) };
    case 'search_personal_kg':
      if (!args.query) {
        throw new Error('search_personal_kg requires query');
      }
      return { results: searchPersonalKg(os, args.query, args.limit) };
    case 'onboarding_status':
      return onboardingStatus(os);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function handleToolCall(
  request: CallToolRequest['params'],
  context: ToolCallAuthorizationContext,
  options: CreateServerOptions = {}
): Promise<CallToolResult> {
  if (options.authorizeToolCall) {
    try {
      const authorized = await options.authorizeToolCall(
        {
          name: request.name,
          arguments: request.arguments ?? {}
        },
        context
      );

      if (authorized === true || (typeof authorized === 'object' && authorized?.authorized === true)) {
        // Continue to the local tool only after an explicit approval.
      } else {
        return toolCallAuthorizationError(authorized);
      }
    } catch (error) {
      return toolCallAuthorizationError(error);
    }
  }

  const result = await callBrainbaseTool(request.name, request.arguments);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
}

export function createServer(options: CreateServerOptions = {}): Server {
  const server = new Server(
    {
      name: 'brainbase-mcp',
      version: '0.1.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...toolDefinitions]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
    handleToolCall(request.params, extra, options)
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
