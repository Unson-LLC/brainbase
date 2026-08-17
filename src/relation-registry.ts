import type { CanonicalEntityKind, CoreRelation } from './types.js';

export interface CanonicalRelationDefinition {
  id: CoreRelation;
  from: CanonicalEntityKind;
  to: CanonicalEntityKind;
  meaning: string;
  scopeTraversal: 'none' | 'project_direct' | 'project_transitive';
  traversalDirection: 'none' | 'forward' | 'reverse';
}

const definitions = {
  member_of: {
    id: 'member_of',
    from: 'person',
    to: 'org',
    meaning: 'A person is a member of an organization.',
    scopeTraversal: 'none',
    traversalDirection: 'none'
  },
  participates_in: {
    id: 'participates_in',
    from: 'person',
    to: 'project',
    meaning: 'A person participates in a project.',
    scopeTraversal: 'project_direct',
    traversalDirection: 'forward'
  },
  accountable_for: {
    id: 'accountable_for',
    from: 'person',
    to: 'project',
    meaning: 'A person is accountable for a project outcome or decision.',
    scopeTraversal: 'project_direct',
    traversalDirection: 'forward'
  },
  owned_by: {
    id: 'owned_by',
    from: 'project',
    to: 'org',
    meaning: 'A project is owned by an organization.',
    scopeTraversal: 'project_direct',
    traversalDirection: 'reverse'
  },
  governs: {
    id: 'governs',
    from: 'decision',
    to: 'project',
    meaning: 'A durable decision or principle governs a project.',
    scopeTraversal: 'project_direct',
    traversalDirection: 'forward'
  },
  supersedes: {
    id: 'supersedes',
    from: 'decision',
    to: 'decision',
    meaning: 'A durable decision explicitly supersedes another decision.',
    scopeTraversal: 'project_transitive',
    traversalDirection: 'forward'
  }
} as const satisfies Record<CoreRelation, CanonicalRelationDefinition>;

export const canonicalRelationRegistry: Readonly<Record<CoreRelation, Readonly<CanonicalRelationDefinition>>> = deepFreeze(definitions);

export function getCanonicalRelation(relation: string): Readonly<CanonicalRelationDefinition> {
  const definition = canonicalRelationRegistry[relation as CoreRelation];
  if (!definition) {
    throw new Error(`ONTOLOGY-RELATION-UNKNOWN: unsupported canonical relation ${JSON.stringify(relation)}`);
  }
  return definition;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}
