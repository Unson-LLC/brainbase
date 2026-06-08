import type { EntityKind, PersonalOs, SearchResult } from './types.js';
import { buildOperationalizationPlan } from './operationalization.js';

export function getContext(os: PersonalOs): Record<string, unknown> {
  const selfEntries = os.personalKg.filter((entry) => entry.type === 'self' || entry.type === 'value' || entry.type === 'judgment');
  const workEntries = os.personalKg.filter((entry) => entry.type === 'work' || entry.type === 'experience');
  const projects = os.graph.entities.filter((entity) => entity.type === 'project').map((entity) => ({
    id: entity.id,
    name: entity.name,
    summary: entity.summary,
    goal: readMetadataString(entity.metadata, 'goal'),
    status: readMetadataString(entity.metadata, 'status'),
    role: readMetadataString(entity.metadata, 'role'),
    sources: Array.isArray(entity.metadata?.sources) ? entity.metadata.sources : [],
    taskSources: Array.isArray(entity.metadata?.taskSources) ? entity.metadata.taskSources : [],
    decisionPrinciples: Array.isArray(entity.metadata?.decisionPrinciples) ? entity.metadata.decisionPrinciples : []
  }));

  return {
    owner: os.graph.owner ?? {},
    self: selfEntries.map((entry) => entry.text),
    projects,
    work: [
      ...projects.map((project) => project.summary ? `${project.name}: ${project.summary}` : project.name),
      ...workEntries.map((entry) => entry.text)
    ],
    relationships: os.relationships.relationships.map((relationship) => ({
      person: relationship.person,
      role: relationship.role,
      context: relationship.context
    })),
    decisions: os.decisions.map((decision) => ({
      title: decision.title,
      decision: decision.decision,
      rationale: decision.rationale
    })),
    canonicalFiles: ['graph.json', 'personal-kg.jsonl', 'relationships.json', 'decisions.jsonl'],
    note: 'Canonical local SSOT data is preferred over raw sources.'
  };
}

export function listEntities(os: PersonalOs, type?: EntityKind): Record<string, unknown> {
  const graphEntities = os.graph.entities.filter((entity) => !type || entity.type === type);
  const relationshipEntities = type && type !== 'relationship'
    ? []
    : os.relationships.relationships.map((relationship) => ({
      id: relationship.id,
      type: 'relationship' as const,
      name: relationship.person,
      summary: relationship.context,
      tags: relationship.tags
    }));
  const decisionEntities = type && type !== 'decision'
    ? []
    : os.decisions.map((decision) => ({
      id: decision.id,
      type: 'decision' as const,
      name: decision.title,
      summary: decision.decision,
      tags: decision.tags
    }));

  return {
    entities: [...graphEntities, ...relationshipEntities, ...decisionEntities]
  };
}

export function searchPersonalKg(os: PersonalOs, query: string, limit = 10): SearchResult[] {
  return rank(
    os.personalKg.map((entry) => ({
      source: 'personal-kg' as const,
      id: entry.id,
      title: entry.type,
      text: entry.text,
      score: scoreText(query, [entry.id, entry.type, entry.text, ...(entry.tags ?? [])])
    })),
    limit
  );
}

export function searchAll(os: PersonalOs, query: string, limit = 10): SearchResult[] {
  const graphResults = os.graph.entities.map((entity) => ({
    source: 'graph' as const,
    id: entity.id,
    title: entity.name,
    text: [entity.summary ?? entity.name, metadataText(entity.metadata)].filter(Boolean).join('\n'),
    score: scoreText(query, [entity.id, entity.type, entity.name, entity.summary ?? '', metadataText(entity.metadata), ...(entity.tags ?? [])])
  }));
  const relationshipResults = os.relationships.relationships.map((relationship) => ({
    source: 'relationships' as const,
    id: relationship.id,
    title: relationship.person,
    text: relationship.context,
    score: scoreText(query, [relationship.id, relationship.person, relationship.role ?? '', relationship.context, ...(relationship.tags ?? [])])
  }));
  const decisionResults = os.decisions.map((decision) => ({
    source: 'decisions' as const,
    id: decision.id,
    title: decision.title,
    text: [decision.decision, decision.rationale ?? ''].filter(Boolean).join('\n'),
    score: scoreText(query, [decision.id, decision.title, decision.decision, decision.rationale ?? '', ...(decision.tags ?? [])])
  }));

  return rank([...graphResults, ...searchPersonalKg(os, query, limit), ...relationshipResults, ...decisionResults], limit);
}

export function onboardingStatus(os: PersonalOs): Record<string, unknown> {
  const seeded = {
    self: Boolean(os.graph.owner?.name) || os.personalKg.some((entry) => entry.type === 'self'),
    work: os.graph.entities.some((entity) => entity.type === 'project') || os.personalKg.some((entry) => entry.type === 'work'),
    relationships: os.relationships.relationships.length > 0
  };
  const missing = Object.entries(seeded)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  const valueDemoReady = missing.length === 0;
  const operationalization = buildOperationalizationPlan({
    dataDir: os.dataDir,
    firstValueReady: valueDemoReady
  });

  return {
    connected: true,
    dataDir: os.dataDir,
    seeded,
    missing,
    valueDemo: {
      ready: valueDemoReady,
      missing,
      command: 'brainbase onboard:demo --scenario "<real request>"',
      completionSignal: valueDemoReady ? 'first_value_demo_ready' : 'needs_seed'
    },
    operationalization,
    counts: {
      graphEntities: os.graph.entities.length,
      personalKgEntries: os.personalKg.length,
      relationships: os.relationships.relationships.length,
      decisions: os.decisions.length,
      rawSources: os.sourceCount
    },
    backend: 'local'
  };
}

function rank(results: SearchResult[], limit: number): SearchResult[] {
  return results
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, Math.max(1, limit));
}

function scoreText(query: string, fields: string[]): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return 0;
  }
  const haystack = fields.join('\n').toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function metadataText(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) {
    return '';
  }
  return JSON.stringify(metadata);
}

function readMetadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}
