/** Reusable, source-independent entity index builder. */

/** Source-projected evidence; interpretation remains with the consumer. */
export type RetrievalEvidence = Partial<Record<
  'content' | 'statement' | 'decision' | 'rationale' | 'body' | 'markdown'
  | 'body_summary' | 'summary' | 'description' | 'notes' | 'source_pointer' | 'provenance',
  unknown
>>;

export interface BaseEntity {
  graph_entity_id?: string;
  retrieval_evidence?: RetrievalEvidence;
  id: string;
  filePath: string;
  updated?: string;
  project_code?: string;
  source?: string;
  source_path?: string;
  legacy_source_path?: string;
  lifecycle_status?: string;
  lifecycle_state?: string;
  semantic_state?: string;

  canonical_entity_id?: string;
  version?: number;
}

export interface Project extends BaseEntity {
  type: 'project';
  project_id: string;
  name: string;

  aliases?: string[];
  status: 'active' | 'paused' | 'archived' | string;
  team: string[];
  orgs: string[];
  apps: string[];
  customers: string[];
  content: string;
  beta_partners?: number;
}

export interface Person extends BaseEntity {
  type: 'person';
  name: string;
  role: string;
  org: string;
  org_tags: string[];
  projects: string[];
  aliases: string[];
  status: 'active' | 'inactive' | 'stakeholder' | string;
  content: string;
}

export interface Organization extends BaseEntity {
  type: 'org';
  org_id: string;
  name: string;
  aliases: string[];
  orgType: 'legal_entity' | 'brand' | 'internal' | 'partner' | string;
  content: string;
}

export interface Brand extends BaseEntity {
  type: 'brand';
  name: string;
  scope?: 'org' | 'product' | 'personal' | 'campaign' | string;
  owner_entity_id?: string;
  related_orgs: string[];
  related_apps: string[];
  tagline?: string;
  positioning?: string;
  voice?: string | string[];
  do: string[];
  dont: string[];
  visual_assets: string[];
  aliases: string[];
  content: string;
}

export interface RACI extends BaseEntity {
  type: 'raci';
  org_id: string;
  name: string;
  members: string[];
  positions: PositionEntry[];
  decisions: DecisionEntry[];
  assignments: AssignmentEntry[];
  products: string[];
  content: string;

  entries?: RACIEntry[];
  project_id?: string;
}

export interface PositionEntry {
  person: string;
  assets: string;
  authority: string;
}

export interface DecisionEntry {
  domain: string;
  decider: string;
}

export interface AssignmentEntry {
  person: string;
  areas: string;
}

export interface RACIEntry {
  item: string;
  responsible: string;
  accountable: string;
  consulted: string;
  informed: string;
}

export interface AppRepositoryRef {
  owner?: string;
  repo?: string;
  url?: string;
  ref?: string;
}

export interface AppEnvironmentEndpoints {
  api?: string;
  health?: string;
  nocodb?: string;
  ssot_graph?: string;
  url?: string;
  worker?: string;
}

export interface AppEnvironmentProfile {
  mode?: string;
  host?: string;
  region?: string;
  instance?: string;
  url?: string;
  ui_url?: string;
  worktree_ui_url?: string;
  endpoint?: string;
  worker?: string;
  runtime?: string;
  ai_service?: string;
  data_services?: string[];
  async_services?: string[];
  mobile_runtime?: string;
  functions?: string[];
  purpose?: string;
  endpoints?: AppEnvironmentEndpoints;
}

export interface AppOperationalProfileCoverage {
  available_fields: string[];
  omitted_fields: string[];
}

export interface App extends BaseEntity {
  type: 'app';
  app_id: string;
  name: string;
  project: string;
  orgs: string[];
  status: string;
  description: string;

  summary?: string;
  projects?: string[];
  repository?: AppRepositoryRef;
  parent_project?: string;
  parent_project_entity_id?: string;
  environments?: Record<string, AppEnvironmentProfile>;
  record_class?: string;
  service_profile_eligible?: boolean;
  operational_profile_coverage?: AppOperationalProfileCoverage;
}

export interface Customer extends BaseEntity {
  type: 'customer';
  customer_id: string;
  name: string;
  salesOrg: string;
  implOrg: string;
  project: string;
  contractType: string;
  upfront: string;
  status: string;
  notes: string;
}

export interface Partner extends BaseEntity {
  type: 'partner';
  name: string;
  status: string;
  org: string;
  projects: string[];
  aliases: string[];
  content: string;
}

