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
  'frame',
  'story',
  'infrastructure_environment',
  'speaking',
  'media_appearance',
  'role_assignment',
  'product',
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
  { type: 'frame', category: 'extension', displayName: 'Frame', description: 'Organization-specific framework or mental model.', defaultSearch: false },
  { type: 'story', category: 'extension', displayName: 'Story', description: 'Story-to-ship or task story record.', defaultSearch: false },
  { type: 'infrastructure_environment', category: 'extension', displayName: 'Infrastructure Environment', description: 'Deployment or runtime environment detail.', defaultSearch: false },
  { type: 'speaking', category: 'extension', displayName: 'Speaking', description: 'Speaking engagement profile record.', defaultSearch: false },
  { type: 'media_appearance', category: 'extension', displayName: 'Media Appearance', description: 'Media appearance profile record.', defaultSearch: false },
  { type: 'role_assignment', category: 'extension', displayName: 'Role Assignment', description: 'Profile or organization-specific role assignment.', defaultSearch: false },
  { type: 'product', category: 'extension', displayName: 'Product', description: 'Profile or organization-specific product record.', defaultSearch: false },
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
