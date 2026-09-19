import { bodyEvidenceFields } from './retrieval/evidence.js';
import { knowledgeEvidenceTools, handleKnowledgeEvidenceToolCall } from './tools/knowledge-evidence-tools.js';
/**
 * brainbase MCP Server
 * Provides context from the brainbase Graph SSOT to Claude
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AsyncLocalStorage } from 'node:async_hooks';
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
import {
  loadConfig,
  normalizePersonalKgApiUrl,
  resolveBrainbaseApiUrl,
  type PersonalKgStorageMode,
} from './config.js';
import {
  PersonalKnowledgeClient,
  type PersonalKnowledgeEvent,
} from './personal-knowledge-client.js';
import { GraphAPISource, type GraphEntity } from './sources/graphapi-source.js';
import type { EntitySource } from './sources/entity-source.js';
import { TokenManager, createConnectionTokenManager } from './auth/token-manager.js';
import { authenticateMcpHttpRequest, type McpHttpAuthMode } from './auth/http-auth.js';
import { RequestTokenContext, type TokenProvider } from './auth/request-token-context.js';
import { createTenantTokenRouterFromEnvironment } from './auth/tenant-auth-router.js';
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
import {
  shareablePersonProfileTools,
  handleShareablePersonProfileToolCall,
} from './tools/shareable-person-profile-tools.js';
import { onboardingTools, handleOnboardingToolCall } from './tools/onboarding-tools.js';
import { graphMaintenanceTools, handleGraphMaintenanceToolCall } from './tools/graph-maintenance-tools.js';
import { handleGraphRetrievalToolCall, retrieveGraphEntity, type GraphRetrievalDependencies } from './tools/graph-retrieval.js';
import { knowledgeResolutionTools, handleKnowledgeResolutionToolCall } from './tools/knowledge-resolution-tools.js';
import { judgmentResolutionTools, handleJudgmentResolutionToolCall, resolveJudgmentBeforeModel } from './tools/judgment-resolution-tools.js';
import { judgmentAuditTools, handleJudgmentAuditToolCall } from './tools/judgment-audit-tools.js';
import { judgmentStateTools, handleJudgmentStateToolCall } from './tools/judgment-state-tools.js';
import { judgmentValueProofTools, handleJudgmentValueProofToolCall } from './tools/judgment-value-proof-tools.js';
import { judgmentNodeTools, handleJudgmentNodeToolCall } from './tools/judgment-node-tools.js';
import { tenantBoundaryTools, handleTenantBoundaryToolCall } from './tools/tenant-boundary-tools.js';
import {
  normalizeJudgmentHostResult,
  type JudgmentManagementResult,
} from './tools/judgment-host-contract.js';
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

interface EntityIndexState {
  index: EntityIndex;
  refreshPromise: Promise<void> | null;
  source: GraphAPISource | null;
  lastAccessedAt: number;
}

// Each authenticated principal/tenant gets an independent projection. The
// fallback state preserves stdio and test behavior where no HTTP scope exists.
const entityIndexScope = new AsyncLocalStorage<string>();
const entityIndexStates = new Map<string, EntityIndexState>();
const defaultEntityIndexScope = 'default';
const maxEntityIndexScopes = 64;
let graphSourceFactory: (() => GraphAPISource) | null = null;
let indexRefreshEnabled = false;

function getEntityIndexState(): EntityIndexState {
  const scope = entityIndexScope.getStore() ?? defaultEntityIndexScope;
  let state = entityIndexStates.get(scope);
  if (!state) {
    if (entityIndexStates.size >= maxEntityIndexScopes) {
      const evictable = [...entityIndexStates.entries()]
        .filter(([key, candidate]) => key !== defaultEntityIndexScope && candidate.refreshPromise === null)
        .sort((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt)[0];
      if (evictable) entityIndexStates.delete(evictable[0]);
    }
    state = {
      index: createEmptyIndex(),
      refreshPromise: null,
      source: graphSourceFactory?.() ?? null,
      lastAccessedAt: Date.now(),
    };
    entityIndexStates.set(scope, state);
  }
  state.lastAccessedAt = Date.now();
  return state;
}

function stableScopePart(values: string[]): string[] {
  return [...new Set(values)].sort();
}

// Canonical Task store (companion task API on Lightsail). Mutations use a
// dedicated bbsvc_ service token; without it the task tools report unavailable.
const taskApiUrl = process.env.BRAINBASE_TASK_API_BASE_URL || 'https://bb.unson.jp';
const taskApiToken = process.env.BRAINBASE_TASK_API_TOKEN;

// Global refs for wiki API calls
let wikiApiBaseUrl: string;
let globalTokenManager: TokenProvider;
let globalOwnerTokenManager: TokenProvider;
let personalKgStorageMode: PersonalKgStorageMode | undefined;
let personalKgApiUrl: string | undefined;
let personalKnowledgeClient: PersonalKnowledgeClient | null = null;
let defaultProjectCode = 'brainbase';
let configuredProjectCodes: string[] | undefined;

function resolveWikiApiBaseUrl(
  graphApiUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (env.BRAINBASE_WIKI_API_URL?.trim() || graphApiUrl).replace(/\/+$/, '');
}

type OnboardingDispatchDependencies = Parameters<typeof handleOnboardingToolCall>[2];
type KnowledgeResolutionDispatchDependencies = Parameters<typeof handleKnowledgeResolutionToolCall>[2];
type JudgmentResolutionDispatchDependencies = Parameters<typeof resolveJudgmentBeforeModel>[1];
type JudgmentResolutionDispatchOptions = { signal?: AbortSignal };

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
  companyAuthorityResponse?: string,
) {
  return handleKnowledgeResolutionToolCall(name, args, dependencies ?? {
    companyAuthorityResponse,
    runtimeApiUrl: process.env.BRAINBASE_TENANT_RUNTIME_API_URL?.trim() || resolveBrainbaseApiUrl(),
    runtimeServiceToken: process.env.BRAINBASE_TENANT_RUNTIME_SERVICE_TOKEN,
    apiUrl: resolveBrainbaseApiUrl(),
    configuredProjectCodes,
    tokenManager: globalTokenManager,
  });
}

async function dispatchJudgmentResolutionBeforeModel(
  args: Record<string, unknown>,
  dependencies?: JudgmentResolutionDispatchDependencies,
  options: JudgmentResolutionDispatchOptions = {},
) {
  const resolvedDependencies = dependencies ?? createDefaultJudgmentResolutionDependencies();
  const callbackSignal = options.signal;
  const dependenciesWithSignal = callbackSignal
    ? (() => {
      const fetchImpl = resolvedDependencies.fetch ?? globalThis.fetch;
      const fetchWithSignal: typeof globalThis.fetch = (input, init) => fetchImpl(input, {
        ...(init ?? {}),
        signal: init?.signal
          ? AbortSignal.any([init.signal, callbackSignal])
          : callbackSignal,
      });
      return { ...resolvedDependencies, fetch: fetchWithSignal };
    })()
    : resolvedDependencies;
  const result = await resolveJudgmentBeforeModel(
    args, dependenciesWithSignal,
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
  entity?: unknown,
) {
  return buildKnowledgeToolContent(
    result,
    buildKnowledgeOwnerAudit(name, toolArgs, result, entity),
  );
}

function isStructuredJudgmentToolFailure(name: string, extensionResult: unknown): boolean {
  if (name !== 'brainbase_resolve_turn' || extensionResult === null || typeof extensionResult !== 'object') {
    return false;
  }
  const status = (extensionResult as { status?: unknown }).status;
  return status === 'error' || status === 'unavailable';
}

function buildMcpToolResult(
  name: string,
  toolArgs: Record<string, unknown>,
  result: string,
  extensionResult: unknown,
  entity?: unknown,
) {
  const response = { content: buildToolResponseContent(name, toolArgs, result, entity) };
  const retrievalFailure = ['search', 'get_entity', 'brainbase_knowledge_retrieve', 'brainbase_knowledge_evidence_record'].includes(name) && extensionResult !== null
    && typeof extensionResult === 'object'
    && ['error', 'unavailable'].includes(String((extensionResult as Record<string, unknown>).status));
  return (retrievalFailure || isStructuredJudgmentToolFailure(name, extensionResult))
    ? { ...response, isError: true }
    : response;
}

async function dispatchGetEntity(args: Record<string, unknown>, deps: GraphRetrievalDependencies) {
  const retrieval = await retrieveGraphEntity(args, deps);
  if (retrieval.status !== 'ok') return buildMcpToolResult('get_entity', args, JSON.stringify(retrieval), retrieval);
  const raw = (retrieval.data as { entity: (GraphEntity & { id: string }) | null }).entity;
  const converted = raw ? new GraphAPISource(deps.apiUrl, deps.tokenManager, deps.configuredProjectCodes)
    .convertEntity({ ...raw, entity_id: raw.id }) : null;
  // Canonical API identity is retained even where legacy display IDs use a payload alias.
  const entity = converted && raw ? { ...converted, id: raw.id } : null;
  const result = await prependPhilosophyContext(entity ? formatEntity(entity) : `Entity not found: ${args.type}/${args.id}`, args, {
    scope: 'graph', objectType: args.type as EntityType, operation: 'read',
  });
  return buildMcpToolResult('get_entity', args, result, retrieval, entity);
}

async function refreshEntityIndex(): Promise<void> {
  if (!indexRefreshEnabled) return;
  const state = getEntityIndexState();
  if (!state.source) {
    throw new Error('Graph source is unavailable; entity index cannot be refreshed');
  }
  if (!state.refreshPromise) {
    state.refreshPromise = (async () => {
      const nextIndex = await buildIndex(state.source as EntitySource);
      state.index = nextIndex;
    })().finally(() => {
      state.refreshPromise = null;
    });
  }
  await state.refreshPromise;
}

async function hydrateExtensionQuery(name: string, args: Record<string, unknown>): Promise<void> {
  const state = getEntityIndexState();
  if (!state.source) return;
  const entityIndex = state.index;
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
      const matches = await state.source.searchExtensionEntities(type, term);
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

export function isPublicMcpHttpEndpoint(method: string | undefined, url: string | undefined): boolean {
  return method === 'GET' && url === '/health';
}

/**
 * The HTTP endpoint is intentionally stateless: every MCP request gets its own
 * server and transport, and there is no session for a server-sent event GET to
 * attach to. Rejecting GET explicitly also prevents an open stream from
 * occupying the personal-auth request queue indefinitely.
 */
