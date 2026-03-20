/**
 * Graph API Source
 * Loads entities from Graph SSOT API
 */

import type { EntitySource } from './entity-source.js';
import type {
  Project,
  Person,
  Organization,
  RACI,
  App,
  Customer,
  Decision,
  PositionEntry,
  DecisionEntry,
  AssignmentEntry,
} from '../indexer/types.js';
import { TokenManager } from '../auth/token-manager.js';

/**
 * Graph API Entity Response
 */
interface GraphEntity {
  entity_id: string;
  entity_type: string;
  payload: Record<string, unknown>;
  updated_at?: string;
}

/**
 * Graph API Response
 */
interface GraphEntitiesResponse {
  entities: GraphEntity[];
}

/**
 * GraphAPISource
 * Fetches entities from Graph SSOT API
 */
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

  /**
   * Initialize: Fetch all entities from Graph API
   */
  async initialize(): Promise<void> {
    console.error('[GraphAPISource] Fetching entities from Graph API...');

    const token = await this.tokenManager.getToken();
    const url = `${this.apiUrl}/api/info/graph/entities`;

    const response = await this.fetchWithRetry(url, token);

    if (!response.ok) {
      throw new Error(`Failed to fetch entities: ${response.status} ${response.statusText}`);
    }

    const data: GraphEntitiesResponse = await response.json();
    this.entities = data.entities;

    console.error(`[GraphAPISource] Loaded ${this.entities.length} entities from Graph API`);
  }

  /**
   * Fetch with retry on 401 (token expired)
   */
  private async fetchWithRetry(url: string, token: string): Promise<Response> {
    let response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    // Retry on 401 (token expired)
    if (response.status === 401) {
      console.error('[GraphAPISource] Token expired, refreshing...');
      await this.tokenManager.refresh();
      const newToken = await this.tokenManager.getToken();

      response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${newToken}`,
          'Content-Type': 'application/json',
        },
      });
    }

    return response;
  }

  /**
   * Filter entities by project codes (if specified)
   */
  private filterByProjectCodes(entities: GraphEntity[]): GraphEntity[] {
    if (!this.projectCodes || this.projectCodes.length === 0) {
      return entities;
    }

    return entities.filter(entity => {
      if (entity.entity_type === 'project') {
        const projectCode = (entity.payload.code as string) || '';
        return this.projectCodes!.includes(projectCode);
      }
      // For non-project entities, include all for now
      // (In the future, we could filter by related projects)
      return true;
    });
  }

  /**
   * Get all projects
   */
  async getProjects(): Promise<Project[]> {
    const projectEntities = this.entities.filter(e => e.entity_type === 'project');
    const filtered = this.filterByProjectCodes(projectEntities);

    return filtered.map(e => this.convertToProject(e));
  }

  /**
   * Get all people
   */
  async getPeople(): Promise<Person[]> {
    const peopleEntities = this.entities.filter(e => e.entity_type === 'person');
    return peopleEntities.map(e => this.convertToPerson(e));
  }

  /**
   * Get all organizations
   */
  async getOrganizations(): Promise<Organization[]> {
    const orgEntities = this.entities.filter(e => e.entity_type === 'org');
    return orgEntities.map(e => this.convertToOrg(e));
  }

  /**
   * Get all RACI definitions
   */
  async getRACIs(): Promise<RACI[]> {
    const raciEntities = this.entities.filter(e => e.entity_type === 'raci');
    return raciEntities.map(e => this.convertToRACI(e));
  }

  /**
   * Get all apps
   */
  async getApps(): Promise<App[]> {
    const appEntities = this.entities.filter(e => e.entity_type === 'app');
    return appEntities.map(e => this.convertToApp(e));
  }

  /**
   * Get all customers
   */
  async getCustomers(): Promise<Customer[]> {
    const customerEntities = this.entities.filter(e => e.entity_type === 'customer');
    return customerEntities.map(e => this.convertToCustomer(e));
  }

  /**
   * Get all decisions
   */
  async getDecisions(): Promise<Decision[]> {
    const decisionEntities = this.entities.filter(e => e.entity_type === 'decision');
    return decisionEntities.map(e => this.convertToDecision(e));
  }

  /**
   * Convert Graph Entity to Project
   */
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
      content: (payload.description as string) || '',
      beta_partners: payload.beta_partners as number | undefined,
      updated: entity.updated_at,
    };
  }

  /**
   * Convert Graph Entity to Person
   */
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
      content: (payload.bio as string) || '',
      updated: entity.updated_at,
    };
  }

  /**
   * Convert Graph Entity to Organization
   */
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
      content: (payload.description as string) || '',
      updated: entity.updated_at,
    };
  }

  /**
   * Convert Graph Entity to RACI
   */
  private convertToRACI(entity: GraphEntity): RACI {
    const payload = entity.payload;

    // Parse positions
    const positions: PositionEntry[] = [];
    const positionsData = payload.positions as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(positionsData)) {
      for (const pos of positionsData) {
        positions.push({
          person: (pos.person as string) || '',
          assets: (pos.assets as string) || '',
          authority: (pos.authority as string) || '',
        });
      }
    }

    // Parse decisions
    const decisions: DecisionEntry[] = [];
    const decisionsData = payload.decisions as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(decisionsData)) {
      for (const dec of decisionsData) {
        decisions.push({
          domain: (dec.domain as string) || '',
          decider: (dec.decider as string) || '',
        });
      }
    }

    // Parse assignments
    const assignments: AssignmentEntry[] = [];
    const assignmentsData = payload.assignments as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(assignmentsData)) {
      for (const assign of assignmentsData) {
        assignments.push({
          person: (assign.person as string) || '',
          areas: (assign.areas as string) || '',
        });
      }
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
      content: (payload.description as string) || '',
      updated: entity.updated_at,
    };
  }

  /**
   * Convert Graph Entity to App
   */
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
    };
  }

  /**
   * Convert Graph Entity to Customer
   */
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
    };
  }

  /**
   * Convert Graph Entity to Decision
   */
  private convertToDecision(entity: GraphEntity): Decision {
    const payload = entity.payload;
    return {
      id: (payload.decision_id as string) || entity.entity_id,
      filePath: `[Graph API: ${entity.entity_id}]`,
      type: 'decision',
      decision_id: (payload.decision_id as string) || entity.entity_id,
      title: (payload.title as string) || '',
      content: (payload.content as string) || (payload.description as string) || '',
      decided_at: (payload.decided_at as string) || '',
      decider: (payload.decider as string) || '',
      project_id: (payload.project_id as string) || undefined,
      meeting_id: (payload.meeting_id as string) || undefined,
      status: (payload.status as string) || 'active',
      tags: this.ensureArray(payload.tags),
      updated: entity.updated_at,
    };
  }

  /**
   * Ensure value is an array
   */
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
