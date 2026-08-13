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
} from '../indexer/types.js';
import { TokenManager } from '../auth/token-manager.js';
import {
  EXTENSION_ENTITY_TYPE_SET,
  getExtensionRegistrations,
  getGraphFetchTypes,
  getPublicType,
  getStorageType,
  type EntityTypeRegistration,
} from '../indexer/ontology.js';

export interface GraphEntity {
  entity_id: string;
  entity_type: string;
  payload: Record<string, unknown>;
  project_code?: string;
  updated_at?: string;
}

export const GRAPH_ALIAS_TYPES = ['org_alias', 'person_alias'] as const;

export function mergeGraphAliasPointers(canonicalEntities: GraphEntity[], aliasEntities: GraphEntity[]): GraphEntity[] {
  const canonicalById = new Map(canonicalEntities.map(entity => [entity.entity_id, entity]));
  for (const alias of aliasEntities) {
    const canonicalId = alias.payload.canonical_entity_id;
    const canonicalType = alias.entity_type === 'org_alias' ? 'org' : alias.entity_type === 'person_alias' ? 'person' : null;
    if (typeof canonicalId !== 'string' || !canonicalType) continue;
    const canonical = canonicalById.get(canonicalId);
    if (!canonical || canonical.entity_type !== canonicalType) continue;
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

function graphMetadata(entity: GraphEntity): {
  project_code?: string;
  source?: string;
  source_path?: string;
  legacy_source_path?: string;
} {
  return {
    project_code: entity.project_code,
    source: entity.payload.source as string | undefined,
    source_path: entity.payload.source_path as string | undefined,
    legacy_source_path: entity.payload.legacy_source_path as string | undefined,
  };
}

export class GraphAPISource implements EntitySource {
  private apiUrl: string;
  private tokenManager: TokenManager;
  private projectCodes?: string[];
  private entities: GraphEntity[] = [];

  constructor(apiUrl: string, tokenManager: TokenManager, projectCodes?: string[]) {
    this.apiUrl = apiUrl;
    this.tokenManager = tokenManager;
    this.projectCodes = projectCodes;
  }

  async initialize(): Promise<void> {
    console.error('[GraphAPISource] Fetching entities from Graph API...');

    const token = await this.tokenManager.getToken();
    const baseUrl = `${this.apiUrl}/api/info/graph/entities`;
    const allEntities: GraphEntity[] = [];

    for (const type of getGraphFetchTypes()) {
      const response = await this.fetchWithRetry(`${baseUrl}?type=${type}&limit=500`, token);

      if (!response.ok) {
        console.error(`[GraphAPISource] Failed to fetch ${type}: ${response.status}`);
        continue;
      }

      const data = await response.json() as Record<string, unknown>;
      const records = ((data.entities || data.records || []) as GraphEntity[]).map(r => {
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
      const response = await this.fetchWithRetry(`${baseUrl}?type=${type}&limit=500`, token);
      if (!response.ok) {
        console.error(`[GraphAPISource] Failed to fetch ${type}: ${response.status}`);
        continue;
      }
      const data = await response.json() as Record<string, unknown>;
      const records = ((data.entities || data.records || []) as GraphEntity[]).map(r => {
        const raw = r as unknown as Record<string, unknown>;
        return {
          ...r,
          entity_id: r.entity_id || raw.id as string,
          entity_type: r.entity_type || type,
        };
      });
      aliasEntities.push(...records);
    }

    this.entities = mergeGraphAliasPointers(allEntities, aliasEntities);
    console.error(`[GraphAPISource] Loaded ${this.entities.length} entities from Graph API`);
  }

  private async fetchWithRetry(url: string, token: string): Promise<Response> {
    let response = await fetch(url, {
      headers: this.buildHeaders(token),
    });

    if (response.status === 401) {
      console.error('[GraphAPISource] Token expired, refreshing...');
      await this.tokenManager.refresh();
      const newToken = await this.tokenManager.getToken();
      response = await fetch(url, {
        headers: this.buildHeaders(newToken),
      });
    }

    return response;
  }

  private buildHeaders(token: string): Record<string, string> {
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-brainbase-role': process.env.BRAINBASE_ROLE || 'gm',
      'x-brainbase-projects': this.projectCodes?.join(',') || process.env.BRAINBASE_PROJECTS || 'brainbase',
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
    const token = await this.tokenManager.getToken();
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
    return ((data.entities || data.records || []) as GraphEntity[])
      .map(record => ({
        ...record,
        entity_id: record.entity_id || (record as unknown as Record<string, unknown>).id as string,
        entity_type: publicType,
      }))
      .map(record => this.convertToExtensionEntity(record));
  }

  async getPhilosophyContext(request: PhilosophyContextRequest): Promise<PhilosophyContext> {
    const token = await this.tokenManager.getToken();
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

  private convertToProject(entity: GraphEntity): Project {
    const payload = entity.payload;
    return {
      id: (payload.code as string) || entity.entity_id,
      filePath: `[Graph API: ${entity.entity_id}]`,
      type: 'project',
      project_id: (payload.code as string) || entity.entity_id,
      name: (payload.name as string) || '',
      status: (payload.status as string) || 'active',
      team: this.ensureArray(payload.team),
      orgs: this.ensureArray(payload.orgs),
      apps: this.ensureArray(payload.apps),
      customers: this.ensureArray(payload.customers),
      content: this.contentFromPayload(payload),
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
      updated: entity.updated_at,
      ...graphMetadata(entity),
    };
  }

  private convertToApp(entity: GraphEntity): App {
    const payload = entity.payload;
    return {
      id: (payload.app_id as string) || entity.entity_id,
      filePath: `[Graph API: ${entity.entity_id}]`,
      type: 'app',
      app_id: (payload.app_id as string) || entity.entity_id,
      name: (payload.name as string) || '',
      project: (payload.project as string) || '',
      orgs: this.ensureArray(payload.orgs),
      status: (payload.status as string) || '',
      description: (payload.description as string) || '',
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
      project_code: entity.project_code,
      updated: entity.updated_at,
    };
  }

  private contentFromPayload(payload: Record<string, unknown>): string {
    return (
      (payload.content as string) ||
      (payload.markdown as string) ||
      (payload.body_summary as string) ||
      (payload.summary as string) ||
      (payload.description as string) ||
      (payload.notes as string) ||
      ''
    );
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
