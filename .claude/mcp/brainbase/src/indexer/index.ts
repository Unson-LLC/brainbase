/**
 * brainbase Entity Indexer
 * Scans _codex directory and builds entity index with alias mappings
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, basename } from 'path';
import { parseMarkdownFile, parseMarkdownString, ensureArray, extractIdFromPath } from './frontmatter.js';
import { parseAppsTable, parseCustomersTable, parseRACITable } from './table.js';
import type {
  EntityIndex,
  Project,
  Person,
  Organization,
  RACI,
  App,
  Customer,
  Entity,
  EntityType,
} from './types.js';

// Base path for _codex (will be configured)
let codexBasePath = '';

/**
 * Initialize the indexer with the codex base path
 */
export function setCodexBasePath(path: string): void {
  codexBasePath = path;
}

/**
 * Create an empty entity index
 */
function createEmptyIndex(): EntityIndex {
  return {
    projects: new Map(),
    people: new Map(),
    orgs: new Map(),
    raci: new Map(),
    apps: new Map(),
    customers: new Map(),
    aliasToPersonId: new Map(),
    aliasToOrgId: new Map(),
  };
}

/**
 * Scan a directory for markdown files
 */
async function scanDirectory(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const mdFiles: string[] = [];

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isFile() && entry.name.endsWith('.md')) {
        mdFiles.push(fullPath);
      } else if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subFiles = await scanDirectory(fullPath);
        mdFiles.push(...subFiles);
      }
    }

    return mdFiles;
  } catch {
    return [];
  }
}

/**
 * Index all projects from _codex/projects/{project_id}/project.md
 */
async function indexProjects(index: EntityIndex): Promise<void> {
  const projectsDir = join(codexBasePath, 'projects');
  const entries = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const projectFile = join(projectsDir, entry.name, 'project.md');
    try {
      await stat(projectFile);
      const parsed = await parseMarkdownFile<{
        project_id?: string;
        name?: string;
        status?: string;
        team?: string | string[];
        orgs?: string | string[];
        apps?: string | string[];
        customers?: string | string[];
        updated?: string;
        beta_partners?: number;
      }>(projectFile);

      const projectId = parsed.data.project_id || entry.name;
      const project: Project = {
        id: projectId,
        filePath: projectFile,
        type: 'project',
        project_id: projectId,
        name: parsed.data.name || entry.name,
        status: parsed.data.status || 'active',
        team: ensureArray(parsed.data.team),
        orgs: ensureArray(parsed.data.orgs),
        apps: ensureArray(parsed.data.apps),
        customers: ensureArray(parsed.data.customers),
        content: parsed.content,
        updated: parsed.data.updated,
        beta_partners: parsed.data.beta_partners,
      };

      index.projects.set(projectId, project);
    } catch {
      // Skip if project.md doesn't exist
    }
  }
}

/**
 * Index all people from _codex/common/meta/people/*.md
 */
async function indexPeople(index: EntityIndex): Promise<void> {
  const peopleDir = join(codexBasePath, 'common', 'meta', 'people');
  const files = await scanDirectory(peopleDir);

  for (const filePath of files) {
    const fileName = basename(filePath);
    if (fileName === 'README.md' || fileName === 'index.md') continue;

    try {
      const parsed = await parseMarkdownFile<{
        name?: string;
        role?: string;
        org?: string;
        org_tags?: string | string[];
        projects?: string | string[];
        aliases?: string | string[];
        status?: string;
        updated?: string;
      }>(filePath);

      const personId = extractIdFromPath(filePath);
      const person: Person = {
        id: personId,
        filePath,
        type: 'person',
        name: parsed.data.name || personId,
        role: parsed.data.role || '',
        org: parsed.data.org || '',
        org_tags: ensureArray(parsed.data.org_tags),
        projects: ensureArray(parsed.data.projects),
        aliases: ensureArray(parsed.data.aliases),
        status: parsed.data.status || 'active',
        content: parsed.content,
        updated: parsed.data.updated,
      };

      index.people.set(personId, person);

      // Build alias mappings
      // Map name -> personId
      if (person.name) {
        index.aliasToPersonId.set(person.name, personId);
        // Also map name without spaces (for Japanese names)
        const noSpace = person.name.replace(/\s+/g, '');
        if (noSpace !== person.name) {
          index.aliasToPersonId.set(noSpace, personId);
        }
      }
      // Map each alias -> personId
      for (const alias of person.aliases) {
        index.aliasToPersonId.set(alias, personId);
      }
    } catch {
      // Skip files that can't be parsed
    }
  }
}

/**
 * Index all organizations from _codex/orgs/*.md
 */