export interface Decision extends BaseEntity {
  type: 'decision';
  decision_id: string;
  title: string;
  content: string;
  decided_at: string;
  decider: string;
  project_id?: string;
  meeting_id?: string;
  status: 'active' | 'superseded' | 'deprecated' | string;
  tags: string[];
}

export interface GlossaryTerm extends BaseEntity {
  type: 'glossary_term';
  term: string;
  name: string;
  canonical?: string;
  aliases: string[];
  description: string;
  content: string;
}

export interface Document extends BaseEntity {
  type: 'document';
  title: string;
  name: string;
  path?: string;
  tags: string[];
  content: string;
}

export interface ExtensionEntity extends BaseEntity {
  type: string;
  name: string;
  title?: string;
  status?: string;
  payload: Record<string, unknown>;
  content: string;
}

export type Entity = Project | Person | Organization | Brand | RACI | App | Customer | Partner | Decision | GlossaryTerm | Document;
export type EntityType = 'project' | 'person' | 'org' | 'brand' | 'raci' | 'app' | 'customer' | 'partner' | 'decision' | 'glossary_term' | 'document';

export interface EntityIndex {
  projects: Map<string, Project>;
  people: Map<string, Person>;
  orgs: Map<string, Organization>;
  brands: Map<string, Brand>;
  raci: Map<string, RACI>;
  apps: Map<string, App>;
  customers: Map<string, Customer>;
  partners: Map<string, Partner>;
  decisions: Map<string, Decision>;
  glossaryTerms: Map<string, GlossaryTerm>;
  documents: Map<string, Document>;
  extensions: Map<string, Map<string, ExtensionEntity>>;

  aliasToPersonId: Map<string, string>;
  aliasToOrgId: Map<string, string>;
  aliasToBrandId: Map<string, string>;

  replacedIdToCanonicalId: Map<EntityType, Map<string, string>>;
}

export type EntityTypeCategory = 'core' | 'extension';

export type EntityTypeRegistration = {
  type: string;
  category: EntityTypeCategory;
  storageType?: string;
  displayName: string;
  description: string;
  defaultSearch: boolean;
};

export const CORE_ENTITY_TYPES = [
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
] as const;

export const EXTENSION_ENTITY_TYPES = [
  'contact',
  'frame',
  'story',
  'infrastructure_environment',
  'speaking',
  'media_appearance',
  'role_assignment',
  'product',
  'initiative',
  'publication',
  'press_mention',
] as const;

export type CoreEntityType = typeof CORE_ENTITY_TYPES[number];
export type ExtensionEntityType = typeof EXTENSION_ENTITY_TYPES[number] | string;

export const ENTITY_TYPE_REGISTRY: EntityTypeRegistration[] = [
  { type: 'project', category: 'core', displayName: 'Project', description: 'Work, product, or engagement context.', defaultSearch: true },
  { type: 'person', category: 'core', displayName: 'Person', description: 'Human stakeholder or team member.', defaultSearch: true },
  { type: 'org', category: 'core', displayName: 'Organization', description: 'Legal entity, team, or organization context.', defaultSearch: true },
  { type: 'brand', category: 'core', displayName: 'Brand', description: 'Naming, positioning, voice, and public promise context.', defaultSearch: true },
  { type: 'app', category: 'core', displayName: 'App', description: 'Application or software product.', defaultSearch: true },
  { type: 'customer', category: 'core', displayName: 'Customer', description: 'Customer or account context.', defaultSearch: true },
  { type: 'partner', category: 'core', displayName: 'Partner', description: 'Partner organization or person.', defaultSearch: true },
  { type: 'decision', category: 'core', displayName: 'Decision', description: 'Decision record.', defaultSearch: true },
  { type: 'raci', category: 'core', storageType: 'raci_assignment', displayName: 'RACI', description: 'Responsibility, authority, and assignment context.', defaultSearch: true },
  { type: 'glossary_term', category: 'core', displayName: 'Glossary Term', description: 'Canonical term, alias, and correction context.', defaultSearch: true },
  { type: 'document', category: 'core', displayName: 'Document', description: 'Operational or knowledge document.', defaultSearch: true },
  { type: 'contact', category: 'extension', displayName: 'Contact', description: 'Business-card contact awaiting operational promotion to a person.', defaultSearch: false },
  { type: 'frame', category: 'extension', displayName: 'Frame', description: 'Organization-specific framework or mental model.', defaultSearch: false },
  { type: 'story', category: 'extension', displayName: 'Story', description: 'Story-to-ship or task story record.', defaultSearch: false },
  { type: 'infrastructure_environment', category: 'extension', displayName: 'Infrastructure Environment', description: 'Deployment or runtime environment detail.', defaultSearch: false },
  { type: 'speaking', category: 'extension', displayName: 'Speaking', description: 'Speaking engagement profile record.', defaultSearch: false },
  { type: 'media_appearance', category: 'extension', displayName: 'Media Appearance', description: 'Media appearance profile record.', defaultSearch: false },
  { type: 'role_assignment', category: 'extension', displayName: 'Role Assignment', description: 'Profile or organization-specific role assignment.', defaultSearch: false },
  { type: 'product', category: 'extension', displayName: 'Product', description: 'Profile or organization-specific product record.', defaultSearch: false },
  { type: 'initiative', category: 'extension', displayName: 'Initiative', description: 'Cross-project program or strategic initiative.', defaultSearch: false },
  { type: 'publication', category: 'extension', displayName: 'Publication', description: 'Publication profile record.', defaultSearch: false },
  { type: 'press_mention', category: 'extension', displayName: 'Press Mention', description: 'Press mention profile record.', defaultSearch: false },
];

