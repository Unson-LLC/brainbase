import { randomUUID } from 'node:crypto';

const AUDIENCES = new Set(['personal', 'team', 'organization']);
const CONTENT_TYPES = new Set(['canonical_fact', 'team_document', 'source_document', 'personal_knowledge', 'operational_state', 'unknown']);

const ALLOWED_AUDIENCES = {
    canonical_fact: new Set(['team', 'organization']),
    team_document: new Set(['team', 'organization']),
    source_document: new Set(['team', 'organization']),
    personal_knowledge: new Set(['personal']),
    operational_state: new Set(['personal', 'team', 'organization']),
    unknown: AUDIENCES
};

const ROUTES = {
    canonical_fact: { source_class: 'graph', retrieval_capability: 'graph.search' },
    team_document: { source_class: 'owning_repo', retrieval_capability: 'repository.read' },
    source_document: { source_class: 'team_drive', retrieval_capability: 'drive.read' },
    personal_knowledge: { source_class: 'personal_kg', retrieval_capability: 'personal_kg.search' },
    operational_state: { source_class: 'workspace_home', retrieval_capability: 'workspace.inspect' }
};

function requiredString(value, name) {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`);
    return value.trim();
}

function routeOrder(input) {
    if (input.audience === 'personal') return ['personal_kg', 'owning_repo', 'graph', 'team_drive'];
    if (input.project_code) return ['owning_repo', 'graph', 'team_drive'];
    return ['graph', 'owning_repo', 'team_drive'];
}

function excludedSources(selected, audience) {
    const reasons = {
        wiki: 'Wiki is a migration compatibility surface, not a canonical destination.',
        graph: 'Graph stores canonical entities, terms, and decisions rather than document bodies.',
        owning_repo: 'Repository stores reviewed team documents, not raw source assets.',
        team_drive: 'Drive stores source files and large assets, not reviewed team knowledge.',
        personal_kg: audience === 'personal'
            ? 'Personal KG is only selected for personal cognitive knowledge.'
            : 'Personal KG is owner-only and cannot be the source of team knowledge.',
        workspace_home: 'Workspace home is for runtime state, not durable knowledge.'
    };
    return Object.entries(reasons)
        .filter(([source]) => source !== selected)
        .map(([source_class, reason]) => ({ source_class, reason }));
}

function canonicalLocation(route, input) {
    if (route.source_class === 'owning_repo') {
        return {
            repository: input.project_code ? `project:${input.project_code}` : null,
            path: 'docs/'
        };
    }
    if (route.source_class === 'graph') return { scope: input.project_code || 'organization', entity_types: ['person', 'organization', 'project', 'term', 'decision'] };
    if (route.source_class === 'team_drive') return { drive_scope: input.project_code || 'organization', file_id: null };
    if (route.source_class === 'personal_kg') return { owner_scope: 'authenticated_owner' };
    return { workspace_scope: input.project_code || 'current_project' };
}

export class KnowledgeResolutionService {
    constructor({ now = () => new Date(), id = () => `kr_${randomUUID()}` } = {}) {
        this.now = now;
        this.id = id;
    }

    resolve(rawInput = {}) {
        const input = {
            ...rawInput,
            intent: requiredString(rawInput.intent, 'intent'),
            audience: requiredString(rawInput.audience, 'audience'),
            content_type: requiredString(rawInput.content_type, 'content_type')
        };
        if (!AUDIENCES.has(input.audience)) throw new TypeError(`audience must be one of: ${[...AUDIENCES].join(', ')}`);
        if (!CONTENT_TYPES.has(input.content_type)) throw new TypeError(`content_type must be one of: ${[...CONTENT_TYPES].join(', ')}`);
        if (!ALLOWED_AUDIENCES[input.content_type].has(input.audience)) {
            throw new TypeError(`content_type=${input.content_type} is not valid for audience=${input.audience}`);
        }

        const base = {
            resolution_id: this.id(), resolved_at: this.now().toISOString(),
            project_code: input.project_code || null, content_type: input.content_type,
            searched_scope: [], absence_confirmed: false
        };
        const route = ROUTES[input.content_type];
        if (!route) {
            const candidates = routeOrder(input);
            return {
                ...base, status: 'unconfirmed', source_class: null, canonical_location: null,
                retrieval_capability: null, excluded_sources: excludedSources(null, input.audience),
                not_searched: candidates, next_route: candidates[0], confidence: 0,
                rationale: 'The structured content type is unknown; no source was searched and absence is not confirmed.'
            };
        }

        return {
            ...base, status: 'resolved', source_class: route.source_class,
            canonical_location: canonicalLocation(route, input),
            retrieval_capability: route.retrieval_capability,
            excluded_sources: excludedSources(route.source_class, input.audience),
            not_searched: [], next_route: route.source_class, confidence: 0.95,
            rationale: `content_type=${input.content_type} deterministically maps to ${route.source_class}.`
        };
    }
}