async function indexOrgs(index: EntityIndex): Promise<void> {
  const orgsDir = join(codexBasePath, 'orgs');
  const files = await scanDirectory(orgsDir);

  for (const filePath of files) {
    try {
      const parsed = await parseMarkdownFile<{
        org_id?: string;
        name?: string;
        aliases?: string | string[];
        type?: string;
        updated?: string;
      }>(filePath);

      const orgId = parsed.data.org_id || extractIdFromPath(filePath);
      const org: Organization = {
        id: orgId,
        filePath,
        type: 'org',
        org_id: orgId,
        name: parsed.data.name || orgId,
        aliases: ensureArray(parsed.data.aliases),
        orgType: parsed.data.type || 'unknown',
        content: parsed.content,
        updated: parsed.data.updated,
      };

      index.orgs.set(orgId, org);

      // Build alias mappings
      if (org.name) {
        index.aliasToOrgId.set(org.name, orgId);
      }
      for (const alias of org.aliases) {
        index.aliasToOrgId.set(alias, orgId);
      }
    } catch {
      // Skip files that can't be parsed
    }
  }
}

/**
 * Index all RACI definitions from _codex/common/meta/raci/*.md
 */
async function indexRACIs(index: EntityIndex): Promise<void> {
  const raciDir = join(codexBasePath, 'common', 'meta', 'raci');
  const files = await scanDirectory(raciDir);

  for (const filePath of files) {
    try {
      const content = await readFile(filePath, 'utf-8');
      const raciId = extractIdFromPath(filePath);

      // Parse frontmatter for project_id
      const parsed = parseMarkdownString<{
        project_id?: string;
        updated?: string;
      }>(content);

      // Parse RACI table from content
      const entries = parseRACITable(content);

      const raci: RACI = {
        id: raciId,
        filePath,
        type: 'raci',
        project_id: parsed.data.project_id || raciId,
        entries,
        content: parsed.content,
        updated: parsed.data.updated,
      };

      index.raci.set(raciId, raci);
    } catch {
      // Skip files that can't be parsed
    }
  }
}

/**
 * Index all apps from _codex/common/meta/apps.md (table format)
 */
async function indexApps(index: EntityIndex): Promise<void> {
  const appsFile = join(codexBasePath, 'common', 'meta', 'apps.md');

  try {
    const content = await readFile(appsFile, 'utf-8');
    const apps = parseAppsTable(content);

    for (const appData of apps) {
      if (!appData.app_id) continue;

      const app: App = {
        id: appData.app_id,
        filePath: appsFile,
        type: 'app',
        app_id: appData.app_id,
        name: appData.name,
        project: appData.project,
        orgs: appData.orgs,
        status: appData.status,
        description: appData.description,
      };

      index.apps.set(appData.app_id, app);
    }
  } catch {
    // apps.md doesn't exist or can't be parsed
  }
}

/**
 * Index all customers from _codex/common/meta/customers.md (table format)
 */
async function indexCustomers(index: EntityIndex): Promise<void> {
  const customersFile = join(codexBasePath, 'common', 'meta', 'customers.md');

  try {
    const content = await readFile(customersFile, 'utf-8');
    const customers = parseCustomersTable(content);

    for (const custData of customers) {
      if (!custData.customer_id) continue;

      const customer: Customer = {
        id: custData.customer_id,
        filePath: customersFile,
        type: 'customer',
        customer_id: custData.customer_id,
        name: custData.name,
        salesOrg: custData.salesOrg,
        implOrg: custData.implOrg,
        project: custData.project,
        contractType: custData.contractType,
        upfront: custData.upfront,
        status: custData.status,
        notes: custData.notes,
      };

      index.customers.set(custData.customer_id, customer);
    }
  } catch {
    // customers.md doesn't exist or can't be parsed
  }
}

/**
 * Build the complete entity index
 */
export async function buildIndex(): Promise<EntityIndex> {
  const index = createEmptyIndex();

  // Index all entity types in parallel
  await Promise.all([
    indexProjects(index),
    indexPeople(index),
    indexOrgs(index),
    indexRACIs(index),
    indexApps(index),
    indexCustomers(index),
  ]);

  return index;
}

/**
 * Resolve a person name to their ID using alias mappings
 */
export function resolvePersonId(index: EntityIndex, nameOrAlias: string): string | undefined {
  // Direct lookup first
  if (index.people.has(nameOrAlias)) {
    return nameOrAlias;
  }
  // Try alias mapping
  return index.aliasToPersonId.get(nameOrAlias);
}

/**
 * Resolve an org name to its ID using alias mappings
 */
export function resolveOrgId(index: EntityIndex, nameOrAlias: string): string | undefined {
  // Direct lookup first
  if (index.orgs.has(nameOrAlias)) {
    return nameOrAlias;
  }
  // Try alias mapping
  return index.aliasToOrgId.get(nameOrAlias);
}

/**
 * Get all entities of a specific type
 */
