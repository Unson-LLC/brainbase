/**
 * brainbase MCP Server
 * Provides context from _codex entities to Claude
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  buildIndex,
  createEmptyIndex,
  getEntity,
  getEntitiesByType,
  searchEntities,
  getContextForTopic,
  type EntityIndex,
  type EntityType,
} from './indexer/index.js';
import { loadConfig } from './config.js';
import { GraphAPISource } from './sources/graphapi-source.js';
import { TokenManager } from './auth/token-manager.js';
import { filterWikiPages } from './tools/wiki-search.js';
import { meshTools, handleMeshToolCall } from './tools/mesh-tools.js';

// Global index (built once at startup)
let entityIndex: EntityIndex;

// Brainbase API URL for mesh tools (MCP runs out-of-process, so we use REST)
const brainbaseApiUrl = process.env.BRAINBASE_API_URL || 'http://localhost:31013';

// Global refs for wiki API calls
let wikiApiBaseUrl: string;
let globalTokenManager: TokenManager;

const WIKI_RESOURCE_URI_PREFIX = 'brainbase://wiki/page/';
const WIKI_RESOURCE_TEMPLATE = 'brainbase://wiki/page/{path}';

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

  // Decision-specific fields
  if (e.type === 'decision') {
    if (e.decided_at) lines.push(`- **Decided At**: ${e.decided_at}`);
    if (e.decider) lines.push(`- **Decider**: ${e.decider}`);
    if (e.project_id) lines.push(`- **Project**: ${e.project_id}`);
    if (e.meeting_id) lines.push(`- **Meeting**: ${e.meeting_id}`);
  }

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
  if (Array.isArray(e.tags) && e.tags.length > 0) {
    lines.push(`- **Tags**: ${e.tags.join(', ')}`);
  }

  // Content
  if (e.content && typeof e.content === 'string' && e.content.trim()) {
    lines.push('');
    lines.push('### Content');
    lines.push(e.content);
  }

  // New position-based RACI format
  if (Array.isArray(e.positions) && e.positions.length > 0) {
    lines.push('');
    lines.push('### 立ち位置');
    lines.push('| 人 | 資産 | 権利の範囲 |');
    lines.push('|---|------|-----------|');
    for (const pos of e.positions as Array<{ person: string; assets: string; authority: string }>) {
      lines.push(`| ${pos.person} | ${pos.assets} | ${pos.authority} |`);
    }
  }

  if (Array.isArray(e.decisions) && e.decisions.length > 0) {
    lines.push('');
    lines.push('### 決裁');
    lines.push('| 領域 | 決裁者 |');
    lines.push('|------|--------|');
    for (const dec of e.decisions as Array<{ domain: string; decider: string }>) {
      lines.push(`| ${dec.domain} | ${dec.decider} |`);
    }
  }

  if (Array.isArray(e.assignments) && e.assignments.length > 0) {
    lines.push('');
    lines.push('### 主な担当');
    lines.push('| 人 | 領域 |');
    lines.push('|---|------|');
    for (const assign of e.assignments as Array<{ person: string; areas: string }>) {
      lines.push(`| ${assign.person} | ${assign.areas} |`);
    }
  }

  if (Array.isArray(e.products) && e.products.length > 0) {
    lines.push('');
    lines.push('### 管轄プロダクト');
    for (const product of e.products as string[]) {
      lines.push(`- ${product}`);
    }
  }

  // Legacy RACI entries (backward compatibility) - only show if there's actual data
  if (Array.isArray(e.entries) && e.entries.length > 0) {
    // Filter out empty entries (from misparse of position tables)
    const validEntries = (e.entries as Array<{ item: string; responsible: string; accountable: string; consulted: string; informed: string }>)
      .filter(entry => entry.item.trim() || entry.responsible.trim() || entry.accountable.trim());

    if (validEntries.length > 0) {
      lines.push('');
      lines.push('### RACI Matrix (Legacy)');
      lines.push('| 項目 | R | A | C | I |');
      lines.push('|------|---|---|---|---|');
      for (const entry of validEntries) {
        lines.push(`| ${entry.item} | ${entry.responsible} | ${entry.accountable} | ${entry.consulted} | ${entry.informed} |`);
      }
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

async function fetchWikiPages() {
  const token = await globalTokenManager.getToken();
  const url = new URL('/api/wiki/pages', wikiApiBaseUrl);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Wiki API error: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as Array<{ path: string; title: string; project_id: string | null }>;
}

async function fetchWikiPage(pagePath: string) {
  const token = await globalTokenManager.getToken();
  const url = new URL('/api/wiki/page', wikiApiBaseUrl);
  url.searchParams.set('path', pagePath);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Wiki page not found: ${pagePath}`);
    }
    throw new Error(`Wiki API error: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as { path: string; title: string; content: string; project_id?: string | null };
}

function wikiPathToResourceUri(pagePath: string): string {
  return `${WIKI_RESOURCE_URI_PREFIX}${pagePath}`;
}

function resourceUriToWikiPath(uri: string): string {
  if (!uri.startsWith(WIKI_RESOURCE_URI_PREFIX)) {
    throw new Error(`Unsupported wiki resource URI: ${uri}`);
  }

  const pagePath = decodeURIComponent(uri.slice(WIKI_RESOURCE_URI_PREFIX.length));
  if (!pagePath) {
    throw new Error(`Missing wiki path in resource URI: ${uri}`);
  }

  return pagePath;
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
    description: 'List all entities of a specific type. Available types: project, person, org, raci, app, customer, decision.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['project', 'person', 'org', 'raci', 'app', 'customer', 'decision'],
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
          enum: ['project', 'person', 'org', 'raci', 'app', 'customer', 'decision'],
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
  {
    name: 'search_wiki',
    description: 'Search wiki pages by keyword. Returns matching page titles and paths from the brainbase wiki. Optionally filter by project_id.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search keyword to find wiki pages',
        },
        project_id: {
          type: 'string',
          description: 'Optional project ID to filter results (e.g. "brainbase", "salestailor")',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_wiki_page',
    description: 'Get the full content of a wiki page by its path.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The wiki page path (e.g. "brainbase/project", "salestailor/02_offer")',
        },
      },
      required: ['path'],
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

    case 'search_wiki': {
      const query = args.query as string;
      const projectId = args.project_id as string | undefined;
      const pages = await fetchWikiPages();
      const matches = filterWikiPages(pages, query, projectId);
      if (matches.length === 0) {
        return `No wiki pages found for "${query}"${projectId ? ` in project "${projectId}"` : ''}.`;
      }
      const header = projectId
        ? `# Wiki Search: "${query}" in project "${projectId}" (${matches.length} results)\n`
        : `# Wiki Search: "${query}" (${matches.length} results)\n`;
      const lines = [header];
      for (const p of matches.slice(0, 20)) {
        lines.push(`- **${p.title}** — \`${p.path}\`${p.project_id ? ` [${p.project_id}]` : ''}`);
      }
      if (matches.length > 20) {
        lines.push(`\n... and ${matches.length - 20} more.`);
      }
      return lines.join('\n');
    }

    case 'get_wiki_page': {
      const pagePath = args.path as string;
      const data = await fetchWikiPage(pagePath);
      return `# ${data.title}\n\n${data.content}`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

/**
 * Create and run the MCP server
 */