export function statelessMcpHttpMethodNotAllowed(
  method: string | undefined,
  url: string | undefined,
): { status: 405; headers: Record<string, string>; body: string } | null {
  if (method !== 'GET' || !url?.startsWith('/mcp')) return null;
  return {
    status: 405,
    headers: {
      'Allow': 'POST',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ error: 'Method Not Allowed', message: 'The stateless MCP endpoint accepts POST requests only.' }),
  };
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
        resolveBeforeModel?: (
          args: Record<string, unknown>,
          options: { signal: AbortSignal },
        ) => Promise<JudgmentManagementResult>;
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
    resolveBeforeModel: (args, options) =>
      dispatchJudgmentResolutionBeforeModel(args, undefined, options),
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
  const source = getEntityIndexState().source;
  if (!source) {
    throw new Error('Graph source is unavailable; Philosophy Context cannot be loaded');
  }

  const context = await source.getPhilosophyContext({
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
  const source = getEntityIndexState().source;
  if (!source) {
    throw new Error('Graph source is unavailable; Philosophy Context cannot be loaded');
  }

  const context = await source.getPhilosophyContext({
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
  lines.push(`## ${e.name || e.title || e.id}`);
  lines.push(`- **Type**: ${e.type}`);
  lines.push(`- **ID**: ${e.graph_entity_id || e.id}`);

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

  const evidence = e.retrieval_evidence as Record<string, unknown> | undefined;
  for (const field of ['source_pointer', 'provenance']) {
    if (evidence?.[field]) lines.push(`- **${field}**: ${typeof evidence[field] === 'string' ? evidence[field] : JSON.stringify(evidence[field])}`);
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
  const bodyFields = bodyEvidenceFields(evidence ?? {});
  if (bodyFields.length) {
    for (const field of bodyFields) {
      const value = evidence![field];
      lines.push('', `### ${field}`, '', typeof value === 'string' ? value : JSON.stringify(value));
    }
  } else if (e.content && typeof e.content === 'string' && e.content.trim()) {
    lines.push('', '## Content', '', e.content);
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
    lines.push(`- **${name}** (${type})${status} — ID: ${e.graph_entity_id || e.id}`);
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

function asPersonalKnowledgeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function canonicalPersonalKgHit(event: PersonalKnowledgeEvent): PersonalKgHit {
  const record = asPersonalKnowledgeRecord(event);
  const source = asPersonalKnowledgeRecord(record.source);

  return {
    id: record.event_id as string,
    cognitive_type: 'event',
    body: nonEmptyString(record.body) || '',
    confidence: null,
    source_system: nonEmptyString(source.type) || 'personal_knowledge',
    created_at: nonEmptyString(record.created_at)
      || nonEmptyString(record.occurred_at)
      || nonEmptyString(record.captured_at)
      || '',
  };
}

async function fetchLegacyPersonalKgSearch(
  query: string,
  options: { cognitiveType?: string; limit?: number } = {}
): Promise<PersonalKgHit[]> {
  const token = await globalOwnerTokenManager.getToken();
  const url = new URL('/api/learning/memory-candidates/search', wikiApiBaseUrl);
  url.searchParams.set('q', query);
  if (options.cognitiveType) url.searchParams.set('cognitive_type', options.cognitiveType);
  if (options.limit) url.searchParams.set('limit', String(options.limit));
  const response = await fetch(url.toString(), {
    redirect: 'error',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Personal KG API error: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as { candidates?: PersonalKgHit[] };
  return data.candidates || [];
}

function getPersonalKnowledgeClient(): PersonalKnowledgeClient {
  if (!personalKgStorageMode || !personalKgApiUrl) {
    throw new Error(
      'Personal KG canonical access requires explicit BRAINBASE_PERSONAL_KG_STORAGE_MODE and its API URL.'
    );
  }
  if (!personalKnowledgeClient) {
    personalKnowledgeClient = new PersonalKnowledgeClient({
      mode: personalKgStorageMode,
      apiUrl: personalKgApiUrl,
      tokenManager: globalOwnerTokenManager,
    });
  }
  return personalKnowledgeClient;
}

async function fetchPersonalKgSearch(
  query: string,
  options: { cognitiveType?: string; limit?: number } = {}
): Promise<PersonalKgHit[]> {
  if (!personalKgStorageMode) {
    return fetchLegacyPersonalKgSearch(query, options);
  }

  if (options.cognitiveType?.trim()) {
    throw new Error('Personal KG cognitive_type filtering is unavailable in canonical storage mode.');
  }

  const events = await getPersonalKnowledgeClient().search(query, options.limit);
  return events.map(canonicalPersonalKgHit);
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
    name: 'list_entities',
    description: 'Enumerate all core Graph entities of an explicitly requested type. Use this for bounded enumeration, not for answering a general natural-language question; use search for that.',
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
    description: 'Retrieve one known Graph entity by its canonical Graph ID. Use resolve_entity for identity disambiguation and search for general questions.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'The Graph entity_type returned by search or resolve_entity',
        },
        id: {
          type: 'string',
          description: 'The canonical Graph entity ID',
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
    description: 'Enumerate entities for an explicitly requested extension type. An optional query is a bounded identity or field filter, not general question search.',
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
    description: 'Search authorized Graph entities with semantic retrieval and evidence, then optionally traverse a bounded plan of real relations. Use this as the only general organizational question search. Inspect evidence and insufficiency before answering; similarity is not entailment.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
        },
        mode: { type: 'string', enum: ['semantic'], default: 'semantic', description: 'Compatibility field; semantic retrieval is the only supported mode.' },
        top_k: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
        inspect_relations: { type: 'boolean', default: true, description: 'Inspect actual relation names around the first three semantic candidates for a subsequent model-selected plan.' },
        types: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string' } },
        plan: {
          type: 'object', additionalProperties: false,
          properties: {
            seed_ids: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string' } },
            steps: {
              type: 'array', minItems: 1, maxItems: 3,
              items: {
                type: 'object', additionalProperties: false,
                properties: {
                  relation: { type: 'string', minLength: 1 },
                  direction: { type: 'string', enum: ['incoming', 'outgoing'] },
                  target_type: { type: 'string' },
                },
                required: ['relation', 'direction'],
              },
            },
          },
          required: ['seed_ids', 'steps'],
        },
        project: {
          type: 'string',
          description: 'Optional authorized project filter for semantic Graph retrieval and philosophy context.',
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
    description: 'Resolve a known person, organization, project, brand, or other entity name or identifier to canonical Graph candidates with field-level evidence. Use for identity disambiguation, not as a replacement for general question search or absence claims.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Known entity name, alias, or identifier to resolve into Graph entity candidates.',
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
      "Search the authenticated user's separate Personal KG (owner-visible memory_candidates) by keyword over the full body text. This is an owner-only source for the user's own stance, values, sales/content philosophy, or decision principles; it is not a substitute for general organizational Graph search. Returns cognitive_type and confidence. Owner-only, non-redacted content.",
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
  {
    name: 'register_personal_kg',
    description:
      'Register an event in the authenticated owner\'s canonical Personal Vault. The server derives owner and organization from authentication; this tool never promotes content to the organization KG.',
    inputSchema: {
      type: 'object',
      properties: {
        event: {
          type: 'object',
          description: 'Personal Vault event fields persisted by the canonical API. Do not include owner_person_id or organization_id.',
          properties: {
            event_id: { type: 'string', minLength: 1 },
            occurred_at: { type: 'string' },
            captured_at: { type: 'string' },
            source: { type: 'object' },
            source_pointer: { type: 'object' },
            body_hash: { type: 'string', minLength: 1 },
            body: { type: 'string', minLength: 1 },
            parent_episode_id: { type: 'string' },
            permission_snapshot: { type: 'object' },
            sensitivity: { type: 'string' },
          },
          additionalProperties: false,
          required: ['body', 'body_hash'],
        },
      },
      required: ['event'],
      additionalProperties: false,
    },
  },
];

/**
 * Handle tool calls
 */
export function rejectLegacySearchSurface(name: string, args: Record<string, unknown>): void {
  if (name === 'get_context') {
    throw new Error('MCP tool "get_context" was removed from the normal search surface; use "search" for general Graph questions or "get_entity"/"resolve_entity" for a known identity.');
  }
  if (name === 'search_wiki') {
    throw new Error('MCP tool "search_wiki" was removed from the normal search surface; use "brainbase_knowledge_resolve" to locate the canonical document source.');
  }
  if (name === 'search' && args.mode === 'lexical') {
    throw new Error('Lexical search mode is disabled; call "search" without mode for semantic Graph retrieval, or use "resolve_entity"/"get_entity" for a known identifier.');
  }
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  rejectLegacySearchSurface(name, args);
  // Every index consumer must await a fresh, complete snapshot. Metadata and
  // Resolver calls do not depend on the full Graph index.
  if (['search', 'resolve_entity', 'list_entities', 'list_extension_entities', 'get_context', 'get_entity'].includes(name)
    || (name === 'search_personal_kg' && typeof args.person_entity_id === 'string' && args.person_entity_id.trim())) {
    await refreshEntityIndex();
  }
  if (name === 'resolve_entity' || name === 'list_extension_entities') {
    await hydrateExtensionQuery(name, args);
  }
  const entityIndex = getEntityIndexState().index;
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

      return prependPhilosophyContext(entity ? formatEntity(entity) : `Entity not found: ${type}/${id}`, args, {
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
            .find(entity => (entity.graph_entity_id || entity.id) === candidate.entity_id))
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

    case 'register_personal_kg': {
      if (!personalKgStorageMode) {
        throw new Error(
          'Personal KG registration requires explicit BRAINBASE_PERSONAL_KG_STORAGE_MODE; no legacy write fallback is available.'
        );
      }
      const receipt = await getPersonalKnowledgeClient().register(
        args.event as PersonalKnowledgeEvent,
      );
      return JSON.stringify(receipt, null, 2);
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

export const publishedTools = annotateToolCapabilities([
  ...tools,
  ...controlPlaneTools,
  ...onboardingTools,
  ...graphMaintenanceTools,
  ...judgmentResolutionTools,
  ...judgmentAuditTools,
  ...judgmentValueProofTools,
  ...judgmentNodeTools,
  ...judgmentStateTools,
  ...knowledgeEvidenceTools,
  ...knowledgeResolutionTools,
  ...meetingMinutesContextTools,
  ...shareablePersonProfileTools,
  ...taskTools,
  ...tenantBoundaryTools,
  ...meshTools,
]);

export const __testing = {
  tools: publishedTools,
  formatEntity,
  dispatchGetEntity,
  dispatchOnboardingToolCall,
  dispatchJudgmentResolutionBeforeModel,
  dispatchRemoteJudgmentHook,
  dispatchKnowledgeResolutionToolCall,
  dispatchExtensionToolCall,
  buildToolResponseContent,
  buildMcpToolResult,
  createDefaultJudgmentResolutionDependencies,
  resolveBrainbaseApiUrl,
  resolveWikiApiBaseUrl,
  setPersonalKgStorage(mode: PersonalKgStorageMode | null | undefined, apiUrl?: string): void {
    personalKgStorageMode = mode || undefined;
    personalKgApiUrl = personalKgStorageMode
      ? normalizePersonalKgApiUrl(apiUrl || '', personalKgStorageMode)
      : undefined;
    personalKnowledgeClient = null;
  },
  setEntityIndex(index: EntityIndex): void {
    getEntityIndexState().index = index;
  },
  setGraphSource(source: GraphAPISource | null): void {
    graphSourceFactory = source ? () => source : null;
    getEntityIndexState().source = source;
  },
  setGraphSourceFactory(factory: (() => GraphAPISource) | null): void {
    graphSourceFactory = factory;
    entityIndexStates.clear();
  },
  setIndexRefreshEnabled(enabled: boolean): void {
    indexRefreshEnabled = enabled;
  },
  runWithEntityIndexScope<T>(scope: string, callback: () => T): T {
    return entityIndexScope.run(scope, callback);
  },
  resetEntityIndexStates(): void {
    entityIndexStates.clear();
  },
  setTokenManager(manager: { getToken(): Promise<string> }): void {
    globalTokenManager = manager;
    globalOwnerTokenManager = manager;
  },
  setOwnerTokenManager(manager: { getToken(): Promise<string> }): void {
    globalOwnerTokenManager = manager;
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

  const { mode: connectionAuthMode, tokenManager } = createConnectionTokenManager(config.graphApiUrl);
  console.error(`[brainbase] Authentication mode: ${connectionAuthMode}`);
  const requestTokenContext = new RequestTokenContext(tokenManager);
  const tenantTokenRouter = createTenantTokenRouterFromEnvironment(config.graphApiUrl);
  globalTokenManager = requestTokenContext;
  // All routes share the connection actor. Personal APIs still enforce owner authorization.
  globalOwnerTokenManager = requestTokenContext;
  personalKgStorageMode = config.personalKgStorageMode;
  personalKgApiUrl = config.personalKgApiUrl;
  personalKnowledgeClient = null;
  wikiApiBaseUrl = resolveWikiApiBaseUrl(config.graphApiUrl);
  graphSourceFactory = () => new GraphAPISource(config.graphApiUrl, requestTokenContext, config.projectCodes);
  indexRefreshEnabled = true;
  defaultProjectCode = config.projectCodes?.[0] || 'brainbase';
  configuredProjectCodes = config.projectCodes;
  console.error('[brainbase] Using Graph API source');

  // The full Graph projection is loaded on demand by index consumers. Do not
  // hold the transport or Resolver hostage to it, or turn a failed load into
  // a successful empty result. refreshEntityIndex atomically publishes only
  // a complete snapshot and shares concurrent loads.
  entityIndexStates.clear();
  entityIndexStates.set(defaultEntityIndexScope, {
    index: createEmptyIndex(),
    refreshPromise: null,
    source: graphSourceFactory(),
    lastAccessedAt: Date.now(),
  });

  // Create the MCP server.
  // Factory (not a singleton) so the stateless Streamable HTTP transport can
  // build one Server per request — the heavy shared state (entityIndex,
  // resolved Brainbase API URL) lives outside each request handler.
  function createServer(requestContext: { companyAuthorityResponse?: string; tenantRoutingError?: Error } = {}) {
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
      if (requestContext.tenantRoutingError) throw requestContext.tenantRoutingError;
      const toolArgs = args as Record<string, unknown>;
      rejectLegacySearchSurface(name, toolArgs);
      if (name === 'get_entity') {
        return dispatchGetEntity(toolArgs, {
          apiUrl: resolveBrainbaseApiUrl(), configuredProjectCodes, tokenManager: globalTokenManager,
        });
      }
      const extensionResult = await dispatchExtensionToolCall(name, toolArgs, [
        async (toolName, extensionArgs) => {
          const retrieval = await handleGraphRetrievalToolCall(toolName, extensionArgs, {
            apiUrl: resolveBrainbaseApiUrl(),
            configuredProjectCodes,
            tokenManager: globalTokenManager,
          });
          if (!retrieval || retrieval.status !== 'ok') return retrieval;
          return { ...retrieval, philosophy_context: await philosophyContextPrompt(extensionArgs, {
            scope: 'graph', objectType: 'search', operation: 'read',
          }) };
        },
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
        (toolName, extensionArgs) => dispatchKnowledgeResolutionToolCall(toolName, extensionArgs, undefined, requestContext.companyAuthorityResponse),
        (toolName, extensionArgs) => handleJudgmentResolutionToolCall(
          toolName, extensionArgs, {
            ...createDefaultJudgmentResolutionDependencies(),
            companyAuthorityResponse: requestContext.companyAuthorityResponse,
          },
        ),
        (toolName, extensionArgs) => handleJudgmentAuditToolCall(toolName, extensionArgs),
        (toolName, extensionArgs) => handleJudgmentValueProofToolCall(toolName, extensionArgs),
        (toolName, extensionArgs) => handleJudgmentNodeToolCall(toolName, extensionArgs),
        (toolName, extensionArgs) => handleKnowledgeEvidenceToolCall(toolName, extensionArgs),
        (toolName, extensionArgs) => handleJudgmentStateToolCall(toolName, extensionArgs),
        (toolName, extensionArgs) => handleMeetingMinutesContextToolCall(toolName, extensionArgs, {
          apiUrl: resolveBrainbaseApiUrl(),
          serviceToken: taskApiToken,
        }),
        (toolName, extensionArgs) => handleShareablePersonProfileToolCall(toolName, extensionArgs, {
          apiUrl: process.env.BRAINBASE_TENANT_RUNTIME_API_URL?.trim() || resolveBrainbaseApiUrl(),
          serviceToken: process.env.BRAINBASE_TENANT_RUNTIME_SERVICE_TOKEN,
          companyAuthorityResponse: requestContext.companyAuthorityResponse,
        }),
        (toolName, extensionArgs) => handleTaskToolCall(toolName, extensionArgs, {
          apiUrl: taskApiUrl,
          token: taskApiToken,
        }),
        (toolName, extensionArgs) => handleMeshToolCall(toolName, extensionArgs, resolveBrainbaseApiUrl(), {
          getToken: () => globalTokenManager.getToken(),
        }),
      ]);
      const result = extensionResult === null
        ? await handleToolCall(name, toolArgs)
        : typeof extensionResult === 'string'
          ? extensionResult
          : JSON.stringify(extensionResult, null, 2);
      return buildMcpToolResult(name, toolArgs, result, extensionResult);
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
    const authMode = (process.env.MCP_HTTP_AUTH_MODE || 'shared-bearer') as McpHttpAuthMode;
    if (!['shared-bearer', 'brainbase-jwt', 'hybrid'].includes(authMode)) {
      throw new Error(`Unsupported MCP_HTTP_AUTH_MODE: ${authMode}`);
    }
    if (authMode === 'shared-bearer' && !bearerToken) {
      throw new Error('MCP_HTTP_BEARER_TOKEN is required in shared-bearer mode');
    }
    const authVerifyUrl = process.env.MCP_HTTP_AUTH_VERIFY_URL
      || `${config.graphApiUrl.replace(/\/$/, '')}/api/auth/verify`;
    const requiredOrganizationId = process.env.MCP_HTTP_REQUIRED_ORGANIZATION_ID || undefined;
    const http = await import('node:http');
    const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const host = process.env.MCP_HTTP_HOST || '127.0.0.1';
    // The entity index is process-global. In personal-auth modes, serialize MCP
    // requests and rebuild it with the caller's token so one user's snapshot is
    // never observed by another user with different permissions.
    let authenticatedRequestQueue: Promise<void> = Promise.resolve();
    async function runAuthenticatedRequest<T>(callback: () => Promise<T>): Promise<T> {
      if (authMode === 'shared-bearer') return callback();
      const previous = authenticatedRequestQueue;
      let release!: () => void;
      authenticatedRequestQueue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await callback();
      } finally {
        release();
      }
    }

    const httpServer = http.createServer(async (req, res) => {
      if (isPublicMcpHttpEndpoint(req.method, req.url)) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
      }
      if (handleHealthVersionRequest(req, res)) return;
      const auth = await authenticateMcpHttpRequest(req.headers.authorization, {
        mode: authMode,
        sharedBearerToken: bearerToken,
        verifyUrl: authVerifyUrl,
        requiredOrganizationId,
      });
      if (!auth.ok) {
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer',
        });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      // Stateless MCP has no session to associate with an SSE GET. Reject it
      // after authentication but before the personal-auth request queue so a
      // long-lived GET can never block subsequent POST requests.
      const methodNotAllowed = statelessMcpHttpMethodNotAllowed(req.method, req.url);
      if (methodNotAllowed) {
        res.writeHead(methodNotAllowed.status, methodNotAllowed.headers);
        res.end(methodNotAllowed.body);
        return;
      }
      if (req.method === 'POST' && req.url === REMOTE_JUDGMENT_HOOK_PATH) {
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
          // The request has already passed the configured shared/JWT strategy above.
          isAuthorized: () => true,
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

      let tenantRoute: Awaited<ReturnType<NonNullable<typeof tenantTokenRouter>['resolve']>>;
      let tenantRoutingError: Error | undefined;
      if (auth.kind === 'shared-bearer' && tenantTokenRouter && body && typeof body === 'object') {
        const requestBody = body as { method?: unknown; params?: { arguments?: unknown } };
        const routeArguments = requestBody.method === 'tools/call'
          && requestBody.params?.arguments
          && typeof requestBody.params.arguments === 'object'
          && !Array.isArray(requestBody.params.arguments)
          ? requestBody.params.arguments as Record<string, unknown>
          : undefined;
        if (routeArguments) {
          try {
            tenantRoute = await tenantTokenRouter.resolve(routeArguments);
          } catch (error) {
            tenantRoutingError = error instanceof Error ? error : new Error(String(error));
          }
        }
      }

      const rawCompanyAuthority = req.headers['x-brainbase-company-authority-response'];
      const server = createServer({
        companyAuthorityResponse: Array.isArray(rawCompanyAuthority)
          ? rawCompanyAuthority[0]
          : rawCompanyAuthority,
        tenantRoutingError,
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      const handleMcpRequest = async () => {
        // Do not rebuild the legacy full Graph projection at the HTTP edge.
        // Extension handlers use their own bounded API path, while legacy
        // index consumers refresh immediately before their specific operation.
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
      };
      await runAuthenticatedRequest(async () => {
        if (auth.kind === 'brainbase-jwt') {
          const scope = `principal:${JSON.stringify({
            organizationId: auth.principal.organizationId,
            personId: auth.principal.personId,
            projectCodes: stableScopePart(auth.principal.projectCodes),
            clearance: stableScopePart(auth.principal.clearance),
            role: auth.principal.role,
          })}`;
          await entityIndexScope.run(scope, () => requestTokenContext.run({ token: auth.token }, handleMcpRequest));
          return;
        }
        if (tenantRoute) {
          const scope = `tenant:${JSON.stringify({
            tenant: tenantRoute.tenant,
            organizationId: tenantRoute.organizationId,
            projectCodes: stableScopePart(tenantRoute.projectCodes),
          })}`;
          await entityIndexScope.run(scope, () => requestTokenContext.run({ token: tenantRoute!.token }, handleMcpRequest));
          return;
        }
        // A shared MCP bearer authenticates only the MCP edge. It must never be
        // forwarded to Graph API; the fallback service token remains the caller.
        await handleMcpRequest();
      });
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