export function getEntitiesByType(index: EntityIndex, type: EntityType): Entity[] {
  switch (type) {
    case 'project':
      return Array.from(index.projects.values());
    case 'person':
      return Array.from(index.people.values());
    case 'org':
      return Array.from(index.orgs.values());
    case 'raci':
      return Array.from(index.raci.values());
    case 'app':
      return Array.from(index.apps.values());
    case 'customer':
      return Array.from(index.customers.values());
    default:
      return [];
  }
}

/**
 * Get an entity by type and ID
 */
export function getEntity(index: EntityIndex, type: EntityType, id: string): Entity | undefined {
  switch (type) {
    case 'project':
      return index.projects.get(id);
    case 'person':
      return index.people.get(id) || index.people.get(resolvePersonId(index, id) || '');
    case 'org':
      return index.orgs.get(id) || index.orgs.get(resolveOrgId(index, id) || '');
    case 'raci':
      return index.raci.get(id);
    case 'app':
      return index.apps.get(id);
    case 'customer':
      return index.customers.get(id);
    default:
      return undefined;
  }
}

/**
 * Search entities by keyword in content and names
 */
export function searchEntities(index: EntityIndex, query: string): Entity[] {
  const results: Entity[] = [];
  const lowerQuery = query.toLowerCase();

  // Search all entity types
  const allEntities: Entity[] = [
    ...index.projects.values(),
    ...index.people.values(),
    ...index.orgs.values(),
    ...index.raci.values(),
    ...index.apps.values(),
    ...index.customers.values(),
  ];

  for (const entity of allEntities) {
    // Check name/title
    const name = 'name' in entity ? entity.name : entity.id;
    if (name.toLowerCase().includes(lowerQuery)) {
      results.push(entity);
      continue;
    }

    // Check content
    if ('content' in entity && entity.content.toLowerCase().includes(lowerQuery)) {
      results.push(entity);
      continue;
    }

    // Check aliases for person/org
    if ('aliases' in entity) {
      const aliases = entity.aliases as string[];
      if (aliases.some(alias => alias.toLowerCase().includes(lowerQuery))) {
        results.push(entity);
        continue;
      }
    }

    // Check description for apps
    if (entity.type === 'app' && entity.description.toLowerCase().includes(lowerQuery)) {
      results.push(entity);
    }
  }

  return results;
}

/**
 * Get context for a specific topic/entity
 * Returns relevant entities and their relationships
 */
export function getContextForTopic(index: EntityIndex, topic: string): {
  primary: Entity | undefined;
  related: Entity[];
} {
  // Try to find the primary entity
  let primary: Entity | undefined;
  const related: Entity[] = [];

  // Search across entity types
  const lowerTopic = topic.toLowerCase();

  // Check projects
  for (const project of index.projects.values()) {
    if (project.project_id.toLowerCase() === lowerTopic ||
        project.name.toLowerCase().includes(lowerTopic)) {
      primary = project;
      break;
    }
  }

  // Check people
  if (!primary) {
    const personId = resolvePersonId(index, topic);
    if (personId) {
      primary = index.people.get(personId);
    }
  }

  // Check orgs
  if (!primary) {
    const orgId = resolveOrgId(index, topic);
    if (orgId) {
      primary = index.orgs.get(orgId);
    }
  }

  // If we found a primary, gather related entities
  if (primary) {
    if (primary.type === 'project') {
      // Get team members
      for (const memberName of primary.team) {
        const personId = resolvePersonId(index, memberName);
        if (personId) {
          const person = index.people.get(personId);
          if (person) related.push(person);
        }
      }
      // Get related orgs
      for (const orgTag of primary.orgs) {
        const orgId = resolveOrgId(index, orgTag);
        if (orgId) {
          const org = index.orgs.get(orgId);
          if (org) related.push(org);
        }
      }
      // Get RACI
      const raci = index.raci.get(primary.project_id);
      if (raci) related.push(raci);
    } else if (primary.type === 'person') {
      // Get person's projects
      for (const projectId of primary.projects) {
        const project = index.projects.get(projectId);
        if (project) related.push(project);
      }
      // Get person's orgs
      for (const orgTag of primary.org_tags) {
        const orgId = resolveOrgId(index, orgTag);
        if (orgId) {
          const org = index.orgs.get(orgId);
          if (org) related.push(org);
        }
      }
    } else if (primary.type === 'org') {
      // Get projects associated with this org
      for (const project of index.projects.values()) {
        if (project.orgs.includes(primary.org_id)) {
          related.push(project);
        }
      }
      // Get people in this org
      for (const person of index.people.values()) {
        if (person.org_tags.includes(primary.org_id)) {
          related.push(person);
        }
      }
    }
  }

  return { primary, related };
}

// Export types
export type { EntityIndex, Entity, EntityType } from './types.js';
