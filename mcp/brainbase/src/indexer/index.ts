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

export type EntityResolverConfidence = 'high' | 'medium' | 'low';
export type EntityResolverAbsenceVerdict = 'candidates_found' | 'no_candidate_after_resolver_checks';

export interface EntityResolverCandidate {
  entity_id: string;
  type: string;
  name: string;
  aliases: string[];
  matched_terms: string[];
  matched_fields: string[];
  score: number;
  confidence: EntityResolverConfidence;
  project_code?: string;
  details?: Record<string, string>;
  why: string;
}

export interface EntityResolverResult {
  query: string;
  candidates: EntityResolverCandidate[];
  absence_verdict: EntityResolverAbsenceVerdict;
  searched_terms: string[];
  fallbacks_used: string[];
  unsupported_types: string[];
}

export interface EntityResolverOptions {
  query: string;
  types?: string[];
  project?: string;
  scope?: string;
  ownerPersonId?: string;
}

const RESOLVER_ENTITY_TYPES: EntityType[] = [
  'project',
  'person',
  'org',
  'brand',
  'app',
  'customer',
  'partner',
  'decision',
  'raci',
  'glossary_term',
  'document',
];

const RESOLVER_ENTITY_TYPE_SET = new Set<string>(RESOLVER_ENTITY_TYPES);
const HONORIFIC_SUFFIXES = ['さん', '氏', '様', '先生'];
const FIRST_PERSON_TERMS = new Set(['俺', '自分', '私', 'わたし', '僕']);

export function containsFirstPersonReference(query: string): boolean {
  const normalized = normalizeResolverText(query);
  return /(?:俺|自分|わたし|僕)(?:の|自身|は|が|を|に|$|\s)/u.test(normalized)
    || /私(?:の|自身|は|が|を|に|$|\s)/u.test(normalized);
}
const TERM_EQUIVALENTS: Record<string, string[]> = {
  lecaldo: ['レカルド', 'リカルド', 'riccardo'],
  'le caldo': ['レカルド', 'リカルド', 'riccardo'],
  riccardo: ['レカルド', 'リカルド', 'lecaldo'],
  レカルド: ['リカルド', 'lecaldo', 'riccardo'],
  リカルド: ['レカルド', 'lecaldo', 'riccardo'],
};

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

function normalizeResolverText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function stripHonorificSuffix(value: string): string {
  let stripped = value;
  for (const suffix of HONORIFIC_SUFFIXES) {
    if (stripped.endsWith(suffix) && stripped.length > suffix.length) {
      stripped = stripped.slice(0, -suffix.length);
    }
  }
  return stripped;
}

function pushUnique(values: string[], value: string): void {
  if (value && !values.includes(value)) values.push(value);
}

function pushTermWithEquivalents(values: string[], value: string): void {
  pushUnique(values, value);
  for (const equivalent of TERM_EQUIVALENTS[value] || []) {
    pushUnique(values, normalizeResolverText(equivalent));
  }
}

export function tokenizeEntityQuery(query: string): string[] {
  const terms: string[] = [];
  const normalizedQuery = normalizeResolverText(query);
  const noSpaceQuery = normalizedQuery.replace(/\s+/g, '');

  pushTermWithEquivalents(terms, normalizedQuery);
  if (noSpaceQuery !== normalizedQuery) pushTermWithEquivalents(terms, noSpaceQuery);

  for (const rawPart of normalizedQuery.split(/[\s,，、/／|｜;；:：()[\]{}<>「」『』]+/u)) {
    const part = normalizeResolverText(rawPart);
    if (!part) continue;
    pushTermWithEquivalents(terms, part);
    const stripped = stripHonorificSuffix(part);
    if (stripped !== part) pushTermWithEquivalents(terms, stripped);
    const noSpace = part.replace(/\s+/g, '');
    if (noSpace !== part) pushTermWithEquivalents(terms, noSpace);
  }

  return terms.filter(term => term.length >= 2 || /[^\x00-\x7F]/u.test(term));
}

function normalizedFieldVariants(value: string): string[] {
  const variants: string[] = [];
  const normalized = normalizeResolverText(value);
  const noSpace = normalized.replace(/\s+/g, '');
  pushUnique(variants, normalized);
  if (noSpace !== normalized) pushUnique(variants, noSpace);
  return variants;
}

function stringValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(item => stringValues(item));
  if (typeof value === 'string' && value.trim()) return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(item => stringValues(item));
  }
  return [];
}

type ResolvableEntity = Entity | ExtensionEntity;

function getEntityDisplayName(entity: ResolvableEntity): string {
  if ('name' in entity && entity.name) return entity.name;
  if ('title' in entity && entity.title) return entity.title;
  if ('term' in entity && entity.term) return entity.term;
  return entity.id;
}

function getEntityAliases(entity: ResolvableEntity): string[] {
  return 'aliases' in entity && Array.isArray(entity.aliases) ? entity.aliases : [];
}

function getEntityProjectCode(entity: ResolvableEntity): string | undefined {
  if (entity.project_code) return entity.project_code;
  if (entity.type === 'project' && 'project_id' in entity) return entity.project_id;
  if ('project_id' in entity && typeof entity.project_id === 'string') return entity.project_id;
  if ('project' in entity && typeof entity.project === 'string') return entity.project;
  if ('projects' in entity && Array.isArray(entity.projects) && entity.projects.length > 0) return entity.projects[0];
  return undefined;
}

function searchableFields(entity: ResolvableEntity): Array<{ field: string; value: string }> {
  const record = entity as unknown as Record<string, unknown>;
  const fields: Array<{ field: string; value: string }> = [];
  const addField = (field: string, value: unknown) => {
    for (const text of stringValues(value)) {
      fields.push({ field, value: text });
    }
  };

  addField('id', entity.id);
  addField('name', getEntityDisplayName(entity));
  addField('aliases', getEntityAliases(entity));
  addField('role', record.role);
  addField('org', record.org);
  addField('org_tags', record.org_tags);
  addField('orgs', record.orgs);
  addField('projects', record.projects);
  addField('project', record.project);
  addField('project_id', record.project_id);
  addField('source', record.source);
  addField('source_path', record.source_path);
  addField('legacy_source_path', record.legacy_source_path);
  addField('content', record.content);
  addField('description', record.description);
  addField('title', record.title);
  addField('term', record.term);
  addField('canonical', record.canonical);
  addField('path', record.path);
  addField('tags', record.tags);
  addField('decider', record.decider);
  addField('salesOrg', record.salesOrg);
  addField('implOrg', record.implOrg);
  addField('notes', record.notes);
  addField('members', record.members);
  addField('positions', record.positions);
  addField('decisions', record.decisions);
  addField('assignments', record.assignments);
  addField('products', record.products);
  addField('related_orgs', record.related_orgs);
  addField('related_apps', record.related_apps);
  if ('payload' in entity) {
    for (const [field, value] of Object.entries(entity.payload)) {
      addField(field, value);
    }
  }

  return fields;
}

function fieldWeight(field: string, exact: boolean): number {
  if (field === 'name') return exact ? 100 : 85;
  if (field === 'aliases') return exact ? 95 : 80;
  if (['id', 'term', 'title'].includes(field)) return exact ? 90 : 75;
  if (['role', 'org', 'org_tags', 'orgs', 'projects', 'project', 'project_id', 'decider'].includes(field)) return exact ? 70 : 55;
  if (['source', 'source_path', 'legacy_source_path', 'path', 'tags'].includes(field)) return exact ? 60 : 45;
  return exact ? 40 : 25;
}

