/**
 * brainbase MCP Server
 * Provides context from _codex entities to Claude
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  buildIndex,
  setCodexBasePath,
  getEntity,
  getEntitiesByType,
  searchEntities,
  getContextForTopic,
  type EntityIndex,
  type EntityType,
} from './indexer/index.js';

// Global index (built once at startup)
let entityIndex: EntityIndex;

/**
 * Format entity for output
 */
function formatEntity(entity: unknown): string {
  if (!entity) return 'Not found';

  const e = entity as Record<string, unknown>;
  const lines: string[] = [];

  // Basic info
  lines.push(`## ${e.name || e.id}`);
  lines.push(`- **Type**: ${e.type}`);
  lines.push(`- **ID**: ${e.id}`);

  if (e.status) lines.push(`- **Status**: ${e.status}`);
  if (e.role) lines.push(`- **Role**: ${e.role}`);
  if (e.org) lines.push(`- **Organization**: ${e.org}`);

  // Arrays
  if (Array.isArray(e.team) && e.team.length > 0) {
    lines.push(`- **Team**: ${e.team.join(', ')}`);
  }
  if (Array.isArray(e.orgs) && e.orgs.length > 0) {
    lines.push(`- **Orgs**: ${e.orgs.join(', ')}`);
  }
  if (Array.isArray(e.projects) && e.projects.length > 0) {
    lines.push(`- **Projects**: ${e.projects.join(', ')}`);
  }
  if (Array.isArray(e.aliases) && e.aliases.length > 0) {
    lines.push(`- **Aliases**: ${e.aliases.join(', ')}`);
  }

  // Content
  if (e.content && typeof e.content === 'string' && e.content.trim()) {
    lines.push('');
    lines.push('### Content');
    lines.push(e.content);
  }

  // RACI entries
  if (Array.isArray(e.entries) && e.entries.length > 0) {
    lines.push('');
    lines.push('### RACI Matrix');
    lines.push('| 項目 | R | A | C | I |');
    lines.push('|------|---|---|---|---|');
    for (const entry of e.entries as Array<{ item: string; responsible: string; accountable: string; consulted: string; informed: string }>) {
      lines.push(`| ${entry.item} | ${entry.responsible} | ${entry.accountable} | ${entry.consulted} | ${entry.informed} |`);
    }
  }

  return lines.join('\n');
}

/**
 * Format entity list for output
 */
function formatEntityList(entities: unknown[]): string {
  if (!entities || entities.length === 0) {
    return 'No entities found.';
  }

  const lines: string[] = [];
  for (const e of entities as Array<Record<string, unknown>>) {
    const name = e.name || e.id;
    const type = e.type;
    const status = e.status ? ` [${e.status}]` : '';
    lines.push(`- **${name}** (${type})${status}`);
  }

  return lines.join('\n');
}

/**
 * Define MCP tools
 */
const tools: Tool[] = [
  {
    name: 'get_context',
    description: 'Get relevant context for a topic or entity. Returns the primary entity and related entities (team members, projects, orgs, RACI). Use this for getting comprehensive context about a specific topic.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'The topic, project name, person name, or org name to get context for',
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'list_entities',
    description: 'List all entities of a specific type. Available types: project, person, org, raci, app, customer.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['project', 'person', 'org', 'raci', 'app', 'customer'],
          description: 'The entity type to list',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'get_entity',
    description: 'Get a specific entity by type and ID. Supports name/alias lookup for people and organizations.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['project', 'person', 'org', 'raci', 'app', 'customer'],
          description: 'The entity type',
        },
        id: {
          type: 'string',
          description: 'The entity ID, name, or alias',
        },
      },
      required: ['type', 'id'],
    },
  },
  {
    name: 'search',
    description: 'Search all entities by keyword. Searches names, content, aliases, and descriptions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
        },
      },
      required: ['query'],
    },
  },
];

/**
 * Handle tool calls
 */
async function handleToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'get_context': {
      const topic = args.topic as string;
      const { primary, related } = getContextForTopic(entityIndex, topic);

      const lines: string[] = [];

      if (primary) {
        lines.push('# Primary Entity');
        lines.push(formatEntity(primary));

        if (related.length > 0) {
          lines.push('');
          lines.push('# Related Entities');
          for (const entity of related) {
            lines.push('');
            lines.push(formatEntity(entity));
          }
        }
      } else {
        // Fall back to search
        const results = searchEntities(entityIndex, topic);
        if (results.length > 0) {
          lines.push(`# Search Results for "${topic}"`);
          lines.push('');
          for (const entity of results.slice(0, 5)) {
            lines.push(formatEntity(entity));
            lines.push('');
          }
        } else {
          lines.push(`No context found for "${topic}".`);
        }
      }

      return lines.join('\n');
    }

    case 'list_entities': {
      const type = args.type as EntityType;
      const entities = getEntitiesByType(entityIndex, type);
      return `# ${type} entities (${entities.length})\n\n${formatEntityList(entities)}`;
    }

    case 'get_entity': {
      const type = args.type as EntityType;
      const id = args.id as string;
      const entity = getEntity(entityIndex, type, id);

      if (!entity) {
        return `Entity not found: ${type}/${id}`;
      }

      return formatEntity(entity);
    }

    case 'search': {
      const query = args.query as string;
      const results = searchEntities(entityIndex, query);

      if (results.length === 0) {
        return `No results found for "${query}".`;
      }

      const lines: string[] = [];
      lines.push(`# Search Results for "${query}" (${results.length} found)`);
      lines.push('');

      for (const entity of results.slice(0, 10)) {
        lines.push(formatEntity(entity));
        lines.push('');
      }

      if (results.length > 10) {
        lines.push(`... and ${results.length - 10} more results.`);
      }

      return lines.join('\n');
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

/**
 * Create and run the MCP server
 */
export async function runServer(codexPath: string): Promise<void> {
  // Set the codex base path and build index
  setCodexBasePath(codexPath);

  console.error(`[brainbase] Building index from: ${codexPath}`);
  entityIndex = await buildIndex();

  console.error(`[brainbase] Index built:`);
  console.error(`  - Projects: ${entityIndex.projects.size}`);
  console.error(`  - People: ${entityIndex.people.size}`);
  console.error(`  - Orgs: ${entityIndex.orgs.size}`);
  console.error(`  - RACI: ${entityIndex.raci.size}`);
  console.error(`  - Apps: ${entityIndex.apps.size}`);
  console.error(`  - Customers: ${entityIndex.customers.size}`);
  console.error(`  - Person aliases: ${entityIndex.aliasToPersonId.size}`);
  console.error(`  - Org aliases: ${entityIndex.aliasToOrgId.size}`);

  // Create the MCP server
  const server = new Server(
    {
      name: 'brainbase',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await handleToolCall(name, args as Record<string, unknown>);
      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[brainbase] Server started');
}
