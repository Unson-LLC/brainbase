import { extractEvidence, hasSubstantiveValue } from './graph-evidence.js';
/**
 * Graph API Source
 * Loads entities from Graph SSOT API
 */

import type { EntitySource } from './entity-source.js';
import type {
  Project,
  Person,
  Organization,
  Brand,
  RACI,
  App,
  Customer,
  Partner,
  Decision,
  GlossaryTerm,
  Document,
  ExtensionEntity,
  PositionEntry,
  DecisionEntry,
  AssignmentEntry,
  AppEnvironmentEndpoints,
  AppEnvironmentProfile,
  AppOperationalProfileCoverage,
  AppRepositoryRef,
} from './entity-types.js';
import type { TokenProvider } from './graph-token-provider.js';
import type { TokenRequestOptions } from './graph-token-provider.js';
import {
  EXTENSION_ENTITY_TYPE_SET,
  getExtensionRegistrations,
  getGraphFetchTypes,
  getPublicType,
  getStorageType,
  type EntityTypeRegistration,
} from './entity-ontology.js';
import { isActiveLifecycle } from './entity-indexer.js';

export interface GraphEntity {
  entity_id: string;
  entity_type: string;
  payload: Record<string, unknown>;
  project_code?: string;
  organization_id?: string;
  tenant_id?: string;
  updated_at?: string;
  lifecycle_status?: string;
  lifecycle_state?: string;
  semantic_state?: string;
  version?: number;
}

export const GRAPH_ALIAS_TYPES = ['org_alias', 'person_alias'] as const;

export function mergeGraphAliasPointers(canonicalEntities: GraphEntity[], aliasEntities: GraphEntity[]): GraphEntity[] {
  const canonicalById = new Map(canonicalEntities.map(entity => [entity.entity_id, entity]));
  for (const alias of aliasEntities) {
    if (!isActiveLifecycle(alias)) continue;
    const canonicalId = alias.payload.canonical_entity_id;
    const canonicalType = alias.entity_type === 'org_alias' ? 'org' : alias.entity_type === 'person_alias' ? 'person' : null;
    if (typeof canonicalId !== 'string' || !canonicalType) continue;
    const canonical = canonicalById.get(canonicalId);
    if (!canonical || canonical.entity_type !== canonicalType) continue;
    if (!isActiveLifecycle(canonical)) continue;
    const existing = Array.isArray(canonical.payload.aliases)
      ? canonical.payload.aliases.filter((value): value is string => typeof value === 'string')
      : [];
    canonical.payload = { ...canonical.payload, aliases: [...new Set([...existing, alias.entity_id])] };
  }
  return canonicalEntities;
}

export interface PhilosophyContextRequest {
  projectCode: string;
  scope?: string;
  objectType?: string;
  operation?: string;
  maxRecommended?: number;
}

export interface PhilosophyContext {
  mode: string;
  project_code: string;
  scope: string;
  prompt_block: string;
  applied_ids?: string[];
  decision_tests?: string[];
  anti_patterns?: string[];
}

export interface GraphAPISourceOptions {
  /** Maximum time allowed to build one complete Graph snapshot. */
  initializeTimeoutMs?: number;
  /** Maximum time allowed for one Graph API request, including its body. */
  fetchTimeoutMs?: number;
  /** Maximum time allowed for a token refresh after a 401. */
  tokenRefreshTimeoutMs?: number;
}

type GraphSourceErrorCode = 'graph_source_unavailable' | 'graph_source_timeout';

export class GraphSourceUnavailableError extends Error {
  readonly code: GraphSourceErrorCode;
  readonly entityType?: string;
  readonly status?: number;

  constructor(
    message: string,
    options: {
      code?: GraphSourceErrorCode;
      entityType?: string;
      status?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'GraphSourceUnavailableError';
    this.code = options.code || 'graph_source_unavailable';
    this.entityType = options.entityType;
    this.status = options.status;
  }
}

const DEFAULT_INITIALIZE_TIMEOUT_MS = 45_000;
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_TOKEN_REFRESH_TIMEOUT_MS = 15_000;

const PUBLIC_PROFILE_STRING_LIMIT = 1_000;
const PUBLIC_PROFILE_ARRAY_LIMIT = 100;
const PUBLIC_PROFILE_ENVIRONMENT_LIMIT = 50;
const SENSITIVE_PROFILE_VALUE = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|credential|private[_-]?key|authorization|cookie)/iu;

function boundedString(value: unknown, maxLength = PUBLIC_PROFILE_STRING_LIMIT): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text && text.length <= maxLength ? text : undefined;
}

/**
 * Keep profile identifiers useful for display while rejecting obvious secret
 * material. Unknown Graph payload keys are never copied into this projection.
 */