function confidenceForScore(score: number): EntityResolverConfidence {
  if (score >= 80) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

function requestedResolverTypes(index: EntityIndex, types?: string[]): { supported: string[]; unsupported: string[] } {
  if (!types || types.length === 0) {
    return { supported: RESOLVER_ENTITY_TYPES, unsupported: [] };
  }

  const supported: string[] = [];
  const unsupported: string[] = [];
  for (const type of types) {
    if (RESOLVER_ENTITY_TYPE_SET.has(type) || index.extensions.has(type)) {
      pushUnique(supported, type);
    } else {
      pushUnique(unsupported, type);
    }
  }

  return { supported, unsupported };
}

export function resolveEntities(index: EntityIndex, options: EntityResolverOptions): EntityResolverResult {
  const searchedTerms = tokenizeEntityQuery(options.query);
  const candidatesByKey = new Map<string, EntityResolverCandidate>();
  const fallbacksUsed = ['normalized_query', 'tokenized_field_match'];
  const requestedTypes = requestedResolverTypes(index, options.types);

  if (requestedTypes.unsupported.length > 0) {
    fallbacksUsed.push('unsupported_type_reported');
  }

  if (requestedTypes.supported.includes('person')
    && containsFirstPersonReference(options.query)
    && options.ownerPersonId) {
    const owner = resolveCanonicalActivePerson(index, options.ownerPersonId);
    if (owner) {
      const ownerTerms = searchedTerms.filter(term => FIRST_PERSON_TERMS.has(term));
      candidatesByKey.set(`person:${owner.id}`, {
        entity_id: owner.id,
        type: owner.type,
        name: owner.name,
        aliases: owner.aliases,
        matched_terms: ownerTerms.length > 0 ? ownerTerms : ['authenticated_owner'],
        matched_fields: ['authenticated_owner'],
        score: 100,
        confidence: 'high',
        project_code: owner.projects[0],
        why: `${owner.name} matched the authenticated owner identity`,
      });
      fallbacksUsed.push('authenticated_owner_binding');
    }
  }

  for (const type of requestedTypes.supported) {
    const entities: ResolvableEntity[] = RESOLVER_ENTITY_TYPE_SET.has(type)
      ? getEntitiesByType(index, type as EntityType)
      : getExtensionEntitiesByType(index, type);
    for (const entity of entities) {
      if (isMergedEntity(entity)) continue;
      const matchedTerms: string[] = [];
      const matchedFields: string[] = [];
      let score = 0;

      for (const { field, value } of searchableFields(entity)) {
        const variants = normalizedFieldVariants(value);
        for (const term of searchedTerms) {
          const exact = variants.includes(term);
          const partial = !exact && variants.some(variant => variant.includes(term));
          if (!exact && !partial) continue;

          pushUnique(matchedTerms, term);
          pushUnique(matchedFields, field);
          score = Math.max(score, fieldWeight(field, exact));
        }
      }

      if (matchedTerms.length === 0) continue;

      const name = getEntityDisplayName(entity);
      const details = 'payload' in entity
        ? contactDetails(entity.payload)
        : undefined;
      candidatesByKey.set(`${entity.type}:${entity.id}`, {
        entity_id: entity.id,
        type: entity.type,
        name,
        aliases: getEntityAliases(entity),
        matched_terms: matchedTerms,
        matched_fields: matchedFields,
        score,
        confidence: confidenceForScore(score),
        project_code: getEntityProjectCode(entity),
        ...(details && Object.keys(details).length > 0 ? { details } : {}),
        why: `${name} matched ${matchedTerms.join(', ')} in ${matchedFields.join(', ')}`,
      });
    }
  }

  const candidates = Array.from(candidatesByKey.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name, 'ja');
  });

  return {
    query: options.query,
    candidates,
    absence_verdict: candidates.length > 0 ? 'candidates_found' : 'no_candidate_after_resolver_checks',
    searched_terms: searchedTerms,
    fallbacks_used: fallbacksUsed,
    unsupported_types: requestedTypes.unsupported,
  };
}

function isMergedEntity(entity: ResolvableEntity): boolean {
  if ('status' in entity && typeof entity.status === 'string') {
    return entity.status.trim().toLowerCase() === 'merged';
  }
  return 'payload' in entity
    && typeof entity.payload.status === 'string'
    && entity.payload.status.trim().toLowerCase() === 'merged';
}

export function resolveCanonicalActivePerson(index: EntityIndex, personId: string) {
  const matches = Array.from(index.people.values()).filter(person =>
    !isMergedEntity(person)
    && (person.id === personId || person.aliases.includes(personId))
  );
  return matches.length === 1 ? matches[0] : null;
}

const CONTACT_DETAIL_FIELDS = [
  'company_name',
  'department',
  'title',
  'email',
  'tel_company',
  'tel_direct',
  'mobile',
  'fax',
  'postal_code',
  'address',
  'url',
  'scanned_at',
  'exchanged_at',
] as const;

function contactDetails(payload: Record<string, unknown>): Record<string, string> {
  const details: Record<string, string> = {};
  for (const field of CONTACT_DETAIL_FIELDS) {
    const value = payload[field];
    if (typeof value === 'string' && value.trim()) details[field] = value.trim();
  }
  return details;
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