export const EXTENSION_ENTITY_TYPE_SET = new Set<string>(EXTENSION_ENTITY_TYPES);

export function getStorageType(publicType: string): string {
  return ENTITY_TYPE_REGISTRY.find((item) => item.type === publicType)?.storageType || publicType;
}

export function getPublicType(storageType: string): string {
  return ENTITY_TYPE_REGISTRY.find((item) => item.storageType === storageType)?.type || storageType;
}

export function getExtensionRegistrations(): EntityTypeRegistration[] {
  return ENTITY_TYPE_REGISTRY.filter((item) => item.category === 'extension');
}

export function getGraphFetchTypes(): string[] {
  return Array.from(new Set(ENTITY_TYPE_REGISTRY.map((item) => item.storageType || item.type)));
}

export interface EntitySource {

  initialize(): Promise<void>;

  getProjects(): Promise<Project[]>;

  getPeople(): Promise<Person[]>;

  getOrganizations(): Promise<Organization[]>;

  getBrands(): Promise<Brand[]>;

  getRACIs(): Promise<RACI[]>;

  getApps(): Promise<App[]>;

  getCustomers(): Promise<Customer[]>;

  getPartners(): Promise<Partner[]>;

  getDecisions(): Promise<Decision[]>;

  getGlossaryTerms(): Promise<GlossaryTerm[]>;

  getDocuments(): Promise<Document[]>;

  getExtensionTypeRegistrations(): Promise<EntityTypeRegistration[]>;

  getExtensionEntities(type: string): Promise<ExtensionEntity[]>;
}

const INACTIVE_LIFECYCLE_STATES = new Set(['inactive', 'retired', 'superseded', 'merged']);

export interface LifecycleRecord {
  lifecycle_status?: unknown;
  lifecycle_state?: unknown;
  semantic_state?: unknown;
  status?: unknown;
  payload?: unknown;
}

function lifecyclePayloadRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isInactiveLifecycleState(value: unknown): boolean {
  return typeof value === 'string'
    && INACTIVE_LIFECYCLE_STATES.has(value.trim().toLowerCase());
}

/** Return false only when a record explicitly carries a known inactive state. */
export function isActiveLifecycle(record: LifecycleRecord): boolean {
  const payload = lifecyclePayloadRecord(record.payload);
  return [
    record.lifecycle_status,
    record.lifecycle_state,
    record.semantic_state,
    record.status,
    payload?.lifecycle_status,
    payload?.lifecycle_state,
    payload?.semantic_state,
    payload?.status,
  ].some(isInactiveLifecycleState) === false;
}

/** A person is active only when both identity status and lifecycle are active. */
export function isActiveCanonicalPerson(person: LifecycleRecord): boolean {
  return isActiveLifecycle(person);
}