export function publicProfileString(value: unknown): string | undefined {
  const text = boundedString(value);
  return text && !SENSITIVE_PROFILE_VALUE.test(text) ? text : undefined;
}

function publicProfileUrl(value: unknown): string | undefined {
  const text = publicProfileString(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return text;
}

function publicProfileArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const result = values
    .slice(0, PUBLIC_PROFILE_ARRAY_LIMIT)
    .map(item => publicProfileString(item))
    .filter((item): item is string => !!item);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function compactProfileObject<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function projectRepository(value: unknown): AppRepositoryRef | undefined {
  if (typeof value === 'string') {
    const repository = publicProfileString(value);
    if (!repository) return undefined;
    const slash = repository.indexOf('/');
    if (slash > 0 && slash < repository.length - 1) {
      return { owner: repository.slice(0, slash), repo: repository.slice(slash + 1) };
    }
    return { repo: repository };
  }
  if (!isRecord(value)) return undefined;
  const result = compactProfileObject<AppRepositoryRef>({
    owner: publicProfileString(value.owner),
    repo: publicProfileString(value.repo),
    url: publicProfileUrl(value.url),
    ref: publicProfileString(value.ref),
  });
  return Object.values(result).some(item => item !== undefined) ? result : undefined;
}

function projectEnvironmentEndpoints(value: unknown): AppEnvironmentEndpoints | undefined {
  if (!isRecord(value)) return undefined;
  const result = compactProfileObject<AppEnvironmentEndpoints>({
    api: publicProfileUrl(value.api),
    health: publicProfileUrl(value.health),
    nocodb: publicProfileUrl(value.nocodb),
    ssot_graph: publicProfileUrl(value.ssot_graph),
    url: publicProfileUrl(value.url),
    worker: publicProfileString(value.worker),
  });
  return Object.values(result).some(item => item !== undefined) ? result : undefined;
}

function projectEnvironment(value: unknown): AppEnvironmentProfile | undefined {
  if (!isRecord(value)) return undefined;
  const result = compactProfileObject<AppEnvironmentProfile>({
    mode: publicProfileString(value.mode),
    host: publicProfileString(value.host),
    region: publicProfileString(value.region),
    instance: publicProfileString(value.instance),
    url: publicProfileUrl(value.url),
    ui_url: publicProfileUrl(value.ui_url),
    worktree_ui_url: publicProfileUrl(value.worktree_ui_url),
    endpoint: publicProfileUrl(value.endpoint),
    worker: publicProfileString(value.worker),
    runtime: publicProfileString(value.runtime),
    ai_service: publicProfileString(value.ai_service),
    data_services: publicProfileArray(value.data_services),
    async_services: publicProfileArray(value.async_services),
    mobile_runtime: publicProfileString(value.mobile_runtime),
    functions: publicProfileArray(value.functions),
    purpose: publicProfileString(value.purpose),
    endpoints: projectEnvironmentEndpoints(value.endpoints),
  });
  return Object.values(result).some(item => item !== undefined) ? result : undefined;
}

function projectEnvironments(value: unknown): Record<string, AppEnvironmentProfile> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, AppEnvironmentProfile> = {};
  for (const [name, raw] of Object.entries(value).slice(0, PUBLIC_PROFILE_ENVIRONMENT_LIMIT)) {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/iu.test(name) || SENSITIVE_PROFILE_VALUE.test(name)) continue;
    const environment = projectEnvironment(raw);
    if (environment) result[name] = environment;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function configuredTimeout(value: number | undefined, fallback: number, envName: string): number {
  const raw = value === undefined ? process.env[envName]?.trim() : undefined;
  const parsed = value === undefined && raw ? Number(raw) : value;
  if (parsed === undefined) return fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a finite positive number of milliseconds`);
  }
  return Math.max(1, Math.floor(parsed));
}

function createDeadlineSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  operation: string,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }
  const timer = setTimeout(() => {
    controller.abort(new Error(`${operation} timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    },
  };
}

