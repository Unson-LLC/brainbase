/**
 * brainbase Entity Type Definitions
 */

// Base entity interface
export interface BaseEntity {
  id: string;
  filePath: string;
  updated?: string;
}

// Project entity from projects/*/project.md
export interface Project extends BaseEntity {
  type: 'project';
  project_id: string;
  name: string;
  status: 'active' | 'paused' | 'archived' | string;
  team: string[];      // Names (will be resolved to Person IDs)
  orgs: string[];      // Org tags
  apps: string[];      // App IDs
  customers: string[]; // Customer IDs
  content: string;     // Full markdown content
  beta_partners?: number;
}

// Person entity from common/meta/people/*.md
export interface Person extends BaseEntity {
  type: 'person';
  name: string;
  role: string;
  org: string;         // Descriptive org string
  org_tags: string[];  // Org tags for linking
  projects: string[];  // Project IDs
  aliases: string[];   // Alternative names for matching
  status: 'active' | 'inactive' | 'stakeholder' | string;
  content: string;
}

// Organization entity from orgs/*.md
export interface Organization extends BaseEntity {
  type: 'org';
  org_id: string;
  name: string;
  aliases: string[];
  orgType: 'legal_entity' | 'brand' | 'internal' | 'partner' | string;
  content: string;
}

// RACI entity from common/meta/raci/*.md
export interface RACI extends BaseEntity {
  type: 'raci';
  project_id: string;
  entries: RACIEntry[];
  content: string;
}

export interface RACIEntry {
  item: string;
  responsible: string;   // R
  accountable: string;   // A
  consulted: string;     // C
  informed: string;      // I
}

// App entity from common/meta/apps.md (table format)
export interface App extends BaseEntity {
  type: 'app';
  app_id: string;
  name: string;
  project: string;     // Project path/ID
  orgs: string[];      // Org tags
  status: string;
  description: string;
}

// Customer entity from common/meta/customers.md (table format)
export interface Customer extends BaseEntity {
  type: 'customer';
  customer_id: string;
  name: string;
  salesOrg: string;    // 営業組織タグ
  implOrg: string;     // 実装組織タグ
  project: string;     // Project ID
  contractType: string;
  upfront: string;
  status: string;
  notes: string;
}

// Union type for all entities
export type Entity = Project | Person | Organization | RACI | App | Customer;
export type EntityType = 'project' | 'person' | 'org' | 'raci' | 'app' | 'customer';

// Index structure
export interface EntityIndex {
  projects: Map<string, Project>;
  people: Map<string, Person>;
  orgs: Map<string, Organization>;
  raci: Map<string, RACI>;
  apps: Map<string, App>;
  customers: Map<string, Customer>;

  // Alias mappings for name resolution
  aliasToPersonId: Map<string, string>;
  aliasToOrgId: Map<string, string>;
}

// Frontmatter parsing result
export interface ParsedFile<T> {
  data: Partial<T>;
  content: string;
}
