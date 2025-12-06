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

import { getMembers, getMember, getProjects, getDailySummaries, getTimeEntries, type Person } from './client.js';

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

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
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
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
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
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Jibble MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