function graphMetadata(entity: GraphEntity): {
  graph_entity_id: string;
  project_code?: string;
  organization_id?: string;
  tenant_id?: string;
  source?: string;
  source_path?: string;
  legacy_source_path?: string;
  lifecycle_status?: string;
  lifecycle_state?: string;
  semantic_state?: string;
  canonical_entity_id?: string;
  version?: number;
} {
  const lifecycleStatus = entity.lifecycle_status || entity.lifecycle_state;
  const semanticState = entity.semantic_state
    || (typeof entity.payload.semantic_state === 'string' ? entity.payload.semantic_state : undefined);
  const organizationId = boundedString(entity.organization_id) || boundedString(entity.payload.organization_id);
  const tenantId = boundedString(entity.tenant_id) || boundedString(entity.payload.tenant_id);
  return {
    graph_entity_id: entity.entity_id,
    project_code: entity.project_code,
    organization_id: organizationId,
    tenant_id: tenantId,
    source: entity.payload.source as string | undefined,
    source_path: entity.payload.source_path as string | undefined,
    legacy_source_path: entity.payload.legacy_source_path as string | undefined,
    lifecycle_status: lifecycleStatus,
    lifecycle_state: lifecycleStatus,
    semantic_state: semanticState,
    canonical_entity_id: boundedString(entity.payload.canonical_entity_id),
    version: typeof entity.version === 'number' ? entity.version : undefined,
  };
}

export class GraphAPISource implements EntitySource {
  private apiUrl: string;
  private tokenManager: TokenProvider;
  private projectCodes?: string[];
  private entities: GraphEntity[] = [];
  private initializeTimeoutMs: number;
  private fetchTimeoutMs: number;
  private tokenRefreshTimeoutMs: number;

  constructor(
    apiUrl: string,
    tokenManager: TokenProvider,
    projectCodes?: string[],
    options: GraphAPISourceOptions = {},
  ) {
    this.apiUrl = apiUrl;
    this.tokenManager = tokenManager;
    this.projectCodes = projectCodes;
    this.initializeTimeoutMs = configuredTimeout(
      options.initializeTimeoutMs,
      DEFAULT_INITIALIZE_TIMEOUT_MS,
      'BRAINBASE_GRAPH_INDEX_INITIALIZE_TIMEOUT_MS',
    );
    this.fetchTimeoutMs = configuredTimeout(
      options.fetchTimeoutMs,
      DEFAULT_FETCH_TIMEOUT_MS,
      'BRAINBASE_GRAPH_FETCH_TIMEOUT_MS',
    );
    this.tokenRefreshTimeoutMs = configuredTimeout(
      options.tokenRefreshTimeoutMs,
      DEFAULT_TOKEN_REFRESH_TIMEOUT_MS,
      'BRAINBASE_GRAPH_TOKEN_REFRESH_TIMEOUT_MS',
    );
  }

