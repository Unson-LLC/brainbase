/**
 * brainbase MCP Server
 * Provides context from the brainbase Graph SSOT to Claude
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
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
  getExtensionEntitiesByType,
  getExtensionTypeRegistrations,
  resolveEntities,
  resolveCanonicalActivePerson,
  containsFirstPersonReference,
  searchEntities,
  tokenizeEntityQuery,
  getContextForTopic,
  type EntityIndex,
  type EntityType,
} from './indexer/index.js';
import { CORE_ENTITY_TYPES } from './indexer/ontology.js';
import { loadConfig, resolveBrainbaseApiUrl } from './config.js';
import { GraphAPISource } from './sources/graphapi-source.js';
import type { EntitySource } from './sources/entity-source.js';
import { TokenManager } from './auth/token-manager.js';
import { filterWikiPages } from './tools/wiki-search.js';
import { meshTools, handleMeshToolCall } from './tools/mesh-tools.js';
import {
  controlPlaneTools,
  handleControlPlaneToolCall,
} from './tools/control-plane-tools.js';
import { taskTools, handleTaskToolCall } from './tools/task-tools.js';
import {
  meetingMinutesContextTools,
  handleMeetingMinutesContextToolCall,
} from './tools/meeting-minutes-context-tools.js';
import { onboardingTools, handleOnboardingToolCall } from './tools/onboarding-tools.js';
import { graphMaintenanceTools, handleGraphMaintenanceToolCall } from './tools/graph-maintenance-tools.js';
import { knowledgeResolutionTools, handleKnowledgeResolutionToolCall } from './tools/knowledge-resolution-tools.js';
import { judgmentResolutionTools, handleJudgmentResolutionToolCall, resolveJudgmentBeforeModel } from './tools/judgment-resolution-tools.js';
import { judgmentStateTools, handleJudgmentStateToolCall } from './tools/judgment-state-tools.js';
import { judgmentValueProofTools, handleJudgmentValueProofToolCall } from './tools/judgment-value-proof-tools.js';
import { tenantBoundaryTools, handleTenantBoundaryToolCall } from './tools/tenant-boundary-tools.js';
import { normalizeJudgmentHostResult } from './tools/judgment-host-contract.js';
import { dispatchFirst, type ToolHandler } from './tools/tool-dispatcher.js';
import { annotateToolCapabilities } from './tools/tool-annotations.js';
import {
  buildKnowledgeOwnerAudit,
  buildKnowledgeToolContent,
} from './tools/knowledge-owner-audit.js';
import {
  handleRemoteJudgmentHookRequest,
  REMOTE_JUDGMENT_HOOK_MAX_BODY_BYTES,
  REMOTE_JUDGMENT_HOOK_PATH,
  type RemoteJudgmentHookDispatchResult,
} from './remote-judgment-hook-http.js';
import { readRuntimeVersion } from './runtime-version.js';

// Global index. Runtime lookups rebuild and atomically swap this snapshot.
let entityIndex: EntityIndex;
let indexRefreshEnabled = false;
let indexRefreshPromise: Promise<void> | null = null;

// Canonical Task store (companion task API on Lightsail). Mutations use a
// dedicated bbsvc_ service token; without it the task tools report unavailable.
const taskApiUrl = process.env.BRAINBASE_TASK_API_BASE_URL || 'https://bb.unson.jp';
const taskApiToken = process.env.BRAINBASE_TASK_API_TOKEN;

// Global refs for wiki API calls
let wikiApiBaseUrl: string;
let globalTokenManager: TokenManager;
let globalOwnerTokenManager: TokenManager;
let globalGraphSource: GraphAPISource | null = null;
let defaultProjectCode = 'brainbase';
let configuredProjectCodes: string[] | undefined;

type OnboardingDispatchDependencies = Parameters<typeof handleOnboardingToolCall>[2];
type KnowledgeResolutionDispatchDependencies = Parameters<typeof handleKnowledgeResolutionToolCall>[2];
type JudgmentResolutionDispatchDependencies = Parameters<typeof resolveJudgmentBeforeModel>[1];

function createDefaultJudgmentResolutionDependencies(): JudgmentResolutionDispatchDependencies {
  return {
    apiUrl: resolveBrainbaseApiUrl(),
    configuredProjectCodes,
    tokenManager: globalOwnerTokenManager,
    bindingSecret: process.env.BRAINBASE_JUDGMENT_BINDING_SECRET || '',
    adapterId: process.env.BRAINBASE_JUDGMENT_ADAPTER_ID || 'brainbase-mcp',
    adapterVersion: process.env.BRAINBASE_JUDGMENT_ADAPTER_VERSION || '1',
  };
}

async function dispatchOnboardingToolCall(
  name: string,
  args: Record<string, unknown>,
  dependencies?: OnboardingDispatchDependencies,
) {
  return handleOnboardingToolCall(name, args, dependencies ?? {
    apiUrl: resolveBrainbaseApiUrl(),
    configuredProjectCodes,
    tokenManager: globalTokenManager,
  });
}

async function dispatchKnowledgeResolutionToolCall(
  name: string,
  args: Record<string, unknown>,
  dependencies?: KnowledgeResolutionDispatchDependencies,
) {
  return handleKnowledgeResolutionToolCall(name, args, dependencies ?? {
    apiUrl: resolveBrainbaseApiUrl(),
    configuredProjectCodes,
    tokenManager: globalTokenManager,
  });
}

async function dispatchJudgmentResolutionBeforeModel(
  args: Record<string, unknown>,
  dependencies?: JudgmentResolutionDispatchDependencies,
) {
  const result = await resolveJudgmentBeforeModel(
    args, dependencies ?? createDefaultJudgmentResolutionDependencies(),
  );
  return normalizeJudgmentHostResult(result);
}

async function dispatchExtensionToolCall(
  name: string,
  args: Record<string, unknown>,
  handlers: Array<ToolHandler<unknown>>,
) {
  return dispatchFirst(handlers, name, args);
}

function buildToolResponseContent(
  name: string,
  toolArgs: Record<string, unknown>,
  result: string,
) {
  return buildKnowledgeToolContent(
    result,
    buildKnowledgeOwnerAudit(name, toolArgs, result),
  );
}

async function refreshEntityIndex(): Promise<void> {
  if (!indexRefreshEnabled) return;
  if (!globalGraphSource) {
    throw new Error('Graph source is unavailable; entity index cannot be refreshed');
  }
  if (!indexRefreshPromise) {
    indexRefreshPromise = (async () => {
      const nextIndex = await buildIndex(globalGraphSource as EntitySource);
      entityIndex = nextIndex;
    })().finally(() => {
      indexRefreshPromise = null;
    });
  }
  await indexRefreshPromise;
}

async function hydrateExtensionQuery(name: string, args: Record<string, unknown>): Promise<void> {
  if (!globalGraphSource) return;
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return;
  const types = name === 'list_extension_entities'
    ? [args.type].filter((type): type is string => typeof type === 'string')
    : Array.isArray(args.types)
      ? args.types.filter((type): type is string => typeof type === 'string')
      : [];
  for (const type of types) {
    if (!entityIndex.extensions.has(type)) continue;
    const existing = entityIndex.extensions.get(type) || new Map();
    for (const term of tokenizeEntityQuery(query)) {
      const matches = await globalGraphSource.searchExtensionEntities(type, term);
      for (const entity of matches) existing.set(entity.id, entity);
    }
    entityIndex.extensions.set(type, existing);
  }
}

const WIKI_RESOURCE_URI_PREFIX = 'brainbase://wiki/page/';
const WIKI_RESOURCE_TEMPLATE = 'brainbase://wiki/page/{path}';

export function isAuthorizedMcpHttpRequest(authorization: string | undefined, expectedToken: string): boolean {
  if (!authorization?.startsWith('Bearer ') || expectedToken.length === 0) return false;
  const actual = Buffer.from(authorization.slice('Bearer '.length));
  const expected = Buffer.from(expectedToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function handleHealthVersionRequest(
  req: Pick<IncomingMessage, 'method' | 'url'>,
  res: Pick<ServerResponse, 'writeHead' | 'end'>,
  readback: ReturnType<typeof readRuntimeVersion> = readRuntimeVersion(),
): boolean {
  if (req.method !== 'GET' || req.url !== '/health/version') return false;
  res.writeHead(readback.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(readback.body));
  return true;
}

async function dispatchRemoteJudgmentHook(
  payload: Record<string, unknown>,
  projectCode: string,
): Promise<RemoteJudgmentHookDispatchResult> {
  const hostModuleUrl = new URL('../../../scripts/codex-hooks/judgment-resolver-host.mjs', import.meta.url);
  const hostModule = await import(hostModuleUrl.href) as {
    processHookPayload: (
      hookPayload: Record<string, unknown>,
      dependencies?: {
        env?: NodeJS.ProcessEnv;
        onEpisodeStarted?: (episode: Record<string, unknown>) => void;
      },
    ) => Promise<Record<string, unknown>>;
  };
  let receiptId: string | undefined;
  let routeResolutionSha256: string | undefined;
  const output = await hostModule.processHookPayload(payload, {
    env: {
      ...process.env,
      BRAINBASE_JUDGMENT_PROJECT_CODE: projectCode,
    },
    onEpisodeStarted: (episode) => {
      const receipt = episode.initial_route_receipt;
      if (receipt && typeof receipt === 'object' && !Array.isArray(receipt)) {
        const resolutionId = (receipt as Record<string, unknown>).resolution_id;
        if (typeof resolutionId === 'string' && resolutionId.trim()) receiptId = resolutionId;
      }
      const digest = episode.initial_route_receipt_digest;
      if (typeof digest === 'string') routeResolutionSha256 = digest;
    },
  });
  return { output, receiptId, routeResolutionSha256 };
}

async function prependPhilosophyContext(
  body: string,
  args: Record<string, unknown>,
  defaults: { scope: string; objectType?: string; operation?: string }
): Promise<string> {
  const includePhilosophy = args.includePhilosophy !== false && args.include_philosophy !== false;
  if (!includePhilosophy) return body;
  if (!globalGraphSource) {
    throw new Error('Graph source is unavailable; Philosophy Context cannot be loaded');
  }

  const context = await globalGraphSource.getPhilosophyContext({
    projectCode: (args.project as string) || defaultProjectCode,
    scope: (args.scope as string) || defaults.scope,
    objectType: (args.objectType as string) || (args.object_type as string) || defaults.objectType,
    operation: (args.operation as string) || defaults.operation,
    maxRecommended: Number(args.maxRecommended || args.max_recommended) || undefined,
  });

  return `${context.prompt_block}\n\n---\n\n${body}`;
}

async function philosophyContextPrompt(
  args: Record<string, unknown>,
  defaults: { scope: string; objectType?: string; operation?: string }
): Promise<string | undefined> {
  const includePhilosophy = args.includePhilosophy !== false && args.include_philosophy !== false;
  if (!includePhilosophy) return undefined;
  if (!globalGraphSource) {
    throw new Error('Graph source is unavailable; Philosophy Context cannot be loaded');
  }

  const context = await globalGraphSource.getPhilosophyContext({
    projectCode: (args.project as string) || defaultProjectCode,
    scope: (args.scope as string) || defaults.scope,
    objectType: (args.objectType as string) || (args.object_type as string) || defaults.objectType,
    operation: (args.operation as string) || defaults.operation,
    maxRecommended: Number(args.maxRecommended || args.max_recommended) || undefined,
  });

  return context.prompt_block;
}

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
  if (e.lifecycle_status || e.lifecycle_state) lines.push(`- **Lifecycle**: ${e.lifecycle_status || e.lifecycle_state}`);
  if (e.semantic_state) lines.push(`- **Semantic State**: ${e.semantic_state}`);
  if (typeof e.version === 'number') lines.push(`- **Version**: ${e.version}`);
  if (e.role) lines.push(`- **Role**: ${e.role}`);
  if (e.org) lines.push(`- **Organization**: ${e.org}`);
  if (e.scope) lines.push(`- **Scope**: ${e.scope}`);
  if (e.positioning) lines.push(`- **Positioning**: ${e.positioning}`);
  if (e.term) lines.push(`- **Term**: ${e.term}`);
  if (e.canonical) lines.push(`- **Canonical**: ${e.canonical}`);
  if (e.path) lines.push(`- **Path**: ${e.path}`);
  if (e.payload && typeof e.payload === 'object') {
    const payload = e.payload as Record<string, unknown>;
    const labels: Record<string, string> = {
      company_name: 'Company',
      department: 'Department',
      title: 'Title',
      email: 'Email',
      tel_company: 'Company Tel',
      tel_direct: 'Direct Tel',
      mobile: 'Mobile',
      fax: 'Fax',
      postal_code: 'Postal Code',
      address: 'Address',
      url: 'URL',
      scanned_at: 'Scanned At',
      exchanged_at: 'Exchanged At',
      notes: 'Notes',
    };
    for (const [field, label] of Object.entries(labels)) {
      const value = payload[field];
      if (typeof value === 'string' && value.trim()) lines.push(`- **${label}**: ${value.trim()}`);
    }
  }

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
  if (Array.isArray(e.related_orgs) && e.related_orgs.length > 0) {
    lines.push(`- **Related Orgs**: ${e.related_orgs.join(', ')}`);
  }
  if (Array.isArray(e.related_apps) && e.related_apps.length > 0) {
    lines.push(`- **Related Apps**: ${e.related_apps.join(', ')}`);
  }
  if (Array.isArray(e.do) && e.do.length > 0) {
    lines.push('');
    lines.push('### Do');
    for (const item of e.do as string[]) {
      lines.push(`- ${item}`);
    }
  }
  if (Array.isArray(e.dont) && e.dont.length > 0) {
    lines.push('');
    lines.push("### Don't");
    for (const item of e.dont as string[]) {
      lines.push(`- ${item}`);
    }
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

interface PersonalKgHit {
  id: string;
  cognitive_type: string;
  body: string;
  confidence: number | null;
  source_system: string;
  created_at: string;
}

async function fetchPersonalKgSearch(
  query: string,
  options: { cognitiveType?: string; limit?: number } = {}
): Promise<PersonalKgHit[]> {
  const token = await globalOwnerTokenManager.getToken();
  const url = new URL('/api/learning/memory-candidates/search', wikiApiBaseUrl);
  url.searchParams.set('q', query);
  if (options.cognitiveType) url.searchParams.set('cognitive_type', options.cognitiveType);
  if (options.limit) url.searchParams.set('limit', String(options.limit));
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Personal KG API error: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as { candidates?: PersonalKgHit[] };
  return data.candidates || [];
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
        project: {
          type: 'string',
          description: 'Project code used to resolve Brainbase philosophy context. Defaults to first configured project or brainbase.',
        },
        scope: {
          type: 'string',
          description: 'Philosophy context scope. Examples: graph, crm, growth, automation, data, development.',
        },
        objectType: {
          type: 'string',
          description: 'Optional Graph object type being operated on, e.g. push_case or decision.',
        },
        operation: {
          type: 'string',
          description: 'Optional operation kind, e.g. read, write, review, upsert.',
        },
        includePhilosophy: {
          type: 'boolean',
          description: 'Whether to prepend Brainbase Philosophy Context. Defaults to true.',
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'list_entities',
    description: 'List all core entities of a specific type. Extension types are exposed through list_extension_types/list_extension_entities.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: [...CORE_ENTITY_TYPES],
          description: 'The entity type to list',
        },
        project: {
          type: 'string',
          description: 'Project code used to resolve Brainbase philosophy context.',
        },
        scope: {
          type: 'string',
          description: 'Philosophy context scope. Defaults to graph.',
        },
        includePhilosophy: {
          type: 'boolean',
          description: 'Whether to prepend Brainbase Philosophy Context. Defaults to true.',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'get_entity',
    description: 'Get a specific core entity by type and ID. Supports name/alias lookup for people, organizations, and brands.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: [...CORE_ENTITY_TYPES],
          description: 'The entity type',
        },
        id: {
          type: 'string',
          description: 'The entity ID, name, or alias',
        },
        project: {
          type: 'string',
          description: 'Project code used to resolve Brainbase philosophy context.',
        },
        scope: {
          type: 'string',
          description: 'Philosophy context scope. Defaults to graph.',
        },
        includePhilosophy: {
          type: 'boolean',
          description: 'Whether to prepend Brainbase Philosophy Context. Defaults to true.',
        },
      },
      required: ['type', 'id'],
    },
  },
  {
    name: 'list_extension_types',
    description: 'List registered Graph SSOT extension entity types. Extensions are discoverable but excluded from default core search.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_extension_entities',
    description: 'List or search entities for an explicitly requested extension type.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'The registered extension entity type to list, e.g. frame or speaking.',
        },
        query: {
          type: 'string',
          description: 'Optional name, company, department, email, phone, or other payload text to filter by.',
        },
      },
      required: ['type'],
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
        project: {
          type: 'string',
          description: 'Project code used to resolve Brainbase philosophy context.',
        },
        scope: {
          type: 'string',
          description: 'Philosophy context scope. Defaults to graph.',
        },
        includePhilosophy: {
          type: 'boolean',
          description: 'Whether to prepend Brainbase Philosophy Context. Defaults to true.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'resolve_entity',
    description: 'Resolve raw user or agent text to canonical Graph entity candidates with field-level evidence. Use this before claiming Graph absence from a broad phrase.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Raw user or agent text to resolve into Graph entity candidates.',
        },
        types: {
          type: 'array',
          items: {
            type: 'string',
            enum: [...CORE_ENTITY_TYPES, 'contact'],
          },
          description: 'Optional entity type filters. Registered extension types such as contact are searched only when explicitly requested.',
        },
        project: {
          type: 'string',
          description: 'Optional project code filter and Philosophy Context project.',
        },
        scope: {
          type: 'string',
          description: 'Philosophy context scope. Defaults to graph.',
        },
        includePhilosophy: {
          type: 'boolean',
          description: 'Whether to prepend Brainbase Philosophy Context. Defaults to true.',
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
  {
    name: 'search_personal_kg',
    description:
      "Search Keigo Sato's personal knowledge graph (owner-visible memory_candidates) by keyword over the full body text. Returns his accumulated judgment axes / decision principles / claims / insights (oyasumi 蓄積) with cognitive_type and confidence. Use this when a task needs Keigo's own stance, values, sales/content philosophy, or how he would decide — beyond the SessionStart preamble snapshot. Owner-only, non-redacted content.",
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keyword to search within the personal KG body text (e.g. "営業", "Persona Brain", "採用", "Claude Code 導入")',
        },
        cognitive_type: {
          type: 'string',
          description: 'Optional filter by cognitive type. Comma-separated allowed. One of: observation, insight, claim, preference, hypothesis, experiment, result.',
        },
        limit: {
          type: 'number',
          description: 'Max results (default 10, max 50).',
        },
        person_entity_id: {
          type: 'string',
          description: 'Optional canonical Graph person ID. The authenticated identity must resolve to the same active person.',
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
  if (name === 'search' || name === 'resolve_entity' || name === 'list_entities' || name === 'list_extension_entities') {
    await refreshEntityIndex();
  }
  if (name === 'resolve_entity' || name === 'list_extension_entities') {
    await hydrateExtensionQuery(name, args);
  }
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

      return prependPhilosophyContext(lines.join('\n'), args, {
        scope: (args.scope as string) || 'graph',
        objectType: 'context',
        operation: 'read',
      });
    }

    case 'list_entities': {
      const type = args.type as EntityType;
      const entities = getEntitiesByType(entityIndex, type);
      return prependPhilosophyContext(
        `# ${type} entities (${entities.length})\n\n${formatEntityList(entities)}`,
        args,
        { scope: 'graph', objectType: type, operation: 'read' }
      );
    }

    case 'get_entity': {
      const type = args.type as EntityType;
      const id = args.id as string;
      const entity = getEntity(entityIndex, type, id);

      if (!entity) {
        return `Entity not found: ${type}/${id}`;
      }

      return prependPhilosophyContext(formatEntity(entity), args, {
        scope: 'graph',
        objectType: type,
        operation: 'read',
      });
    }

    case 'list_extension_types': {
      const registrations = getExtensionTypeRegistrations();
      const lines = ['# Extension Entity Types', ''];
      for (const registration of registrations) {
        lines.push(`- **${registration.type}**: ${registration.description}`);
      }
      return lines.join('\n');
    }

    case 'list_extension_entities': {
      const type = args.type as string;
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      const entities = query
        ? resolveEntities(entityIndex, { query, types: [type] }).candidates
          .map(candidate => getExtensionEntitiesByType(entityIndex, type)
            .find(entity => entity.id === candidate.entity_id))
          .filter((entity): entity is NonNullable<typeof entity> => Boolean(entity))
        : getExtensionEntitiesByType(entityIndex, type);
      if (entities.length === 0) {
        return `No extension entities found for type "${type}".`;
      }
      const lines = [`# ${type} extension entities (${entities.length})`, ''];
      for (const entity of entities) {
        lines.push(formatEntity(entity));
        lines.push('');
      }
      return lines.join('\n');
    }

    case 'search': {
      const query = args.query as string;
      const results = searchEntities(entityIndex, query);

      if (results.length === 0) {
        const resolved = resolveEntities(entityIndex, {
          query,
          project: args.project as string | undefined,
          scope: args.scope as string | undefined,
        });

        if (resolved.candidates.length === 0) {
          return `No results found for "${query}". Resolver also found no candidates after normalized/tokenized checks.`;
        }

        const lines: string[] = [];
        lines.push(`# Search Results for "${query}"`);
        lines.push('');
        lines.push('No exact text-search results found. Resolver candidates:');
        lines.push('');

        for (const candidate of resolved.candidates.slice(0, 10)) {
          lines.push(`## ${candidate.name}`);
          lines.push(`- Type: ${candidate.type}`);
          lines.push(`- ID: ${candidate.entity_id}`);
          lines.push(`- Confidence: ${candidate.confidence}`);
          lines.push(`- Matched Terms: ${candidate.matched_terms.join(', ') || '(none)'}`);
          lines.push(`- Matched Fields: ${candidate.matched_fields.join(', ') || '(none)'}`);
          if (candidate.aliases.length > 0) {
            lines.push(`- Aliases: ${candidate.aliases.join(', ')}`);
          }
          if (candidate.project_code) {
            lines.push(`- Project: ${candidate.project_code}`);
          }
          lines.push(`- Why: ${candidate.why}`);
          lines.push('');
        }

        if (resolved.candidates.length > 10) {
          lines.push(`... and ${resolved.candidates.length - 10} more resolver candidates.`);
        }

        return prependPhilosophyContext(lines.join('\n'), args, {
          scope: 'graph',
          objectType: 'entity_resolution',
          operation: 'read',
        });
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

      return prependPhilosophyContext(lines.join('\n'), args, {
        scope: 'graph',
        objectType: 'search',
        operation: 'read',
      });
    }

    case 'resolve_entity': {
      const query = args.query as string;
      const types = Array.isArray(args.types)
        ? args.types.filter((type): type is string => typeof type === 'string')
        : undefined;
      const needsAuthenticatedOwner = containsFirstPersonReference(query);
      const token = needsAuthenticatedOwner
        ? await globalOwnerTokenManager?.getToken()
        : undefined;
      const result = resolveEntities(entityIndex, {
        query,
        types,
        project: args.project as string | undefined,
        scope: args.scope as string | undefined,
        ownerPersonId: token ? authenticatedPersonId(token) : undefined,
      });
      const philosophy_context = await philosophyContextPrompt(args, {
        scope: (args.scope as string) || 'graph',
        objectType: 'entity_resolution',
        operation: 'read',
      });

      return JSON.stringify({ philosophy_context: philosophy_context ?? null, ...result }, null, 2);
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

    case 'search_personal_kg': {
      const query = args.query as string;
      const cognitiveType = args.cognitive_type as string | undefined;
      const limit = typeof args.limit === 'number' ? args.limit : undefined;
      const requestedPersonId = typeof args.person_entity_id === 'string'
        ? args.person_entity_id.trim()
        : '';
      let ownerName = '認証済みの本人';
      if (requestedPersonId) {
        const token = await globalOwnerTokenManager.getToken();
        const authenticatedId = authenticatedPersonId(token);
        const requestedPerson = resolveCanonicalActivePerson(entityIndex, requestedPersonId);
        const authenticatedPerson = authenticatedId
          ? resolveCanonicalActivePerson(entityIndex, authenticatedId)
          : null;
        if (!requestedPerson || !authenticatedPerson || requestedPerson.id !== authenticatedPerson.id) {
          throw new Error('Personal KG person_entity_id must match the authenticated person.');
        }
        ownerName = requestedPerson.name;
      }
      const hits = await fetchPersonalKgSearch(query, { cognitiveType, limit });
      if (hits.length === 0) {
        return `No personal KG entries found for "${query}"${cognitiveType ? ` (cognitive_type=${cognitiveType})` : ''}.`;
      }
      const lines: string[] = [];
      lines.push(`# Personal KG (${ownerName}) — "${query}" (${hits.length} hits)`);
      lines.push('');
      for (const h of hits) {
        const conf = h.confidence != null ? ` conf=${h.confidence}` : '';
        lines.push(`- **[${h.cognitive_type}${conf}]** ${h.body.replace(/\s+/g, ' ').trim()}`);
        lines.push(`  _(${h.source_system} · ${String(h.created_at).slice(0, 10)} · ${h.id})_`);
      }
      return lines.join('\n');
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

const publishedTools = annotateToolCapabilities([
  ...tools,
  ...controlPlaneTools,
  ...onboardingTools,
  ...graphMaintenanceTools,
  ...judgmentResolutionTools,
  ...judgmentValueProofTools,
  ...judgmentStateTools,
  ...knowledgeResolutionTools,
  ...meetingMinutesContextTools,
  ...taskTools,
  ...tenantBoundaryTools,
  ...meshTools,
]);

export const __testing = {
  tools: publishedTools,
  formatEntity,
  dispatchOnboardingToolCall,
  dispatchJudgmentResolutionBeforeModel,
  dispatchKnowledgeResolutionToolCall,
  dispatchExtensionToolCall,
  buildToolResponseContent,
  createDefaultJudgmentResolutionDependencies,
  resolveBrainbaseApiUrl,
  setEntityIndex(index: EntityIndex): void {
    entityIndex = index;
  },
  setGraphSource(source: GraphAPISource | null): void {
    globalGraphSource = source;
  },
  setIndexRefreshEnabled(enabled: boolean): void {
    indexRefreshEnabled = enabled;
  },
  setTokenManager(manager: { getToken(): Promise<string> }): void {
    globalTokenManager = manager as TokenManager;
    globalOwnerTokenManager = manager as TokenManager;
  },
  setOwnerTokenManager(manager: { getToken(): Promise<string> }): void {
    globalOwnerTokenManager = manager as TokenManager;
  },
  setWikiApiBaseUrl(url: string): void {
    wikiApiBaseUrl = url;
  },
  refreshEntityIndex,
  handleToolCall,
};

function authenticatedPersonId(token: string): string | undefined {
  const jwt = token.startsWith('bbsvc_') ? token.slice('bbsvc_'.length) : token;
  const payloadSegment = jwt.split('.')[1];
  if (!payloadSegment) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof payload.personId === 'string' && payload.personId.trim()) return payload.personId.trim();
    if (typeof payload.sub === 'string' && payload.sub.startsWith('per_')) return payload.sub;
  } catch {
    return undefined;
  }
  return undefined;
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
  // Personal KG routes must run as the signed-in owner, never as the service identity.
  const ownerTokenManager = new TokenManager(
    config.graphApiUrl,
    undefined,
    { allowEnvironmentToken: false },
  );
  globalTokenManager = tokenManager;
  globalOwnerTokenManager = ownerTokenManager;
  wikiApiBaseUrl = process.env.BRAINBASE_WIKI_API_URL || 'http://localhost:31013';
  const source = new GraphAPISource(config.graphApiUrl, tokenManager, config.projectCodes);
  globalGraphSource = source;
  indexRefreshEnabled = true;
  defaultProjectCode = config.projectCodes?.[0] || 'brainbase';
  configuredProjectCodes = config.projectCodes;
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

  // Create the MCP server.
  // Factory (not a singleton) so the stateless Streamable HTTP transport can
  // build one Server per request — the heavy shared state (entityIndex,
  // resolved Brainbase API URL) lives outside each request handler.
  function createServer() {
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
    return { tools: publishedTools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const toolArgs = args as Record<string, unknown>;
      const extensionResult = await dispatchExtensionToolCall(name, toolArgs, [
        (toolName, extensionArgs) => handleTenantBoundaryToolCall(toolName, extensionArgs, {
          apiUrl: resolveBrainbaseApiUrl(),
          serviceToken: process.env.BRAINBASE_TENANT_RUNTIME_SERVICE_TOKEN,
        }),
        (toolName, extensionArgs) => handleControlPlaneToolCall(toolName, extensionArgs, {
          apiUrl: resolveBrainbaseApiUrl(),
          configuredProjectCodes,
          tokenManager: globalTokenManager,
        }),
        (toolName, extensionArgs) => dispatchOnboardingToolCall(toolName, extensionArgs),
        (toolName, extensionArgs) => handleGraphMaintenanceToolCall(toolName, extensionArgs, {
          apiUrl: resolveBrainbaseApiUrl(),
          configuredProjectCodes,
          tokenManager: globalTokenManager,
        }),
        (toolName, extensionArgs) => dispatchKnowledgeResolutionToolCall(toolName, extensionArgs),
        (toolName, extensionArgs) => handleJudgmentResolutionToolCall(
          toolName, extensionArgs, createDefaultJudgmentResolutionDependencies(),
        ),
        (toolName, extensionArgs) => handleJudgmentValueProofToolCall(toolName, extensionArgs),
        (toolName, extensionArgs) => handleJudgmentStateToolCall(toolName, extensionArgs),
        (toolName, extensionArgs) => handleMeetingMinutesContextToolCall(toolName, extensionArgs, {
          apiUrl: resolveBrainbaseApiUrl(),
          getToken: () => globalTokenManager.getToken(),
        }),
        (toolName, extensionArgs) => handleTaskToolCall(toolName, extensionArgs, {
          apiUrl: taskApiUrl,
          token: taskApiToken,
        }),
        (toolName, extensionArgs) => handleMeshToolCall(toolName, extensionArgs, resolveBrainbaseApiUrl()),
      ]);
      const result = extensionResult === null
        ? await handleToolCall(name, toolArgs)
        : typeof extensionResult === 'string'
          ? extensionResult
          : JSON.stringify(extensionResult, null, 2);
      return { content: buildToolResponseContent(name, toolArgs, result) };
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

    return server;
  }

  // Streamable HTTP transport: one persistent process serves many MCP clients,
  // so brainbase sessions connect via url= instead of each spawning their own
  // stdio copy. Stateless mode builds a short-lived Server per request.
  // Bound to 127.0.0.1 only. Enabled when MCP_HTTP_PORT is set.
  const httpPort = process.env.MCP_HTTP_PORT ? Number(process.env.MCP_HTTP_PORT) : null;
  if (httpPort && Number.isFinite(httpPort)) {
    const bearerToken = process.env.MCP_HTTP_BEARER_TOKEN || '';
    if (!bearerToken) throw new Error('MCP_HTTP_BEARER_TOKEN is required when MCP_HTTP_PORT is set');
    const http = await import('node:http');
    const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const host = process.env.MCP_HTTP_HOST || '127.0.0.1';

    const httpServer = http.createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
      }
      if (handleHealthVersionRequest(req, res)) return;
      if (req.method === 'POST' && req.url === REMOTE_JUDGMENT_HOOK_PATH) {
        if (!isAuthorizedMcpHttpRequest(req.headers.authorization, bearerToken)) {
          res.writeHead(401, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer',
          });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          const buffer = chunk as Buffer;
          size += buffer.length;
          if (size > REMOTE_JUDGMENT_HOOK_MAX_BODY_BYTES) break;
          chunks.push(buffer);
        }
        const result = await handleRemoteJudgmentHookRequest({
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          body: size > REMOTE_JUDGMENT_HOOK_MAX_BODY_BYTES
            ? Buffer.alloc(REMOTE_JUDGMENT_HOOK_MAX_BODY_BYTES + 1)
            : Buffer.concat(chunks),
          bearerToken,
          projectCode: Array.isArray(req.headers['x-brainbase-project-code'])
            ? req.headers['x-brainbase-project-code'][0]
            : req.headers['x-brainbase-project-code'],
          isAuthorized: isAuthorizedMcpHttpRequest,
          dispatch: dispatchRemoteJudgmentHook,
          onDispatchError: (details) => {
            console.error(JSON.stringify({
              event: 'brainbase_judgment_hook_dispatch_failed',
              ...details,
            }));
          },
        });
        res.writeHead(result?.status ?? 404, {
          'Content-Type': 'application/json',
          ...(result?.headers ?? {}),
        });
        res.end(JSON.stringify(result?.body ?? { error: 'not_found' }));
        return;
      }
      if (req.method === 'POST' && req.url === '/host/judgment/resolve') {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          const buffer = chunk as Buffer;
          size += buffer.length;
          if (size > 10 * 1024 * 1024) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ management_status: 'unmanaged', reason: 'judgment_host_payload_too_large', receipt: null }));
            return;
          }
          chunks.push(buffer);
        }
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          const result = await dispatchJudgmentResolutionBeforeModel(body);
          res.writeHead(result.management_status === 'managed' ? 200 : 503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            management_status: 'unmanaged',
            reason: 'judgment_host_bridge_failed',
            warning: error instanceof Error ? error.message : String(error),
            receipt: null,
          }));
        }
        return;
      }
      if (!req.url || !req.url.startsWith('/mcp')) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (!isAuthorizedMcpHttpRequest(req.headers.authorization, bearerToken)) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
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
      httpServer.listen(httpPort, host, () => {
        console.error(`[brainbase] Server started on http://${host}:${httpPort}/mcp`);
        resolve();
      });
    });
  } else {
    // Connect via stdio (default)
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[brainbase] Server started');
  }
}
