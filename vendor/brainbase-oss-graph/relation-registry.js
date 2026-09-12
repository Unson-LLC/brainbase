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
};
export const canonicalRelationRegistry = deepFreeze(definitions);
export function getCanonicalRelation(relation) {
    const definition = canonicalRelationRegistry[relation];
    if (!definition) {
        throw new Error(`ONTOLOGY-RELATION-UNKNOWN: unsupported canonical relation ${JSON.stringify(relation)}`);
    }
    return definition;
}
function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const nested of Object.values(value))
            deepFreeze(nested);
    }
    return value;
}
