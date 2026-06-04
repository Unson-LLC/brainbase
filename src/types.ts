export type EntityKind = 'person' | 'org' | 'project' | 'relationship' | 'decision';

export interface GraphEntity {
  id: string;
  type: Exclude<EntityKind, 'decision'>;
  name: string;
  summary?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface GraphFile {
  version: 1;
  owner?: {
    name?: string;
    summary?: string;
  };
  entities: GraphEntity[];
}

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
}
