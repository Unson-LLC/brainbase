/**
 * brainbase MCP Server
 * Provides context from _codex entities to Claude
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { buildIndex, getEntity, getEntitiesByType, searchEntities, getContextForTopic, } from './indexer/index.js';
import { loadConfig } from './config.js';
import { FilesystemSource } from './sources/filesystem-source.js';
import { GraphAPISource } from './sources/graphapi-source.js';
import { HybridSource } from './sources/hybrid-source.js';
import { TokenManager } from './auth/token-manager.js';
// Global index (built once at startup)
let entityIndex;
/**
 * Format entity for output
 */
function formatEntity(entity) {
    if (!entity)
        return 'Not found';
    const e = entity;
    const lines = [];
    // Basic info
    lines.push(`## ${e.name || e.id}`);
    lines.push(`- **Type**: ${e.type}`);
    lines.push(`- **ID**: ${e.id}`);
    if (e.status)
        lines.push(`- **Status**: ${e.status}`);
    if (e.role)
        lines.push(`- **Role**: ${e.role}`);
    if (e.org)
        lines.push(`- **Organization**: ${e.org}`);
    // Decision-specific fields
    if (e.type === 'decision') {
        if (e.decided_at)
            lines.push(`- **Decided At**: ${e.decided_at}`);
        if (e.decider)
            lines.push(`- **Decider**: ${e.decider}`);
        if (e.project_id)
            lines.push(`- **Project**: ${e.project_id}`);
        if (e.meeting_id)
            lines.push(`- **Meeting**: ${e.meeting_id}`);
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
        for (const pos of e.positions) {
            lines.push(`| ${pos.person} | ${pos.assets} | ${pos.authority} |`);
        }
    }
    if (Array.isArray(e.decisions) && e.decisions.length > 0) {
        lines.push('');
        lines.push('### 決裁');
        lines.push('| 領域 | 決裁者 |');
        lines.push('|------|--------|');
        for (const dec of e.decisions) {
            lines.push(`| ${dec.domain} | ${dec.decider} |`);
        }
    }
    if (Array.isArray(e.assignments) && e.assignments.length > 0) {
        lines.push('');
        lines.push('### 主な担当');
        lines.push('| 人 | 領域 |');
        lines.push('|---|------|');
        for (const assign of e.assignments) {
            lines.push(`| ${assign.person} | ${assign.areas} |`);
        }
    }
    if (Array.isArray(e.products) && e.products.length > 0) {
        lines.push('');
        lines.push('### 管轄プロダクト');
        for (const product of e.products) {
            lines.push(`- ${product}`);
        }
    }
    // Legacy RACI entries (backward compatibility) - only show if there's actual data
    if (Array.isArray(e.entries) && e.entries.length > 0) {
        // Filter out empty entries (from misparse of position tables)
        const validEntries = e.entries
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
function formatEntityList(entities) {
    if (!entities || entities.length === 0) {
        return 'No entities found.';
    }
    const lines = [];
    for (const e of entities) {
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
const tools = [
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
];
/**
 * Handle tool calls
 */
async function handleToolCall(name, args) {
    switch (name) {
        case 'get_context': {
            const topic = args.topic;
            const { primary, related } = getContextForTopic(entityIndex, topic);
            const lines = [];
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
            }
            else {
                // Fall back to search
                const results = searchEntities(entityIndex, topic);
                if (results.length > 0) {
                    lines.push(`# Search Results for "${topic}"`);
                    lines.push('');
                    for (const entity of results.slice(0, 5)) {
                        lines.push(formatEntity(entity));
                        lines.push('');
                    }
                }
                else {
                    lines.push(`No context found for "${topic}".`);
                }
            }
            return lines.join('\n');
        }
        case 'list_entities': {
            const type = args.type;
            const entities = getEntitiesByType(entityIndex, type);
            return `# ${type} entities (${entities.length})\n\n${formatEntityList(entities)}`;
        }
        case 'get_entity': {
            const type = args.type;
            const id = args.id;
            const entity = getEntity(entityIndex, type, id);
            if (!entity) {
                return `Entity not found: ${type}/${id}`;
            }
            return formatEntity(entity);
        }
        case 'search': {
            const query = args.query;
            const results = searchEntities(entityIndex, query);
            if (results.length === 0) {
                return `No results found for "${query}".`;
            }
            const lines = [];
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
export async function runServer(codexPath) {
    // Load configuration
    const config = loadConfig();
    // Override codexPath if provided (backward compatibility)
    if (codexPath) {
        config.codexPath = codexPath;
    }
    console.error(`[brainbase] Configuration:`);
    console.error(`  - Source mode: ${config.sourceMode}`);
    if (config.graphApiUrl) {
        console.error(`  - Graph API URL: ${config.graphApiUrl}`);
    }
    if (config.codexPath) {
        console.error(`  - Codex path: ${config.codexPath}`);
    }
    if (config.projectCodes) {
        console.error(`  - Project codes: ${config.projectCodes.join(', ')}`);
    }
    // Create EntitySource based on mode
    let source;
    switch (config.sourceMode) {
        case 'graphapi': {
            if (!config.graphApiUrl) {
                throw new Error('BRAINBASE_GRAPH_API_URL is required for graphapi mode');
            }
            const tokenManager = new TokenManager(config.graphApiUrl);
            source = new GraphAPISource(config.graphApiUrl, tokenManager, config.projectCodes);
            console.error('[brainbase] Using Graph API source');
            break;
        }
        case 'hybrid': {
            if (!config.graphApiUrl || !config.codexPath) {
                throw new Error('Both BRAINBASE_GRAPH_API_URL and CODEX_PATH are required for hybrid mode');
            }
            const tokenManager = new TokenManager(config.graphApiUrl);
            const apiSource = new GraphAPISource(config.graphApiUrl, tokenManager, config.projectCodes);
            const fsSource = new FilesystemSource(config.codexPath);
            source = new HybridSource(apiSource, fsSource);
            console.error('[brainbase] Using Hybrid source (API-first with FS fallback)');
            break;
        }
        case 'filesystem':
        default: {
            if (!config.codexPath) {
                throw new Error('CODEX_PATH is required for filesystem mode');
            }
            source = new FilesystemSource(config.codexPath);
            console.error('[brainbase] Using Filesystem source');
            break;
        }
    }
    // Build index from source
    console.error(`[brainbase] Building index...`);
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
    // Create the MCP server
    const server = new Server({
        name: 'brainbase',
        version: '1.0.0',
    }, {
        capabilities: {
            tools: {},
        },
    });
    // Register tool handlers
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return { tools };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        try {
            const result = await handleToolCall(name, args);
            return {
                content: [
                    {
                        type: 'text',
                        text: result,
                    },
                ],
            };
        }
        catch (error) {
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