  async initialize(): Promise<void> {
    console.error('[GraphAPISource] Fetching entities from Graph API...');
    const deadline = createDeadlineSignal(
      undefined,
      this.initializeTimeoutMs,
      'Graph index initialization',
    );

    try {
      const tokenOptions: TokenRequestOptions = {
        signal: deadline.signal,
        timeoutMs: this.tokenRefreshTimeoutMs,
      };
      const token = await this.tokenManager.getToken(tokenOptions);
      const baseUrl = `${this.apiUrl}/api/info/graph/entities`;
      const allEntities: GraphEntity[] = [];

      for (const type of getGraphFetchTypes()) {
        const response = await this.fetchWithRetry(
          `${baseUrl}?type=${type}&limit=500`,
          token,
          deadline.signal,
        );

        if (!response.ok) {
          throw this.unavailableForResponse(type, response);
        }

        const data = await response.json() as unknown;
        const records = this.recordsFromResponse(data, type).map(r => {
          const raw = r as unknown as Record<string, unknown>;
          return {
            ...r,
            entity_id: r.entity_id || raw.id as string,
            entity_type: getPublicType((r.entity_type || type) as string),
          };
        });
        allEntities.push(...records);
        if (records.length > 0) {
          console.error(`[GraphAPISource]   ${type}: ${records.length}`);
        }
      }

      const aliasEntities: GraphEntity[] = [];
      for (const type of GRAPH_ALIAS_TYPES) {
        const response = await this.fetchWithRetry(
          `${baseUrl}?type=${type}&limit=500`,
          token,
          deadline.signal,
        );
        if (!response.ok) {
          throw this.unavailableForResponse(type, response);
        }
        const data = await response.json() as unknown;
        const records = this.recordsFromResponse(data, type).map(r => {
          const raw = r as unknown as Record<string, unknown>;
          return {
            ...r,
            entity_id: r.entity_id || raw.id as string,
            entity_type: r.entity_type || type,
          };
        });
        aliasEntities.push(...records);
      }

      // A deadline can fire between the last body read and this assignment.
      // Keep publication atomic: the caller must never observe a timed-out
      // snapshot as if it were complete.
      if (deadline.signal.aborted) {
        throw new GraphSourceUnavailableError(
          `Graph index initialization timed out after ${this.initializeTimeoutMs}ms`,
          { code: 'graph_source_timeout', cause: deadline.signal.reason },
        );
      }

      // Publish only a complete snapshot. A failed refresh leaves the last
      // known-good snapshot intact for the caller to handle explicitly.
      this.entities = mergeGraphAliasPointers(allEntities, aliasEntities);
      console.error(`[GraphAPISource] Loaded ${this.entities.length} entities from Graph API`);
    } catch (error) {
      if (error instanceof GraphSourceUnavailableError) {
        throw error;
      }
      if (deadline.signal.aborted) {
        throw new GraphSourceUnavailableError(
          `Graph index initialization timed out after ${this.initializeTimeoutMs}ms`,
          { code: 'graph_source_timeout', cause: error },
        );
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new GraphSourceUnavailableError(`Graph API initialization unavailable: ${detail}`, { cause: error });
    } finally {
      deadline.cleanup();
    }
  }

  private async fetchWithRetry(
    url: string,
    token: string,
    parentSignal?: AbortSignal,
  ): Promise<Response> {
    const fetchOnce = async (requestToken: string): Promise<Response> => {
      const deadline = createDeadlineSignal(
        parentSignal,
        this.fetchTimeoutMs,
        'Graph API request',
      );
      try {
        const response = await fetch(url, {
          headers: this.buildHeaders(requestToken),
          signal: deadline.signal,
        });

        // Keep the actual request signal alive while callers consume the body;
        // a response promise can resolve before response.json() finishes.
        if (response.ok && typeof response.json === 'function') {
          const json = response.json.bind(response);
          response.json = async () => {
            try {
              return await json();
            } catch (error) {
              if (deadline.signal.aborted) {
                throw this.requestDeadlineError(parentSignal, error);
              }
              throw error;
            } finally {
              deadline.cleanup();
            }
          };
        } else {
          // Failed responses are not consumed by the caller. Release their
          // body so a persistent Graph connection cannot remain occupied.
          try {
            await response.body?.cancel();
          } catch {
            // The status is already the useful failure; body cancellation is best effort.
          }
          deadline.cleanup();
        }
        return response;
      } catch (error) {
        deadline.cleanup();
        if (parentSignal?.aborted || deadline.signal.aborted) {
          throw this.requestDeadlineError(parentSignal, error);
        }
        throw new GraphSourceUnavailableError('Graph API request unavailable', {
          cause: error,
        });
      }
    };

    let response = await fetchOnce(token);
    if (response.status === 401) {
      console.error('[GraphAPISource] Token expired, refreshing...');
      if (!this.tokenManager.refresh) return response;
      await this.tokenManager.refresh({
        signal: parentSignal,
        timeoutMs: this.tokenRefreshTimeoutMs,
      });
      const newToken = await this.tokenManager.getToken({
        signal: parentSignal,
        timeoutMs: this.tokenRefreshTimeoutMs,
      });
      response = await fetchOnce(newToken);
    }

    return response;
  }

  private requestDeadlineError(parentSignal: AbortSignal | undefined, cause: unknown): GraphSourceUnavailableError {
    const parentReason = parentSignal?.reason;
    const reason = parentSignal?.aborted
      ? parentReason instanceof Error && /timed out after/.test(parentReason.message)
        ? parentReason.message
        : 'cancelled by the caller'
      : `timed out after ${this.fetchTimeoutMs}ms`;
    return new GraphSourceUnavailableError(`Graph API request ${reason}`, {
      code: 'graph_source_timeout',
      cause,
    });
  }

  private unavailableForResponse(type: string, response: Response): GraphSourceUnavailableError {
    const statusText = response.statusText ? ` ${response.statusText}` : '';
    return new GraphSourceUnavailableError(
      `Graph API snapshot incomplete: failed to fetch ${type} (${response.status}${statusText})`,
      {
        entityType: type,
        status: response.status,
      },
    );
  }

  private recordsFromResponse(data: unknown, type: string): GraphEntity[] {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new GraphSourceUnavailableError(
        `Graph API snapshot incomplete: ${type} response was not an object`,
        { entityType: type },
      );
    }
    const container = data as Record<string, unknown>;
    const records = container.entities ?? container.records;
    if (!Array.isArray(records)) {
      throw new GraphSourceUnavailableError(
        `Graph API snapshot incomplete: ${type} response did not include an entities array`,
        { entityType: type },
      );
    }
    return records.map((record, index) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new GraphSourceUnavailableError(
          `Graph API snapshot incomplete: ${type} response included an invalid record at index ${index}`,
          { entityType: type },
        );
      }
      const raw = record as Record<string, unknown>;
      const entityId = [raw.entity_id, raw.id].find(
        (value): value is string => typeof value === 'string' && value.trim().length > 0,
      );
      if (!entityId) {
        throw new GraphSourceUnavailableError(
          `Graph API snapshot incomplete: ${type} response record at index ${index} did not include a non-empty entity_id or id`,
          { entityType: type },
        );
      }
      if (!raw.payload || typeof raw.payload !== 'object' || Array.isArray(raw.payload)) {
        throw new GraphSourceUnavailableError(
          `Graph API snapshot incomplete: ${type} response record at index ${index} did not include an object payload`,
          { entityType: type },
        );
      }
      return { ...raw, entity_id: entityId } as GraphEntity;
    });
  }

  private buildHeaders(token: string): Record<string, string> {
    const tokenProjects = (() => {
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
        const raw = Array.isArray(payload.projectCodes)
          ? payload.projectCodes
          : Array.isArray(payload.project_codes)
            ? payload.project_codes
            : [];
        return raw.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
      } catch {
        return [];
      }
    })();
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-brainbase-role': process.env.BRAINBASE_ROLE || 'gm',
      'x-brainbase-projects': this.projectCodes?.join(',') || tokenProjects.join(',') || process.env.BRAINBASE_PROJECTS || 'brainbase',
      'x-brainbase-clearance': process.env.BRAINBASE_CLEARANCE || 'internal,restricted,finance,hr,contract',
    };
  }

  private filterByProjectCodes(entities: GraphEntity[]): GraphEntity[] {
    if (!this.projectCodes || this.projectCodes.length === 0) {
      return entities;
    }

    return entities.filter(entity => {
      if (entity.entity_type === 'project') {
        const projectCode = entity.project_code || '';
        return this.projectCodes!.includes(projectCode);
      }
      return true;
    });
  }

  async getProjects(): Promise<Project[]> {
    return this.filterByProjectCodes(this.entities.filter(e => e.entity_type === 'project')).map(e => this.convertToProject(e));
  }

  async getPeople(): Promise<Person[]> {
    return this.entities.filter(e => e.entity_type === 'person').map(e => this.convertToPerson(e));
  }

  async getOrganizations(): Promise<Organization[]> {
    return this.entities.filter(e => e.entity_type === 'org').map(e => this.convertToOrg(e));
  }

  async getBrands(): Promise<Brand[]> {
    return this.entities.filter(e => e.entity_type === 'brand').map(e => this.convertToBrand(e));
  }

  async getRACIs(): Promise<RACI[]> {
    return this.entities.filter(e => e.entity_type === 'raci').map(e => this.convertToRACI(e));
  }

  async getApps(): Promise<App[]> {
    return this.entities.filter(e => e.entity_type === 'app').map(e => this.convertToApp(e));
  }

  async getCustomers(): Promise<Customer[]> {
    return this.entities.filter(e => e.entity_type === 'customer').map(e => this.convertToCustomer(e));
  }

  async getPartners(): Promise<Partner[]> {
    return this.entities.filter(e => e.entity_type === 'partner').map(e => this.convertToPartner(e));
  }

  async getDecisions(): Promise<Decision[]> {
    return this.entities.filter(e => e.entity_type === 'decision').map(e => this.convertToDecision(e));
  }

  async getGlossaryTerms(): Promise<GlossaryTerm[]> {
    return this.entities.filter(e => e.entity_type === 'glossary_term').map(e => this.convertToGlossaryTerm(e));
  }

  async getDocuments(): Promise<Document[]> {
    return this.entities.filter(e => e.entity_type === 'document').map(e => this.convertToDocument(e));
  }

  async getExtensionTypeRegistrations(): Promise<EntityTypeRegistration[]> {
    return getExtensionRegistrations();
  }

  async getExtensionEntities(type: string): Promise<ExtensionEntity[]> {
    const publicType = getPublicType(getStorageType(type));
    if (!EXTENSION_ENTITY_TYPE_SET.has(publicType)) {
      return [];
    }
    return this.entities.filter(e => e.entity_type === publicType).map(e => this.convertToExtensionEntity(e));
  }

  async searchExtensionEntities(type: string, query: string, limit = 500): Promise<ExtensionEntity[]> {
    const publicType = getPublicType(getStorageType(type));
    if (!EXTENSION_ENTITY_TYPE_SET.has(publicType) || !query.trim()) {
      return [];
    }
    const token = await this.tokenManager.getToken({ timeoutMs: this.tokenRefreshTimeoutMs });
    const params = new URLSearchParams({
      type: getStorageType(type),
      query: query.trim(),
      limit: String(Math.min(Math.max(limit, 1), 500)),
    });
    const response = await this.fetchWithRetry(
      `${this.apiUrl}/api/info/graph/entities?${params.toString()}`,
      token,
    );
    if (!response.ok) {
      throw new Error(`Failed to search ${type} entities: ${response.status}`);
    }
    const data = await response.json() as Record<string, unknown>;
    return this.recordsFromResponse(data, type)
      .map(record => ({
        ...record,
        entity_id: record.entity_id || (record as unknown as Record<string, unknown>).id as string,
        entity_type: publicType,
      }))
      .map(record => this.convertToExtensionEntity(record));
  }

  async getPhilosophyContext(request: PhilosophyContextRequest): Promise<PhilosophyContext> {
    const token = await this.tokenManager.getToken({ timeoutMs: this.tokenRefreshTimeoutMs });
    const params = new URLSearchParams({
      project: request.projectCode,
      types: 'project',
      includePhilosophy: 'true',
    });
    if (request.scope) params.set('scope', request.scope);
    if (request.objectType) params.set('objectType', request.objectType);
    if (request.operation) params.set('operation', request.operation);
    if (request.maxRecommended !== undefined) params.set('maxRecommended', String(request.maxRecommended));

    const response = await this.fetchWithRetry(`${this.apiUrl}/api/info/context?${params.toString()}`, token);
    if (!response.ok) {
      throw new Error(`Failed to fetch philosophy context: ${response.status}`);
    }
    const data = await response.json() as { philosophy_context?: PhilosophyContext };
    if (!data.philosophy_context?.prompt_block) {
      throw new Error('Philosophy context is missing from Graph API response');
    }
    return data.philosophy_context;
  }

  /** Convert one authenticated API row with the same presentation as the snapshot index. */
  convertEntity(entity: GraphEntity) {
    const publicEntity = { ...entity, entity_type: getPublicType(entity.entity_type) };
    switch (publicEntity.entity_type) {
      case 'project': return this.convertToProject(publicEntity);
      case 'person': return this.convertToPerson(publicEntity);
      case 'org': return this.convertToOrg(publicEntity);
      case 'brand': return this.convertToBrand(publicEntity);
      case 'raci': return this.convertToRACI(publicEntity);
      case 'app': return this.convertToApp(publicEntity);
      case 'customer': return this.convertToCustomer(publicEntity);
      case 'partner': return this.convertToPartner(publicEntity);
      case 'decision': return this.convertToDecision(publicEntity);
      case 'glossary_term': return this.convertToGlossaryTerm(publicEntity);
      case 'document': return this.convertToDocument(publicEntity);
      default: return this.convertToExtensionEntity(publicEntity);
    }
  }

  private convertToProject(entity: GraphEntity): Project {
    const payload = entity.payload;
    return {
      id: (payload.code as string) || entity.entity_id,
      filePath: `[Graph API: ${entity.entity_id}]`,
      type: 'project',
      project_id: (payload.code as string) || entity.entity_id,
      name: (payload.name as string) || '',
      aliases: this.ensureArray(payload.aliases),
      status: (payload.status as string) || 'active',
      team: this.ensureArray(payload.team),
      orgs: this.ensureArray(payload.orgs),
      apps: this.ensureArray(payload.apps),
      customers: this.ensureArray(payload.customers),
      content: this.contentFromPayload(payload),
      retrieval_evidence: extractEvidence(payload),
      beta_partners: payload.beta_partners as number | undefined,
      updated: entity.updated_at,
      ...graphMetadata(entity),
    };
  }

  private convertToPerson(entity: GraphEntity): Person {
    const payload = entity.payload;
    return {
      id: entity.entity_id,
      filePath: `[Graph API: ${entity.entity_id}]`,
      type: 'person',
      name: (payload.name as string) || '',
      role: (payload.role as string) || '',
      org: (payload.org as string) || '',
      org_tags: this.ensureArray(payload.org_tags),
      projects: this.ensureArray(payload.projects),
      aliases: this.ensureArray(payload.aliases),
      status: (payload.status as string) || 'active',
      content: (payload.bio as string) || this.contentFromPayload(payload),
      updated: entity.updated_at,
      ...graphMetadata(entity),
    };
  }

  private convertToOrg(entity: GraphEntity): Organization {
    const payload = entity.payload;
    return {
      id: (payload.org_id as string) || entity.entity_id,
      filePath: `[Graph API: ${entity.entity_id}]`,
      type: 'org',
      org_id: (payload.org_id as string) || entity.entity_id,
      name: (payload.name as string) || '',
      aliases: this.ensureArray(payload.aliases),
      orgType: (payload.type as string) || 'unknown',
      content: this.contentFromPayload(payload),
      retrieval_evidence: extractEvidence(payload),
      updated: entity.updated_at,
      ...graphMetadata(entity),
    };
  }

  private convertToBrand(entity: GraphEntity): Brand {
    const payload = entity.payload;
    return {
      id: entity.entity_id,
      filePath: `[Graph API: ${entity.entity_id}]`,
      type: 'brand',
      name: (payload.name as string) || (payload.title as string) || entity.entity_id,
      scope: payload.scope as Brand['scope'],
      owner_entity_id: (payload.owner_entity_id as string) || undefined,
      related_orgs: this.ensureArray(payload.related_orgs ?? payload.orgs),
      related_apps: this.ensureArray(payload.related_apps ?? payload.apps),
      tagline: (payload.tagline as string) || undefined,
      positioning: (payload.positioning as string) || undefined,
      voice: (payload.voice as string | string[]) || undefined,
      do: this.ensureArray(payload.do),
      dont: this.ensureArray(payload.dont),
      visual_assets: this.ensureArray(payload.visual_assets),
      aliases: this.ensureArray(payload.aliases),
      content: this.contentFromPayload(payload),
      retrieval_evidence: extractEvidence(payload),
      updated: entity.updated_at,
      ...graphMetadata(entity),
    };
  }

  private convertToRACI(entity: GraphEntity): RACI {
    const payload = entity.payload;
    const positions: PositionEntry[] = [];
    for (const pos of (Array.isArray(payload.positions) ? payload.positions : []) as Array<Record<string, unknown>>) {
      positions.push({ person: (pos.person as string) || '', assets: (pos.assets as string) || '', authority: (pos.authority as string) || '' });
    }
    const decisions: DecisionEntry[] = [];
    for (const dec of (Array.isArray(payload.decisions) ? payload.decisions : []) as Array<Record<string, unknown>>) {
      decisions.push({ domain: (dec.domain as string) || '', decider: (dec.decider as string) || '' });
    }
    const assignments: AssignmentEntry[] = [];
    for (const assign of (Array.isArray(payload.assignments) ? payload.assignments : []) as Array<Record<string, unknown>>) {
      assignments.push({ person: (assign.person as string) || '', areas: (assign.areas as string) || '' });
    }
    return {
      id: (payload.org_id as string) || entity.entity_id,
      filePath: `[Graph API: ${entity.entity_id}]`,
      type: 'raci',
      org_id: (payload.org_id as string) || entity.entity_id,
      name: (payload.name as string) || '',
      members: this.ensureArray(payload.members),
      positions,
      decisions,
      assignments,
      products: this.ensureArray(payload.products),
      content: this.contentFromPayload(payload),
      retrieval_evidence: extractEvidence(payload),
      updated: entity.updated_at,
      ...graphMetadata(entity),
    };
  }

  private convertToApp(entity: GraphEntity): App {
    const payload = entity.payload;
    const projects = publicProfileArray(payload.projects);
    const project = publicProfileString(payload.project) || projects?.[0] || '';
    const summary = publicProfileString(payload.summary);
    const repository = projectRepository(payload.repository);
    const parentProject = publicProfileString(payload.parent_project);
    const parentProjectEntityId = publicProfileString(payload.parent_project_entity_id);
    const environments = projectEnvironments(payload.environments);
    const recordClass = publicProfileString(payload.record_class);
    const serviceProfileEligible = typeof payload.service_profile_eligible === 'boolean'
      ? payload.service_profile_eligible
      : undefined;
    const profileFields: Record<string, unknown> = {
      summary,
      projects,
      repository,
      parent_project: parentProject,
      parent_project_entity_id: parentProjectEntityId,
      environments,
      record_class: recordClass,
      service_profile_eligible: serviceProfileEligible,
    };
    const operationalProfileCoverage: AppOperationalProfileCoverage = {
      available_fields: Object.entries(profileFields)
        .filter(([, value]) => value !== undefined)
        .map(([field]) => field),
      omitted_fields: Object.entries(profileFields)
        .filter(([, value]) => value === undefined)
        .map(([field]) => field),
    };
    return {
      id: (payload.app_id as string) || entity.entity_id,
      filePath: `[Graph API: ${entity.entity_id}]`,
      type: 'app',
      app_id: (payload.app_id as string) || entity.entity_id,
      name: (payload.name as string) || '',
      project,
      orgs: publicProfileArray(payload.orgs) || [],
      status: (payload.status as string) || '',
      description: boundedString(payload.description) || '',
      summary,
      projects,
      repository,
      parent_project: parentProject,
      parent_project_entity_id: parentProjectEntityId,
      environments,
      record_class: recordClass,
      service_profile_eligible: serviceProfileEligible,
      operational_profile_coverage: operationalProfileCoverage,
      updated: entity.updated_at,
      ...graphMetadata(entity),
    };
  }

  private convertToCustomer(entity: GraphEntity): Customer {
    const payload = entity.payload;
    return {
      id: (payload.customer_id as string) || entity.entity_id,
      filePath: `[Graph API: ${entity.entity_id}]`,
      type: 'customer',
      customer_id: (payload.customer_id as string) || entity.entity_id,
      name: (payload.name as string) || '',
      salesOrg: (payload.salesOrg as string) || '',
      implOrg: (payload.implOrg as string) || '',
      project: (payload.project as string) || '',
      contractType: (payload.contractType as string) || '',
      upfront: (payload.upfront as string) || '',
      status: (payload.status as string) || '',
      notes: (payload.notes as string) || '',
      updated: entity.updated_at,
      ...graphMetadata(entity),
    };
  }

  private convertToPartner(entity: GraphEntity): Partner {
    const payload = entity.payload;
    return {
      id: entity.entity_id,
      filePath: `[Graph API: ${entity.entity_id}]`,
      type: 'partner',
      name: (payload.name as string) || (payload.company as string) || entity.entity_id,
      status: (payload.status as string) || '',
      org: (payload.org as string) || '',
      projects: this.ensureArray(payload.projects),
      aliases: this.ensureArray(payload.aliases),
      content: this.contentFromPayload(payload),
      retrieval_evidence: extractEvidence(payload),
      updated: entity.updated_at,
      ...graphMetadata(entity),
    };
  }

  private convertToDecision(entity: GraphEntity): Decision {
    const payload = entity.payload;
    return {
      id: (payload.decision_id as string) || entity.entity_id,
      filePath: `[Graph API: ${entity.entity_id}]`,
      type: 'decision',
      decision_id: (payload.decision_id as string) || entity.entity_id,
      title: (payload.title as string) || '',
      content: this.contentFromPayload(payload),
      retrieval_evidence: extractEvidence(payload),
      decided_at: (payload.decided_at as string) || '',
      decider: (payload.decider as string) || '',
      project_id: (payload.project_id as string) || undefined,
      meeting_id: (payload.meeting_id as string) || undefined,
      status: (payload.status as string) || 'active',
      tags: this.ensureArray(payload.tags),
      updated: entity.updated_at,
      ...graphMetadata(entity),
    };
  }

  private convertToGlossaryTerm(entity: GraphEntity): GlossaryTerm {
    const payload = entity.payload;
    const term = (payload.term as string) || (payload.name as string) || entity.entity_id;
    return {
      id: entity.entity_id,
      filePath: `[Graph API: ${entity.entity_id}]`,
      type: 'glossary_term',
      term,
      name: term,
      canonical: (payload.canonical as string) || undefined,
      aliases: this.ensureArray(payload.aliases),
      description: (payload.description as string) || '',
      content: this.contentFromPayload(payload),
      retrieval_evidence: extractEvidence(payload),
      updated: entity.updated_at,
      ...graphMetadata(entity),
    };
  }

  private convertToDocument(entity: GraphEntity): Document {
    const payload = entity.payload;
    const title = (payload.title as string) || (payload.name as string) || entity.entity_id;
    return {
      id: entity.entity_id,
      filePath: `[Graph API: ${entity.entity_id}]`,
      type: 'document',
      title,
      name: title,
      path: (payload.path as string) || (payload.source_path as string) || undefined,
      tags: this.ensureArray(payload.tags),
      content: this.contentFromPayload(payload),
      retrieval_evidence: extractEvidence(payload),
      updated: entity.updated_at,
      ...graphMetadata(entity),
    };
  }

  private convertToExtensionEntity(entity: GraphEntity): ExtensionEntity {
    const payload = entity.payload;
    const title = (payload.title as string) || (payload.name as string) || (payload.term as string) || entity.entity_id;
    return {
      id: entity.entity_id,
      filePath: `[Graph API: ${entity.entity_id}]`,
      type: entity.entity_type,
      name: title,
      title,
      status: typeof payload.status === 'string' ? payload.status : undefined,
      payload,
      content: this.contentFromPayload(payload),
      retrieval_evidence: extractEvidence(payload),
      updated: entity.updated_at,
      ...graphMetadata(entity),
    };
  }

  private contentFromPayload(payload: Record<string, unknown>): string {
    for (const field of ['content', 'markdown', 'body_summary', 'summary', 'description', 'notes', 'statement', 'decision', 'body', 'rationale']) {
      const value = payload[field];
      if (hasSubstantiveValue(value)) return typeof value === 'string' ? value : JSON.stringify(value);
    }
    return '';
  }

  private ensureArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter(v => typeof v === 'string') as string[];
    }
    if (typeof value === 'string' && value.trim()) {
      return value.split(',').map(s => s.trim());
    }
    return [];
  }
}
