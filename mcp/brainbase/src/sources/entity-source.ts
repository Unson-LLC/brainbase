/**
 * Entity Source Interface
 * Abstraction for loading entities from different sources (filesystem, API, etc.)
 */

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
 * EntitySource interface
 * Defines how to load entities from a data source
 */
export interface EntitySource {
  /**
   * Initialize the source (if needed)
   */
  initialize(): Promise<void>;

  /**
   * Get all projects
   */
  getProjects(): Promise<Project[]>;

  /**
   * Get all people
   */
  getPeople(): Promise<Person[]>;

  /**
   * Get all organizations
   */
  getOrganizations(): Promise<Organization[]>;

  getBrands(): Promise<Brand[]>;

  /**
   * Get all RACI definitions
   */
  getRACIs(): Promise<RACI[]>;

  /**
   * Get all apps
   */
  getApps(): Promise<App[]>;

  /**
   * Get all customers
   */
  getCustomers(): Promise<Customer[]>;

  getPartners(): Promise<Partner[]>;

  /**
   * Get all decisions
   */
  getDecisions(): Promise<Decision[]>;

  getGlossaryTerms(): Promise<GlossaryTerm[]>;

  getDocuments(): Promise<Document[]>;

  getExtensionTypeRegistrations(): Promise<EntityTypeRegistration[]>;

  getExtensionEntities(type: string): Promise<ExtensionEntity[]>;
}
