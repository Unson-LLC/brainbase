/**
 * brainbase Entity Indexer
 * Builds entity index from EntitySource (filesystem, API, or hybrid)
 */

import type { EntitySource } from '../sources/entity-source.js';
import type {
  EntityIndex,
  Entity,
  EntityType,
  ExtensionEntity,
} from './types.js';
import { getExtensionRegistrations, type EntityTypeRegistration } from './ontology.js';

/**
 * Create an empty entity index
 */
export function createEmptyIndex(): EntityIndex {
  return {
    projects: new Map(),
    people: new Map(),
    orgs: new Map(),
    brands: new Map(),
    raci: new Map(),
    apps: new Map(),
    customers: new Map(),
    partners: new Map(),
    decisions: new Map(),
    glossaryTerms: new Map(),
    documents: new Map(),
    extensions: new Map(),
    aliasToPersonId: new Map(),
    aliasToOrgId: new Map(),
    aliasToBrandId: new Map(),
  };
}

/**
 * Build alias mappings for people
 */
function buildPersonAliases(index: EntityIndex): void {
  for (const person of index.people.values()) {
    // Map name -> personId
    if (person.name) {
      index.aliasToPersonId.set(person.name, person.id);
      // Also map name without spaces (for Japanese names)
      const noSpace = person.name.replace(/\s+/g, '');
      if (noSpace !== person.name) {
        index.aliasToPersonId.set(noSpace, person.id);
      }
    }
    // Map each alias -> personId
    for (const alias of person.aliases) {
      index.aliasToPersonId.set(alias, person.id);
    }
  }
}

/**
 * Build alias mappings for orgs
 */
function buildOrgAliases(index: EntityIndex): void {
  for (const org of index.orgs.values()) {
    // Map name -> orgId
    if (org.name) {
      index.aliasToOrgId.set(org.name, org.org_id);
    }
    // Map each alias -> orgId
    for (const alias of org.aliases) {
      index.aliasToOrgId.set(alias, org.org_id);
    }
  }
}

function buildBrandAliases(index: EntityIndex): void {
  for (const brand of index.brands.values()) {
    if (brand.name) {
      index.aliasToBrandId.set(brand.name, brand.id);
    }
    for (const alias of brand.aliases) {
      index.aliasToBrandId.set(alias, brand.id);
    }
  }
}

/**
 * Build the complete entity index from EntitySource
 */
export async function buildIndex(source: EntitySource): Promise<EntityIndex> {
  const index = createEmptyIndex();

  // Initialize source
  await source.initialize();

  // Load all entities in parallel
  const [projects, people, orgs, brands, racis, apps, customers, partners, decisions, glossaryTerms, documents, extensionTypeRegistrations] = await Promise.all([
    source.getProjects(),
    source.getPeople(),
    source.getOrganizations(),
    source.getBrands(),
    source.getRACIs(),
    source.getApps(),
    source.getCustomers(),
    source.getPartners(),
    source.getDecisions(),
    source.getGlossaryTerms(),
    source.getDocuments(),
    source.getExtensionTypeRegistrations(),
  ]);

  // Populate index
  for (const project of projects) {
    index.projects.set(project.id, project);
  }

  for (const person of people) {
    index.people.set(person.id, person);
  }

  for (const org of orgs) {
    index.orgs.set(org.id, org);
  }

  for (const brand of brands) {
    index.brands.set(brand.id, brand);
  }

  for (const raci of racis) {
    index.raci.set(raci.id, raci);
  }

  for (const app of apps) {
    index.apps.set(app.id, app);
  }

  for (const customer of customers) {
    index.customers.set(customer.id, customer);
  }

  for (const partner of partners) {
    index.partners.set(partner.id, partner);
  }

  for (const decision of decisions) {
    index.decisions.set(decision.id, decision);
  }

  for (const glossaryTerm of glossaryTerms) {
    index.glossaryTerms.set(glossaryTerm.id, glossaryTerm);
  }

  for (const document of documents) {
    index.documents.set(document.id, document);
  }

  await populateExtensionEntities(index, source, extensionTypeRegistrations);

  // Build alias mappings
  buildPersonAliases(index);
  buildOrgAliases(index);
  buildBrandAliases(index);

  return index;
}

