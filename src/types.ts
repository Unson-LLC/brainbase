export type EntityKind = 'person' | 'org' | 'project' | 'relationship' | 'decision';
export type CanonicalEntityKind = 'person' | 'org' | 'project' | 'decision';
export type CoreRelation =
  | 'member_of'
  | 'participates_in'
  | 'accountable_for'
  | 'owned_by'
  | 'governs'
  | 'supersedes';

export interface GraphEntity {
  id: string;
  type: Exclude<EntityKind, 'decision'>;
  name: string;
  summary?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface GraphFileV1 {
  version: 1;
  owner?: {
    name?: string;
    summary?: string;
  };
  entities: GraphEntity[];
}

export interface CanonicalEntity {
  id: string;
  type: CanonicalEntityKind;
  name: string;
  aliases?: string[];
  summary?: string;
  tags?: string[];
  validFrom?: string;
  validTo?: string;
  metadata?: Record<string, unknown>;
}

export interface CanonicalEdge {
  id: string;
  fromId: string;
  relation: CoreRelation;
  toId: string;
  role?: string;
  context?: string;
  validFrom?: string;
  validTo?: string;
  provenance?: {
    sourceKind: 'user_approved' | 'migration' | 'import' | 'onboarding';
    sourceId?: string;
    evidenceHash?: string;
  };
}

export interface GraphFileV2 {
  version: 2;
  ontology: {
    id: 'brainbase-personal-os';
    version: string;
    releaseDigest: string;
  };
  owner?: {
    id?: string;
    name?: string;
    summary?: string;
  };
  entities: CanonicalEntity[];
  edges: CanonicalEdge[];
}

export type GraphFile = GraphFileV1 | GraphFileV2;
export type CanonicalGraphFile = GraphFile;

export interface PersonalKgEntry {
  id: string;
  type: 'self' | 'work' | 'relationship' | 'value' | 'judgment' | 'experience' | 'sns_context';
  text: string;
  tags?: string[];
  source?: string;
  updatedAt?: string;
}

export interface RelationshipRecord {
  id: string;
  person: string;
  role?: string;
  context: string;
  tags?: string[];
  updatedAt?: string;
}

export interface RelationshipsFile {
  version: 1;
  relationships: RelationshipRecord[];
}

export interface DecisionRecord {
  id: string;
  title: string;
  decision: string;
  topic?: string;
  supersedes?: string[];
  effectiveAt?: string;
  rationale?: string;
  tags?: string[];
  updatedAt?: string;
}

export interface PersonalOs {
  dataDir: string;
  graph: GraphFile;
  personalKg: PersonalKgEntry[];
  relationships: RelationshipsFile;
  decisions: DecisionRecord[];
  sourceCount: number;
}

export interface SearchResult {
  source: 'graph' | 'personal-kg' | 'relationships' | 'decisions';
  id: string;
  title: string;
  text: string;
  score: number;
  canonicalEntityId?: string;
  recordClass: 'canonical' | 'projection' | 'unresolved';
  projectionOf?: string;
  projectionSources?: Array<'relationships' | 'decisions'>;
  relationPath?: string[];
  authority: 'local_graph' | 'personal_kg' | 'legacy_relationships' | 'legacy_decisions';
}