function assertCollection(type: string, value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${type} collection must be an array`);
}

function validateEntities(type: string, entities: BaseEntity[]): void {
  assertCollection(type, entities);
  const activeIds = new Set<string>();
  for (const entity of entities) {
    if (!entity || typeof entity.id !== 'string' || entity.id.trim() === '') {
      throw new TypeError(`${type} entity requires a non-empty id`);
    }
    if (!isReplacedLifecycle(entity)) {
      if (activeIds.has(entity.id)) throw new TypeError(`${type} duplicate active id: ${entity.id}`);
      activeIds.add(entity.id);
    }
  }
}

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
    replacedIdToCanonicalId: new Map(),
  };
}

// Graph lifecycle states of records that must not answer as the current entity.
// merge_entities leaves the source as superseded with payload.canonical_entity_id.
const REPLACED_LIFECYCLE_STATES = new Set(['superseded', 'merged', 'retired']);

export function isReplacedLifecycle(entity: { lifecycle_status?: string; lifecycle_state?: string }): boolean {
  return [entity.lifecycle_status, entity.lifecycle_state].some(value =>
    typeof value === 'string' && REPLACED_LIFECYCLE_STATES.has(value.trim().toLowerCase()));
}

/**
 * Index only current records. A replaced record never overwrites an active one
 * that shares its display id (for example payload.org_id), and its ids are kept
 * as pointers to the canonical record named by canonical_entity_id.
 */
function populateCurrentEntities<T extends Entity>(index: EntityIndex, type: EntityType, target: Map<string, T>, entities: T[]): void {
  validateEntities(type, entities);
  const replaced: T[] = [];
  for (const entity of entities) {
    if (isReplacedLifecycle(entity)) {
      replaced.push(entity);
    } else {
      target.set(entity.id, entity);
    }
  }

  const indexKeyByGraphId = new Map<string, string>();
  for (const [key, entity] of target) {
    indexKeyByGraphId.set(entity.graph_entity_id || entity.id, key);
  }
  const pointers = new Map<string, string>();
  for (const entity of replaced) {
    const canonical = entity.canonical_entity_id;
    const canonicalKey = canonical ? indexKeyByGraphId.get(canonical) ?? (target.has(canonical) ? canonical : undefined) : undefined;
    if (!canonicalKey) continue;
    for (const replacedId of [entity.graph_entity_id, entity.id]) {
      if (replacedId && !target.has(replacedId)) pointers.set(replacedId, canonicalKey);
    }
  }
  index.replacedIdToCanonicalId.set(type, pointers);

  // Keep terminal person rows in the local projection as negative evidence.
  // Resolver consumers filter them through the shared active-person predicate,
  // while Personal KG can distinguish an explicitly inactive identity from an
  // actually empty projection before applying its canonical-ID fallback. Add
  // them after pointer construction so legacy IDs still resolve to the active
  // canonical row through replacedIdToCanonicalId.
  if (type === 'person') {
    for (const entity of replaced) {
      if (!target.has(entity.id)) target.set(entity.id, entity);
    }
  }
}

/**
 * Build alias mappings for people
 */
function buildPersonAliases(index: EntityIndex): void {
  for (const person of index.people.values()) {
    if (!isActiveCanonicalPerson(person)) continue;
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
 * Host revision must be cheap, stable, and change on every indexed create/update/retire/delete.
 * Without such a marker, rebuild per refresh or use a rejecting cache revision (no commit).
 * Never use fresh random/timestamp revisions: before/after mismatch throws after 3 builds.
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
  populateCurrentEntities(index, 'project', index.projects, projects);
  populateCurrentEntities(index, 'person', index.people, people);
  populateCurrentEntities(index, 'org', index.orgs, orgs);
  populateCurrentEntities(index, 'brand', index.brands, brands);
  populateCurrentEntities(index, 'raci', index.raci, racis);
  populateCurrentEntities(index, 'app', index.apps, apps);
  populateCurrentEntities(index, 'customer', index.customers, customers);
  populateCurrentEntities(index, 'partner', index.partners, partners);
  populateCurrentEntities(index, 'decision', index.decisions, decisions);
  populateCurrentEntities(index, 'glossary_term', index.glossaryTerms, glossaryTerms);
  populateCurrentEntities(index, 'document', index.documents, documents);

  await populateExtensionEntities(index, source, extensionTypeRegistrations);

  // Build alias mappings
  buildPersonAliases(index);
  buildOrgAliases(index);
  buildBrandAliases(index);

  return index;
}

async function populateExtensionEntities(index: EntityIndex, source: EntitySource, registrations: EntityTypeRegistration[]): Promise<void> {
  assertCollection('extension registrations', registrations);
  const extensions = registrations.length > 0 ? registrations : getExtensionRegistrations();
  const extensionEntries = await Promise.all(extensions.map(async (registration) => {
    const entities = await source.getExtensionEntities(registration.type);
    return [registration.type, entities] as const;
  }));

  for (const [type, entities] of extensionEntries) {
    validateEntities(type, entities);
    const byId = new Map<string, ExtensionEntity>();
    for (const entity of entities) {
      byId.set(entity.id, entity);
    }
    index.extensions.set(type, byId);
  }
}