async function populateExtensionEntities(index: EntityIndex, source: EntitySource, registrations: EntityTypeRegistration[]): Promise<void> {
  const extensions = registrations.length > 0 ? registrations : getExtensionRegistrations();
  const extensionEntries = await Promise.all(extensions.map(async (registration) => {
    const entities = await source.getExtensionEntities(registration.type);
    return [registration.type, entities] as const;
  }));

  for (const [type, entities] of extensionEntries) {
    const byId = new Map<string, ExtensionEntity>();
    for (const entity of entities) {
      byId.set(entity.id, entity);
    }
    index.extensions.set(type, byId);
  }
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

export function resolveBrandId(index: EntityIndex, nameOrAlias: string): string | undefined {
  if (index.brands.has(nameOrAlias)) {
    return nameOrAlias;
  }
  return index.aliasToBrandId.get(nameOrAlias);
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
    case 'brand':
      return Array.from(index.brands.values());
    case 'raci':
      return Array.from(index.raci.values());
    case 'app':
      return Array.from(index.apps.values());
    case 'customer':
      return Array.from(index.customers.values());
    case 'partner':
      return Array.from(index.partners.values());
    case 'decision':
      return Array.from(index.decisions.values());
    case 'glossary_term':
      return Array.from(index.glossaryTerms.values());
    case 'document':
      return Array.from(index.documents.values());
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
    case 'brand':
      return index.brands.get(id) || index.brands.get(resolveBrandId(index, id) || '');
    case 'raci':
      return index.raci.get(id);
    case 'app':
      return index.apps.get(id);
    case 'customer':
      return index.customers.get(id);
    case 'partner':
      return index.partners.get(id);
    case 'decision':
      return index.decisions.get(id);
    case 'glossary_term':
      return index.glossaryTerms.get(id);
    case 'document':
      return index.documents.get(id);
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
    ...index.brands.values(),
    ...index.raci.values(),
    ...index.apps.values(),
    ...index.customers.values(),
    ...index.partners.values(),
    ...index.decisions.values(),
    ...index.glossaryTerms.values(),
    ...index.documents.values(),
  ];

  for (const entity of allEntities) {
    // Check name/title - all entity types now have 'name' property
    const name = (entity as { name?: string }).name || entity.id;
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
      continue;
    }

    if ('description' in entity && typeof entity.description === 'string' && entity.description.toLowerCase().includes(lowerQuery)) {
      results.push(entity);
      continue;
    }

    if ('title' in entity && typeof entity.title === 'string' && entity.title.toLowerCase().includes(lowerQuery)) {
      results.push(entity);
      continue;
    }

    if ('term' in entity && typeof entity.term === 'string' && entity.term.toLowerCase().includes(lowerQuery)) {
      results.push(entity);
    }
  }

  return results;
}

export function getExtensionTypeRegistrations(): EntityTypeRegistration[] {
  return getExtensionRegistrations();
}

export function getExtensionEntitiesByType(index: EntityIndex, type: string): ExtensionEntity[] {
  return Array.from(index.extensions.get(type)?.values() || []);
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
      // Get RACI for related orgs (new format: RACI is per-org, not per-project)
      for (const orgTag of primary.orgs) {
        const orgId = resolveOrgId(index, orgTag);
        if (orgId) {
          const raci = index.raci.get(orgId);
          if (raci && !related.includes(raci)) related.push(raci);
        }
      }
      // Legacy: try project_id based RACI
      const legacyRaci = index.raci.get(primary.project_id);
      if (legacyRaci && !related.includes(legacyRaci)) related.push(legacyRaci);
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
      // Get RACI for this org
      const raci = index.raci.get(primary.org_id);
      if (raci) related.push(raci);
    }
  }

  return { primary, related };
}

// Export types
export type { EntityIndex, Entity, EntityType } from './types.js';
