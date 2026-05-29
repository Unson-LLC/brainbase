#!/usr/bin/env node
/**
 * Jibble MCP Server
 * Provides time tracking data from Jibble API
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { getMembers, getMember, getProjects, getDailySummaries, getTimeEntries, getHourEntries, getTrackedTimeReport, type Person } from './client.js';

// Define available tools
const handleListTools = async () => {
  return {
    tools: [
      {
        name: 'jibble_get_members',
        description: 'Get all members (people) in the Jibble organization. Returns name, email, billable rate, and last activity.',
        inputSchema: {
          type: 'object',
          properties: {
            activeOnly: {
              type: 'boolean',
              description: 'If true, only return active members (status = Joined)',
              default: true,
            },
          },
        },
      },
      {
        name: 'jibble_get_member',
        description: 'Get details of a specific member by their ID',
        inputSchema: {
          type: 'object',
          properties: {
            personId: {
              type: 'string',
              description: 'The ID of the person to get details for',
            },
          },
          required: ['personId'],
        },
      },
      {
        name: 'jibble_get_projects',
        description: 'Get all projects in the Jibble organization',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'jibble_get_daily_summaries',
        description: 'Get daily time summaries for members. Returns total hours worked per day.',
        inputSchema: {
          type: 'object',
          properties: {
            startDate: {
              type: 'string',
              description: 'Start date in YYYY-MM-DD format',
            },
            endDate: {
              type: 'string',
              description: 'End date in YYYY-MM-DD format',
            },
            personId: {
              type: 'string',
              description: 'Optional: Filter by specific person ID',
            },
          },
          required: ['startDate', 'endDate'],
        },
      },
      {
        name: 'jibble_get_time_entries',
        description: 'Get raw time entries (clock in/out events) for a date range',
        inputSchema: {
          type: 'object',
          properties: {
            startDate: {
              type: 'string',
              description: 'Start date in YYYY-MM-DD format',
            },
            endDate: {
              type: 'string',
              description: 'End date in YYYY-MM-DD format',
            },
            personId: {
              type: 'string',
              description: 'Optional: Filter by specific person ID',
            },
          },
          required: ['startDate', 'endDate'],
        },
      },
      {
        name: 'jibble_get_hour_entries',
        description: 'Get hour entries with project and activity assignments. Use this for project-level time tracking analysis.',
        inputSchema: {
          type: 'object',
          properties: {
            startDate: {
              type: 'string',
              description: 'Start date in YYYY-MM-DD format',
            },
            endDate: {
              type: 'string',
              description: 'End date in YYYY-MM-DD format',
            },
            personId: {
              type: 'string',
              description: 'Optional: Filter by specific person ID',
            },
          },
          required: ['startDate', 'endDate'],
        },
      },
      {
        name: 'jibble_get_tracked_time_report',
        description: 'Get tracked time report with project/activity breakdown. Note: This endpoint does NOT support date filtering - use jibble_get_hour_entries for date-filtered project data.',
        inputSchema: {
          type: 'object',
          properties: {
            personId: {
              type: 'string',
              description: 'Optional: Filter by specific person ID',
            },
          },
        },
      },
    ],
  };
};

// Handle tool calls
const handleCallTool = async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'jibble_get_members': {
        const activeOnly = (args?.activeOnly as boolean) ?? true;
        const members = await getMembers({ activeOnly });

        const formatted = members.map((m: Person) => ({
          id: m.id,
          name: m.fullName,
          email: m.email,
          role: m.role,
          status: m.status,
          code: m.code,
          billableRate: m['IPersonSetting/BillableRate'],
          lastActivity: m.latestTimeEntryTime,
          workStartDate: m.workStartDate,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        };
      }

      case 'jibble_get_member': {
        const personId = args?.personId as string;
        if (!personId) {
          throw new Error('personId is required');
        }

        const member = await getMember(personId);
        const formatted = {
          id: member.id,
          name: member.fullName,
          email: member.email,
          role: member.role,
          status: member.status,
          code: member.code,
          billableRate: member['IPersonSetting/BillableRate'],
          lastActivity: member.latestTimeEntryTime,
          workStartDate: member.workStartDate,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        };
      }

      case 'jibble_get_projects': {
        const projects = await getProjects();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(projects, null, 2),
            },
          ],
        };
      }

      case 'jibble_get_daily_summaries': {
        const startDate = args?.startDate as string;
        const endDate = args?.endDate as string;
        const personId = args?.personId as string | undefined;

        if (!startDate || !endDate) {
          throw new Error('startDate and endDate are required');
        }

        const summaries = await getDailySummaries({ startDate, endDate, personId });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(summaries, null, 2),
            },
          ],
        };
      }

      case 'jibble_get_time_entries': {
        const startDate = args?.startDate as string;
        const endDate = args?.endDate as string;
        const personId = args?.personId as string | undefined;

        if (!startDate || !endDate) {
          throw new Error('startDate and endDate are required');
        }

        const entries = await getTimeEntries({ startDate, endDate, personId });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(entries, null, 2),
            },
          ],
        };
      }

      case 'jibble_get_hour_entries': {
        const startDate = args?.startDate as string;
        const endDate = args?.endDate as string;
        const personId = args?.personId as string | undefined;

        if (!startDate || !endDate) {
          throw new Error('startDate and endDate are required');
        }

        const entries = await getHourEntries({ startDate, endDate, personId });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(entries, null, 2),
            },
          ],
        };
      }

      case 'jibble_get_tracked_time_report': {
        const personId = args?.personId as string | undefined;

        const report = await getTrackedTimeReport({ personId });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(report, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${message}`,
        },
      ],
      isError: true,
    };
  }
};

// Build a fresh Server instance with handlers registered.
// A factory (rather than a module-level singleton) is required for the
// stateless Streamable HTTP transport, which connects a new Server per request
// so concurrent clients never share a single Server's transport ref.
function createServer(): Server {
  const server = new Server(
    {
      name: 'jibble',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  server.setRequestHandler(ListToolsRequestSchema, handleListTools);
  server.setRequestHandler(CallToolRequestSchema, handleCallTool);
  return server;
}

// Streamable HTTP transport: one persistent process serves many MCP clients,
// so brainbase sessions connect via url= instead of each spawning their own
// stdio copy. Stateless mode (sessionIdGenerator: undefined) creates a short
// Server per request. Bound to 127.0.0.1 only (carries Jibble credentials).
async function startHttpServer(port: number): Promise<void> {
  const http = await import('node:http');
  const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const host = process.env.MCP_HTTP_HOST || '127.0.0.1';

  const httpServer = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    if (!req.url || !req.url.startsWith('/mcp')) {
      res.writeHead(404);
      res.end();
      return;
    }

    let body: unknown;
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      if (chunks.length > 0) {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
          return;
        }
      }
    }

    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      console.error(`Jibble MCP Server running on http://${host}:${port}/mcp`);
      resolve();
    });
  });
}

// Start the server
async function main() {
  const httpPort = process.env.MCP_HTTP_PORT ? Number(process.env.MCP_HTTP_PORT) : null;
  if (httpPort && Number.isFinite(httpPort)) {
    await startHttpServer(httpPort);
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Jibble MCP Server running on stdio');
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
