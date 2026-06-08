/**
 * Hybrid Source
 * Prioritizes Graph API, falls back to filesystem on failure
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
} from '../indexer/types.js';
import type { EntityTypeRegistration } from '../indexer/ontology.js';

/**
 * HybridSource
 * API-first with filesystem fallback
 */
export class HybridSource implements EntitySource {
  private apiSource: EntitySource;
  private fsSource: EntitySource;
  private useApi: boolean = true;

  constructor(apiSource: EntitySource, fsSource: EntitySource) {
    this.apiSource = apiSource;
    this.fsSource = fsSource;
  }

  /**
   * Initialize both sources
   */
  async initialize(): Promise<void> {
    console.error('[HybridSource] Initializing hybrid source (API-first with FS fallback)');

    // Try API first
    try {
      await this.apiSource.initialize();
      console.error('[HybridSource] API source initialized successfully');
      this.useApi = true;
    } catch (error) {
      console.error('[HybridSource] API source failed, falling back to filesystem:', error);
      this.useApi = false;

      // Fall back to filesystem
      await this.fsSource.initialize();
      console.error('[HybridSource] Filesystem source initialized successfully');
    }
  }

  /**
   * Get all projects
   */
  async getProjects(): Promise<Project[]> {
    return this.executeWithFallback(() => this.apiSource.getProjects(), () => this.fsSource.getProjects());
  }

  /**
   * Get all people
   */
  async getPeople(): Promise<Person[]> {
    return this.executeWithFallback(() => this.apiSource.getPeople(), () => this.fsSource.getPeople());
  }

  /**
   * Get all organizations
   */
  async getOrganizations(): Promise<Organization[]> {
    return this.executeWithFallback(() => this.apiSource.getOrganizations(), () => this.fsSource.getOrganizations());
  }

  async getBrands(): Promise<Brand[]> {
    return this.executeWithFallback(() => this.apiSource.getBrands(), () => this.fsSource.getBrands());
  }

  /**
   * Get all RACI definitions
   */
  async getRACIs(): Promise<RACI[]> {
    return this.executeWithFallback(() => this.apiSource.getRACIs(), () => this.fsSource.getRACIs());
  }

  /**
   * Get all apps
   */
  async getApps(): Promise<App[]> {
    return this.executeWithFallback(() => this.apiSource.getApps(), () => this.fsSource.getApps());
  }

  /**
   * Get all customers
   */
  async getCustomers(): Promise<Customer[]> {
    return this.executeWithFallback(() => this.apiSource.getCustomers(), () => this.fsSource.getCustomers());
  }

  async getPartners(): Promise<Partner[]> {
    return this.executeWithFallback(() => this.apiSource.getPartners(), () => this.fsSource.getPartners());
  }

  /**
   * Get all decisions
   */
  async getDecisions(): Promise<Decision[]> {
    return this.executeWithFallback(() => this.apiSource.getDecisions(), () => this.fsSource.getDecisions());
  }

  async getGlossaryTerms(): Promise<GlossaryTerm[]> {
    return this.executeWithFallback(() => this.apiSource.getGlossaryTerms(), () => this.fsSource.getGlossaryTerms());
  }

  async getDocuments(): Promise<Document[]> {
    return this.executeWithFallback(() => this.apiSource.getDocuments(), () => this.fsSource.getDocuments());
  }

  async getExtensionTypeRegistrations(): Promise<EntityTypeRegistration[]> {
    return this.executeWithFallback(
      () => this.apiSource.getExtensionTypeRegistrations(),
      () => this.fsSource.getExtensionTypeRegistrations()
    );
  }

  async getExtensionEntities(type: string): Promise<ExtensionEntity[]> {
    return this.executeWithFallback(
      () => this.apiSource.getExtensionEntities(type),
      () => this.fsSource.getExtensionEntities(type)
    );
  }

  /**
   * Execute with fallback
   */
  private async executeWithFallback<T>(apiCall: () => Promise<T>, fsCall: () => Promise<T>): Promise<T> {
    if (this.useApi) {
      try {
        return await apiCall();
      } catch (error) {
        console.error('[HybridSource] API call failed, falling back to filesystem:', error);
        this.useApi = false;
        return await fsCall();
      }
    } else {
      return await fsCall();
    }
  }
}