export async function runServer(legacyCodexPath?: string): Promise<void> {
  // Load configuration
  const config = loadConfig();

  // Keep accepting the legacy codex path argument so old launch commands do not fail.
  if (legacyCodexPath) {
    console.error('[brainbase] Ignoring legacy codexPath argument (graphapi-only mode)');
  }

  console.error(`[brainbase] Configuration:`);
  console.error(`  - Source mode: ${config.sourceMode}`);
  console.error(`  - Graph API URL: ${config.graphApiUrl}`);
  if (config.projectCodes) {
    console.error(`  - Project codes: ${config.projectCodes.join(', ')}`);
  }

  const tokenManager = new TokenManager(config.graphApiUrl);
  globalTokenManager = tokenManager;
  wikiApiBaseUrl = process.env.BRAINBASE_WIKI_API_URL || 'http://localhost:31013';
  const source = new GraphAPISource(config.graphApiUrl, tokenManager, config.projectCodes);
  console.error('[brainbase] Using Graph API source');

  // Keep wiki resources/tools available even when the graph API is down.
  console.error(`[brainbase] Building index...`);
  try {
    entityIndex = await buildIndex(source);

    console.error(`[brainbase] Index built:`);
    console.error(`  - Projects: ${entityIndex.projects.size}`);
    console.error(`  - People: ${entityIndex.people.size}`);
    console.error(`  - Orgs: ${entityIndex.orgs.size}`);
    console.error(`  - RACI: ${entityIndex.raci.size}`);
    console.error(`  - Apps: ${entityIndex.apps.size}`);
    console.error(`  - Customers: ${entityIndex.customers.size}`);
    console.error(`  - Decisions: ${entityIndex.decisions.size}`);
    console.error(`  - Person aliases: ${entityIndex.aliasToPersonId.size}`);
    console.error(`  - Org aliases: ${entityIndex.aliasToOrgId.size}`);
  } catch (error) {
    console.error('[brainbase] Index build failed, continuing with empty graph index:', error);
    entityIndex = createEmptyIndex();
  }

  // Create the MCP server
  const server = new Server(
    {
      name: 'brainbase',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // Register tool handlers
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const pages = await fetchWikiPages();
    return {
      resources: pages.map((page) => ({
        uri: wikiPathToResourceUri(page.path),
        name: page.title || page.path,
        title: page.title || page.path,
        description: page.project_id ? `Wiki page for project ${page.project_id}` : 'Wiki page',
        mimeType: 'text/markdown',
      })),
    };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return {
      resourceTemplates: [
        {
          uriTemplate: WIKI_RESOURCE_TEMPLATE,
          name: 'wiki-page',
          title: 'Wiki Page',
          description: 'Read a brainbase wiki page by path. Example URI: brainbase://wiki/page/brainbase/project',
          mimeType: 'text/markdown',
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const pagePath = resourceUriToWikiPath(request.params.uri);
    const page = await fetchWikiPage(pagePath);
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: 'text/markdown',
          text: `# ${page.title}\n\n${page.content}`,
        },
      ],
    };
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: [...tools, ...meshTools] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // Try mesh tools first; they return null for unknown tool names.
      const meshResult = await handleMeshToolCall(name, args as Record<string, unknown>, brainbaseApiUrl);
      const result = meshResult ?? await handleToolCall(name, args as Record<string, unknown>);
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
