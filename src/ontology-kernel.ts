// Moved from brainbase-unson server/services/ontology-kernel.js without changing behavior.
// Only type annotations were added; values stay open JSON objects as in the original.
/* eslint-disable @typescript-eslint/no-explicit-any */
const REQUIRED_MANIFEST_KEYS = [
    'version',
    'initial_status',
    'effective_at',
    'entity_types',
    'relation_types',
    'constraints',
    'inference_rules',
    'evolution_rules',
    'previous_version',
    'compatibility',
    'migration',
    'rollback',
    'governance',
    'impact_scope',
    'changes'
];
const REQUIRED_TYPE_FIELDS = ['description', 'identity', 'usage', 'examples', 'counter_examples', 'owner'];
const REQUIRED_RELATION_FIELDS = ['from', 'to', 'direction', 'cardinality', 'lifecycle', 'provenance'];
export const DECISION_STATUS_RULE_ID = 'CON-DECISION-STATUS-001';

export class OntologyError extends Error {
    // Fields are assigned in the constructor exactly as in the original module.
    [key: string]: any;
    constructor(code: any, message: any, details: any = {}) {
        super(message);
        this.name = 'OntologyError';
        this.code = code;
        this.details = details;
    }
}

function violation(ruleId: any, message: any, extra: any = {}) {
    return { rule_id: ruleId, message, ...extra };
}

function matchesWhen(payload: any, when: any = {}) {
    return Object.entries<any>(when).every(([key, expected]: any) => {
        const actual = payload?.[key];
        return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
    });
}

function assertManifest(manifest: any) {
    const missing = REQUIRED_MANIFEST_KEYS.filter((key: any) => !Object.hasOwn(manifest || {}, key));
    if (missing.length) {
        throw new OntologyError('ONTOLOGY_MANIFEST_INVALID', `Ontology manifest is missing: ${missing.join(', ')}`, { missing });
    }
    if (!Object.keys(manifest.entity_types).length || !Object.keys(manifest.relation_types).length) {
        throw new OntologyError('ONTOLOGY_MANIFEST_INVALID', 'Ontology manifest vocabulary must not be empty');
    }
    const invalidTypes = Object.entries<any>(manifest.entity_types)
        .filter(([, definition]: any) => REQUIRED_TYPE_FIELDS.some((field: any) => definition[field] == null))
        .map(([id]: any) => id);
    const invalidRelations = Object.entries<any>(manifest.relation_types)
        .filter(([, definition]: any) => REQUIRED_RELATION_FIELDS.some((field: any) => definition[field] == null)
            || (definition.inverse === undefined && definition.symmetric === undefined))
        .map(([id]: any) => id);
    if (invalidTypes.length || invalidRelations.length) {
        throw new OntologyError('ONTOLOGY_MANIFEST_INVALID', 'Ontology vocabulary metadata is incomplete', {
            invalid_types: invalidTypes,
            invalid_relations: invalidRelations
        });
    }
    if (!Array.isArray(manifest.changes)
        || !['initial', 'backward_compatible', 'breaking'].includes(manifest.compatibility?.classification)
        || typeof manifest.migration?.required !== 'boolean'
        || typeof manifest.rollback?.strategy !== 'string'
        || !manifest.governance || typeof manifest.governance !== 'object') {
        throw new OntologyError('ONTOLOGY_MANIFEST_INVALID', 'Ontology release governance metadata is incomplete');
    }
}

export class OntologyKernel {
    // Fields are assigned in the constructor exactly as in the original module.
    [key: string]: any;
    constructor({ manifest, status = null }: any) {
        assertManifest(manifest);
        this.manifest = structuredClone(manifest);
        this.status = status || manifest.initial_status;
    }

    get version() {
        return this.manifest.version;
    }

    describe() {
        return { ...structuredClone(this.manifest), effective_status: this.status };
    }

    getType(type: any) {
        const definition = this.manifest.entity_types[type];
        if (!definition) {
            throw new OntologyError('ONTOLOGY_TYPE_UNKNOWN', `Unknown ontology type: ${type}`, { rule_id: 'entity-type-registered', type });
        }
        return structuredClone(definition);
    }

    getRelation(relation: any) {
        const definition = this.manifest.relation_types[relation];
        if (!definition) {
            throw new OntologyError('ONTOLOGY_RELATION_UNKNOWN', `Unknown ontology relation: ${relation}`, { rule_id: 'relation-type-registered', relation });
        }
        return structuredClone(definition);
    }

    validateEntity(entity: any, { deferRequiredRelations = false }: any = {}) {
        const violations = [];
        if (!entity?.id) violations.push(violation('entity-id-required', 'Entity id is required'));
        const type = entity?.type || entity?.entity_type;
        if (!this.manifest.entity_types[type]) {
            violations.push(violation('entity-type-registered', `Unknown ontology type: ${type}`, { entity_id: entity?.id, type }));
        }
        // A Decision without an explicit status cannot be evaluated against the
        // conditional relation constraints below. Keep this invariant in the
        // kernel so every release, including older signed manifests, rejects a
        // status omission instead of treating it as an inactive Decision.
        if (type === 'decision') {
            const status = entity?.payload?.status;
            if (typeof status !== 'string' || status.trim() === '') {
                violations.push(violation(
                    DECISION_STATUS_RULE_ID,
                    'Decision requires an explicit status',
                    { entity_id: entity?.id, missing_fields: ['status'] }
                ));
            }
        }
        for (const rule of this.manifest.constraints) {
            if (rule.target !== type || rule.kind !== 'required_fields_when') continue;
            const matches = matchesWhen(entity?.payload, rule.when);
            if (!matches) continue;
            const missingFields = rule.fields.filter((field: any) => {
                const value = entity?.payload?.[field];
                return value == null || value === '' || (Array.isArray(value) && value.length === 0);
            });
            if (missingFields.length) {
                violations.push(violation(rule.id, `Missing required fields: ${missingFields.join(', ')}`, {
                    entity_id: entity?.id,
                    missing_fields: missingFields
                }));
            }
        }
        if (!deferRequiredRelations) {
            for (const rule of this.manifest.constraints) {
                if (rule.target !== type || !['required_relation', 'required_relation_when'].includes(rule.kind)) continue;
                if (rule.kind === 'required_relation_when' && !matchesWhen(entity?.payload, rule.when)) continue;
                violations.push(violation(rule.id, rule.message || `${type} requires relation evidence in an aggregate snapshot`, {
                    entity_id: entity?.id,
                    aggregate_required: true
                }));
            }
        }
        return { valid: violations.length === 0, ontology_version: this.version, violations };
    }

    validateEdge(edge: any) {
        const relation = edge?.relation || edge?.rel_type;
        const definition = this.manifest.relation_types[relation];
        if (!definition) {
            return {
                valid: false,
                ontology_version: this.version,
                violations: [violation('relation-type-registered', `Unknown ontology relation: ${relation}`, { relation })]
            };
        }
        const fromType = edge?.from_type;
        const toType = edge?.to_type;
        const validEndpoint = definition.from.includes(fromType) && definition.to.includes(toType);
        return {
            valid: validEndpoint,
            ontology_version: this.version,
            violations: validEndpoint ? [] : [violation(`relation-endpoint-${relation}`, `Invalid ${relation} endpoint`, {
                relation,
                from_type: fromType,
                to_type: toType
            })]
        };
    }

    /**
     * Which persisted edges validateSnapshot needs in order to judge a
     * mutation. Only two rules read existing edges: relation cardinality
     * (same relation, same constrained endpoint as a mutation edge) and
     * required relations (the listed relations, in their direction, from a
     * validated entity of the rule's target type). Every other persisted
     * edge cannot change the verdict for this mutation.
     *
     * @returns {{ relation: string, endpoint: 'from_id'|'to_id', ids: string[] }[]}
     */
    mutationEdgeScope({ mutationEdges = [], validationEntities = [] }: any = {}) {
        const groups = new Map<any, any>();
        const add = (relation: any, endpoint: any, id: any) => {
            if (!relation || !id) return;
            const key = `${relation}\u0000${endpoint}`;
            if (!groups.has(key)) groups.set(key, { relation, endpoint, ids: new Set() });
            groups.get(key).ids.add(id);
        };
        for (const edge of mutationEdges) {
            const relation = edge?.relation || edge?.rel_type;
            const cardinality = this.manifest.relation_types[relation]?.cardinality;
            if (cardinality === 'many_to_one' || cardinality === 'one_to_one') add(relation, 'from_id', edge.from_id);
            if (cardinality === 'one_to_many' || cardinality === 'one_to_one') add(relation, 'to_id', edge.to_id);
        }
        for (const rule of this.manifest.constraints) {
            if (!['required_relation', 'required_relation_when'].includes(rule.kind)) continue;
            const alternatives = rule.alternatives || [{ relation: rule.relation, direction: 'outgoing' }];
            for (const entity of validationEntities) {
                if ((entity?.type || entity?.entity_type) !== rule.target) continue;
                for (const alternative of alternatives) {
                    add(alternative.relation, alternative.direction === 'incoming' ? 'to_id' : 'from_id', entity.id);
                }
            }
        }
        return Array.from(groups.values(), (group: any) => ({ ...group, ids: Array.from(group.ids).sort() }));
    }

    validateSnapshot(snapshot: any, _adapters: any = {}) {
        const entities = snapshot?.entities || [];
        const edges = snapshot?.edges || [];
        const byId = new Map<any, any>(entities.map((entity: any) => [entity.id, entity]));
        const validationEntityIds = Array.isArray(snapshot?.validation_entity_ids)
            ? new Set(snapshot.validation_entity_ids)
            : null;
        const validationEntities = validationEntityIds
            ? entities.filter((entity: any) => validationEntityIds.has(entity.id))
            : entities;
        const requiredRelationValidationEntityIds = Array.isArray(snapshot?.required_relation_validation_entity_ids)
            ? new Set(snapshot.required_relation_validation_entity_ids)
            : validationEntityIds;
        const requiredRelationValidationEntities = requiredRelationValidationEntityIds
            ? entities.filter((entity: any) => requiredRelationValidationEntityIds.has(entity.id))
            : entities;
        const violations = validationEntities.flatMap((entity: any) => this.validateEntity(entity, { deferRequiredRelations: true }).violations);
        for (const edge of edges) {
            const from = byId.get(edge.from_id);
            const to = byId.get(edge.to_id);
            if (!from || !to) {
                violations.push(violation('edge-reference-integrity', 'Edge endpoints must reference entities in the snapshot', {
                    edge_id: edge.id || null,
                    missing_endpoint_ids: [!from ? edge.from_id : null, !to ? edge.to_id : null].filter(Boolean)
                }));
                continue;
            }
            violations.push(...this.validateEdge({ ...edge, from_type: edge.from_type || from?.type, to_type: edge.to_type || to?.type }).violations);
        }
        for (const [relation, definition] of Object.entries<any>(this.manifest.relation_types)) {
            if (!['many_to_one', 'one_to_many', 'one_to_one'].includes(definition.cardinality)) continue;
            const relationEdges = edges.filter((edge: any) => (edge.relation || edge.rel_type) === relation);
            const constrainedSides = definition.cardinality === 'many_to_one'
                ? [['from_id', 'outgoing']]
                : definition.cardinality === 'one_to_many'
                    ? [['to_id', 'incoming']]
                    : [['from_id', 'outgoing'], ['to_id', 'incoming']];
            for (const [endpoint, direction] of constrainedSides) {
                const counts = new Map<any, any>();
                for (const edge of relationEdges) counts.set(edge[endpoint], (counts.get(edge[endpoint]) || 0) + 1);
                for (const [entityId, count] of counts) {
                    if (count <= 1) continue;
                    violations.push(violation(`relation-cardinality-${relation}`, `${relation} permits at most one ${direction} edge`, {
                        relation,
                        entity_id: entityId,
                        direction,
                        count,
                        cardinality: definition.cardinality
                    }));
                }
            }
        }
        for (const rule of this.manifest.constraints) {
            if (!['required_relation', 'required_relation_when'].includes(rule.kind)) continue;
            for (const entity of requiredRelationValidationEntities.filter((item: any) => (item.type || item.entity_type) === rule.target)) {
                if (rule.kind === 'required_relation_when' && !matchesWhen(entity.payload, rule.when)) continue;
                const alternatives = rule.alternatives || [{ relation: rule.relation, direction: 'outgoing' }];
                const hasRelation = alternatives.some((alternative: any) => edges.some((edge: any) => {
                    const endpointId = alternative.direction === 'incoming' ? edge.to_id : edge.from_id;
                    if (endpointId !== entity.id || (edge.relation || edge.rel_type) !== alternative.relation) return false;
                    if (!Array.isArray(rule.related_types) || rule.related_types.length === 0) return true;
                    const relatedId = alternative.direction === 'incoming' ? edge.from_id : edge.to_id;
                    const related = byId.get(relatedId);
                    return related && rule.related_types.includes(related.type || related.entity_type);
                }));
                if (!hasRelation) {
                    violations.push(violation(rule.id, rule.message || `${rule.target} requires relation evidence`, { entity_id: entity.id }));
                }
            }
        }
        if (snapshot?.complete === false) {
            violations.push(violation('snapshot-incomplete', 'Snapshot is incomplete; absence cannot be verified'));
        }
        return {
            valid: violations.length === 0,
            verification: snapshot?.complete === false ? 'unverified' : 'verified',
            ontology_version: this.version,
            violations
        };
    }

    inferDecisions(snapshot: any, { derivedAt }: any = {}) {
        const asOf = snapshot?.as_of || new Date().toISOString();
        const derived_at = derivedAt || snapshot?.derived_at || new Date().toISOString();
        const decisions = Object.fromEntries((snapshot?.entities || [])
            .filter((entity: any) => (entity.type || entity.entity_type) === 'decision')
            .map((entity: any) => [entity.id, { ...entity.payload, explicit: true, inferred: false }]));
        const evidence = [];
        const supersessionRule = this.manifest.inference_rules.find((rule: any) => rule.relation === 'supersedes');
        const effectiveStatuses = new Set(supersessionRule?.effective_statuses || ['active']);
        const isEffectiveSupersession = (edge: any) => {
            if ((edge.relation || edge.rel_type) !== 'supersedes') return false;
            const replacement = decisions[edge.from_id];
            if (!replacement || !decisions[edge.to_id] || !effectiveStatuses.has(replacement.status)) return false;
            const asOfTime = Date.parse(asOf);
            return [edge.effective_at, replacement.effective_at]
                .filter(Boolean)
                .every((effectiveAt: any) => Date.parse(effectiveAt) <= asOfTime);
        };
        for (const edge of snapshot?.edges || []) {
            if (!isEffectiveSupersession(edge)) continue;
            const replacement = decisions[edge.from_id];
            decisions[edge.to_id] = { ...decisions[edge.to_id], status: 'superseded', inferred: true };
            evidence.push({ rule_id: supersessionRule?.id || 'decision-supersession', from_id: edge.from_id, to_id: edge.to_id });
        }
        const explicitSupersessions = new Set((snapshot?.edges || [])
            .filter(isEffectiveSupersession)
            .flatMap((edge: any) => [`${edge.from_id}:${edge.to_id}`, `${edge.to_id}:${edge.from_id}`]));
        const scopesByDecision = new Map<any, any>(Object.entries<any>(decisions).map(([id, decision]: any) => [
            id,
            new Set(Array.isArray(decision.scope_ids) ? decision.scope_ids : [])
        ]));
        const entitiesById = new Map<any, any>((snapshot?.entities || []).map((entity: any) => [entity.id, entity]));
        for (const edge of snapshot?.edges || []) {
            if ((edge.relation || edge.rel_type) !== 'belongs_to_project' || !scopesByDecision.has(edge.from_id)) continue;
            const scope = entitiesById.get(edge.to_id);
            if (!scope || (scope.type || scope.entity_type) !== 'project') continue;
            scopesByDecision.get(edge.from_id).add(edge.to_id);
        }
        const activeIds = Object.entries<any>(decisions)
            .filter(([, decision]: any) => effectiveStatuses.has(decision.status))
            .map(([id]: any) => id);
        for (let leftIndex = 0; leftIndex < activeIds.length; leftIndex += 1) {
            for (let rightIndex = leftIndex + 1; rightIndex < activeIds.length; rightIndex += 1) {
                const leftId = activeIds[leftIndex];
                const rightId = activeIds[rightIndex];
                const leftScopes = scopesByDecision.get(leftId) || new Set();
                const rightScopes = scopesByDecision.get(rightId) || new Set();
                const overlaps = [...leftScopes].some((scope: any) => rightScopes.has(scope));
                if (!overlaps || explicitSupersessions.has(`${leftId}:${rightId}`)) continue;
                decisions[leftId] = { ...decisions[leftId], status: 'conflict', inferred: true };
                decisions[rightId] = { ...decisions[rightId], status: 'conflict', inferred: true };
                evidence.push({ rule_id: 'decision-active-conflict', decision_ids: [leftId, rightId] });
            }
        }
        const explanation = evidence.length
            ? evidence.map((item: any) => item.decision_ids
                ? `${item.decision_ids.join(' and ')} conflict`
                : `${item.from_id} supersedes ${item.to_id}`).join('; ')
            : 'No decision supersession was inferred';
        return { ontology_version: this.version, as_of: asOf, derived_at, decisions, evidence, explanation };
    }

    impact({ change = {}, snapshot = null }: any) {
        const kind = change.kind || 'editorial';
        const semver = kind.startsWith('remove_') || kind === 'narrow_endpoint'
            ? this.manifest.evolution_rules.breaking
            : kind.startsWith('add_')
                ? this.manifest.evolution_rules.additive
                : this.manifest.evolution_rules.editorial;
        if (!snapshot) {
            return {
                ontology_version: this.version,
                semver,
                verification: 'unverified',
                match_count: null,
                representative_ids: [],
                affected_apis: change.affected_apis || [],
                affected_agents: change.affected_agents || [],
                migration_required: semver === 'major',
                history_required: this.manifest.evolution_rules.history_required_for.includes(kind)
            };
        }
        const entityIds = (snapshot.entities || [])
            .filter((entity: any) => !change.type || (entity.type || entity.entity_type) === change.type)
            .map((entity: any) => entity.id);
        const edgeIds = (snapshot.edges || [])
            .filter((edge: any) => !change.relation || (edge.relation || edge.rel_type) === change.relation)
            .map((edge: any) => edge.id || `${edge.from_id}:${edge.relation || edge.rel_type}:${edge.to_id}`);
        let ids = change.relation ? edgeIds : entityIds;
        if (change.rule_id) {
            const rule = [...this.manifest.constraints, ...this.manifest.inference_rules]
                .find((candidate: any) => candidate.id === change.rule_id);
            if (!rule) {
                throw new OntologyError('ONTOLOGY_RULE_UNKNOWN', `Unknown ontology rule: ${change.rule_id}`);
            }
            ids = rule.relation
                ? (snapshot.edges || []).filter((edge: any) => (edge.relation || edge.rel_type) === rule.relation)
                    .map((edge: any) => edge.id || `${edge.from_id}:${edge.relation || edge.rel_type}:${edge.to_id}`)
                : (snapshot.entities || []).filter((entity: any) => !rule.target || (entity.type || entity.entity_type) === rule.target)
                    .map((entity: any) => entity.id);
        }
        return {
            ontology_version: this.version,
            semver,
            verification: 'verified',
            match_count: ids.length,
            representative_ids: ids.slice(0, 10),
            affected_apis: change.affected_apis || [],
            affected_agents: change.affected_agents || [],
            migration_required: semver === 'major',
            history_required: this.manifest.evolution_rules.history_required_for.includes(kind)
        };
    }

    planEvolution(change: any = {}) {
        const kind = change.kind;
        if (!this.manifest.evolution_rules.history_required_for.includes(kind)) {
            throw new OntologyError('ONTOLOGY_EVOLUTION_KIND_INVALID', `Evolution kind does not require identity history: ${kind}`);
        }
        const required = ['canonical_id', 'source_ids', 'effective_at'];
        const missing = required.filter((field: any) => !change[field]
            || (field === 'source_ids' && (!Array.isArray(change[field]) || change[field].length === 0)));
        if (missing.length) {
            throw new OntologyError('ONTOLOGY_EVOLUTION_HISTORY_REQUIRED', `Evolution history is missing: ${missing.join(', ')}`, { missing });
        }
        return {
            event_id: change.event_id || `ontology:${kind}:${change.canonical_id}:${change.effective_at}`,
            event_type: `ontology_${kind}`,
            ontology_version: this.version,
            canonical_id: change.canonical_id,
            source_ids: [...new Set(change.source_ids)],
            aliases: kind === 'rename' ? [...new Set(change.source_ids)] : [],
            provenance: change.provenance || [],
            effective_at: change.effective_at,
            conflict_policy: change.conflict_policy || 'explicit_decision_required'
        };
    }

    interpretHistory(snapshot: any = {}, { asOf }: any = {}) {
        const interpretationTime = asOf || snapshot.as_of;
        if (!interpretationTime || !Number.isFinite(Date.parse(interpretationTime))) {
            throw new OntologyError('ONTOLOGY_HISTORY_AS_OF_REQUIRED', 'A valid as_of timestamp is required for historical interpretation');
        }
        const events = (snapshot.evolution_events || [])
            .filter((event: any) => Date.parse(event.effective_at) <= Date.parse(interpretationTime))
            .sort((left: any, right: any) => Date.parse(left.effective_at) - Date.parse(right.effective_at));
        const canonicalById = new Map<any, any>();
        const provenanceById = new Map<any, any>();
        for (const event of events) {
            for (const sourceId of event.source_ids || []) {
                if (canonicalById.has(sourceId) && canonicalById.get(sourceId) !== event.canonical_id) {
                    throw new OntologyError('ONTOLOGY_EVOLUTION_CONFLICT', `Multiple active evolution targets exist for ${sourceId}`, {
                        source_id: sourceId,
                        canonical_ids: [canonicalById.get(sourceId), event.canonical_id]
                    });
                }
                canonicalById.set(sourceId, event.canonical_id);
                provenanceById.set(sourceId, [...(event.provenance || [])]);
            }
        }
        const resolveId = (id: any) => {
            const seen = new Set();
            let current = id;
            const provenance = [];
            while (canonicalById.has(current)) {
                if (seen.has(current)) {
                    throw new OntologyError('ONTOLOGY_EVOLUTION_CYCLE', `Evolution history contains a cycle from ${id}`, {
                        source_id: id,
                        cycle_at: current
                    });
                }
                seen.add(current);
                provenance.push(...(provenanceById.get(current) || []));
                current = canonicalById.get(current);
            }
            return { canonical_id: current, provenance: [...new Set(provenance)] };
        };
        return {
            ontology_version: this.version,
            as_of: interpretationTime,
            applied_event_ids: events.map((event: any) => event.event_id),
            entities: (snapshot.entities || []).map((entity: any) => {
                const interpretation = resolveId(entity.id);
                return {
                    ...structuredClone(entity),
                    historical_id: entity.id,
                    canonical_id: interpretation.canonical_id,
                    evolution_provenance: interpretation.provenance
                };
            }),
            edges: (snapshot.edges || []).map((edge: any) => {
                const from = resolveId(edge.from_id);
                const to = resolveId(edge.to_id);
                return {
                    ...structuredClone(edge),
                    historical_from_id: edge.from_id,
                    historical_to_id: edge.to_id,
                    from_id: from.canonical_id,
                    to_id: to.canonical_id,
                    evolution_provenance: [...new Set([...from.provenance, ...to.provenance])]
                };
            })
        };
    }
}

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const BUMP_RANK: Record<string, number> = { patch: 1, minor: 2, major: 3 };
const CARDINALITY_ORDER = ['one_to_one', 'many_to_one', 'one_to_many', 'many_to_many'];

function parseSemver(version: any) {
    const match = SEMVER_PATTERN.exec(String(version || ''));
    return match ? match.slice(1).map(Number) : null;
}

function declaredBump(baseVersion: any, nextVersion: any) {
    const base = parseSemver(baseVersion);
    const next = parseSemver(nextVersion);
    if (!base || !next) return null;
    if (next[0] !== base[0]) return next[0] > base[0] && next[1] === 0 && next[2] === 0 ? 'major' : null;
    if (next[1] !== base[1]) return next[1] > base[1] && next[2] === 0 ? 'minor' : null;
    return next[2] > base[2] ? 'patch' : null;
}

function plainObject(value: any) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function relationNarrows(before: any, after: any) {
    const lost = (key: any) => (before[key] || []).some((type: any) => !(after[key] || []).includes(type));
    const cardinalityTightened = CARDINALITY_ORDER.includes(before.cardinality)
        && CARDINALITY_ORDER.includes(after.cardinality)
        && CARDINALITY_ORDER.indexOf(after.cardinality) < CARDINALITY_ORDER.indexOf(before.cardinality);
    return lost('from') || lost('to') || cardinalityTightened;
}

function applyVocabularyChanges(target: any, changeSet: any, kind: any, classify: any) {
    const upsert = changeSet?.upsert ?? {};
    const remove = changeSet?.remove ?? [];
    if (!plainObject(upsert) || !Array.isArray(remove)) {
        throw new OntologyError('ONTOLOGY_PROPOSAL_INVALID', `${kind} changes must be { upsert: object, remove: string[] }`, { http_status: 400 });
    }
    for (const id of remove) {
        if (!Object.hasOwn(target, id)) {
            throw new OntologyError('ONTOLOGY_PROPOSAL_INVALID', `Cannot remove unknown ${kind}: ${id}`, { http_status: 400 });
        }
        delete target[id];
        classify('major', `remove ${kind} ${id}`);
    }
    for (const [id, definition] of Object.entries<any>(upsert)) {
        if (!plainObject(definition)) {
            throw new OntologyError('ONTOLOGY_PROPOSAL_INVALID', `${kind} ${id} definition must be an object`, { http_status: 400 });
        }
        const previous = target[id];
        target[id] = structuredClone(definition);
        if (!previous) classify('minor', `add ${kind} ${id}`);
        else if (kind === 'relation' && relationNarrows(previous, definition)) classify('major', `narrow relation ${id}`);
        else if (kind === 'relation' && (['from', 'to'].some((key: any) => (definition[key] || []).length > (previous[key] || []).length))) {
            classify('minor', `widen relation ${id}`);
        } else classify('patch', `update ${kind} ${id}`);
    }
}

function applyRuleChanges(rules: any, changeSet: any, kind: any, classify: any) {
    const upsert = changeSet?.upsert ?? [];
    const remove = changeSet?.remove ?? [];
    if (!Array.isArray(upsert) || !Array.isArray(remove)) {
        throw new OntologyError('ONTOLOGY_PROPOSAL_INVALID', `${kind} changes must be { upsert: object[], remove: string[] }`, { http_status: 400 });
    }
    let next = rules.map((rule: any) => structuredClone(rule));
    for (const id of remove) {
        if (!next.some((rule: any) => rule.id === id)) {
            throw new OntologyError('ONTOLOGY_PROPOSAL_INVALID', `Cannot remove unknown ${kind}: ${id}`, { http_status: 400 });
        }
        next = next.filter((rule: any) => rule.id !== id);
        classify('minor', `remove ${kind} ${id}`);
    }
    for (const rule of upsert) {
        if (!plainObject(rule) || typeof rule.id !== 'string' || !rule.id.trim()) {
            throw new OntologyError('ONTOLOGY_PROPOSAL_INVALID', `${kind} entries require a string id`, { http_status: 400 });
        }
        const index = next.findIndex((candidate: any) => candidate.id === rule.id);
        // A new or changed rule can reject existing data, so it is classified
        // as additive here and the data impact decides whether migration is needed.
        classify('minor', `${index === -1 ? 'add' : 'update'} ${kind} ${rule.id}`);
        if (index === -1) next.push(structuredClone(rule));
        else next[index] = structuredClone(rule);
    }
    return next;
}

function consistencyViolations(manifest: any) {
    const types = new Set(Object.keys(manifest.entity_types));
    const relations = new Set(Object.keys(manifest.relation_types));
    const violations = [];
    for (const [id, definition] of Object.entries<any>(manifest.relation_types)) {
        for (const side of ['from', 'to']) {
            for (const type of definition[side] || []) {
                if (!types.has(type)) violations.push(violation('relation-endpoint-type-registered', `Relation ${id} ${side} references unknown type ${type}`, { relation: id, type }));
            }
        }
        if (definition.inverse && !relations.has(definition.inverse)) {
            violations.push(violation('relation-inverse-registered', `Relation ${id} inverse ${definition.inverse} is not registered`, { relation: id }));
        }
    }
    for (const rule of [...manifest.constraints, ...manifest.inference_rules]) {
        if (rule.target && !types.has(rule.target)) {
            violations.push(violation('rule-target-registered', `Rule ${rule.id} targets unknown type ${rule.target}`, { rule_id_ref: rule.id }));
        }
        for (const type of rule.related_types || []) {
            if (!types.has(type)) violations.push(violation('rule-related-type-registered', `Rule ${rule.id} references unknown type ${type}`, { rule_id_ref: rule.id }));
        }
        for (const relation of [rule.relation, ...(rule.alternatives || []).map((item: any) => item.relation)].filter(Boolean)) {
            if (!relations.has(relation)) violations.push(violation('rule-relation-registered', `Rule ${rule.id} references unknown relation ${relation}`, { rule_id_ref: rule.id }));
        }
    }
    const ruleIds = [...manifest.constraints, ...manifest.inference_rules].map((rule: any) => rule.id);
    for (const id of ruleIds.filter((ruleId: any, index: any) => ruleIds.indexOf(ruleId) !== index)) {
        violations.push(violation('rule-id-unique', `Rule id ${id} is duplicated`, { rule_id_ref: id }));
    }
    return violations;
}

/**
 * Build an immutable Ontology release candidate from a base release and a
 * change set. The result is a dry-run artifact: it is never written here and
 * becomes current only through the RACI-authorized publisher (ADR-021).
 */
export function buildOntologyReleaseCandidate(baseManifest: any, proposal: any = {}) {
    const nextVersion = String(proposal.next_version || '').trim();
    const summary = Array.isArray(proposal.summary)
        ? proposal.summary.filter((line: any) => typeof line === 'string' && line.trim()).map((line: any) => line.trim())
        : [];
    if (!parseSemver(nextVersion)) {
        throw new OntologyError('ONTOLOGY_PROPOSAL_INVALID', 'next_version must be a semantic version', { http_status: 400 });
    }
    if (!summary.length) {
        throw new OntologyError('ONTOLOGY_PROPOSAL_INVALID', 'summary must describe the change in at least one line', { http_status: 400 });
    }
    const changes = plainObject(proposal.changes) ? proposal.changes : {};
    const reasons: any[] = [];
    let requiredBump = 'patch';
    const classify = (bump: any, reason: any) => {
        reasons.push({ bump, reason });
        if (BUMP_RANK[bump] > BUMP_RANK[requiredBump]) requiredBump = bump;
    };
    const candidate = structuredClone(baseManifest);
    applyVocabularyChanges(candidate.entity_types, changes.entity_types, 'type', classify);
    applyVocabularyChanges(candidate.relation_types, changes.relation_types, 'relation', classify);
    candidate.constraints = applyRuleChanges(candidate.constraints, changes.constraints, 'constraint', classify);
    candidate.inference_rules = applyRuleChanges(candidate.inference_rules, changes.inference_rules, 'inference_rule', classify);
    if (!reasons.length) {
        throw new OntologyError('ONTOLOGY_PROPOSAL_INVALID', 'The change set does not change the release', { http_status: 400 });
    }
    const breaking = requiredBump === 'major';
    candidate.version = nextVersion;
    candidate.previous_version = baseManifest.version;
    candidate.initial_status = 'proposed';
    candidate.effective_at = typeof proposal.effective_at === 'string' && proposal.effective_at.trim()
        ? proposal.effective_at.trim()
        : new Date().toISOString();
    candidate.compatibility = breaking
        ? { classification: 'breaking' }
        : { classification: 'backward_compatible', compatible_from: baseManifest.version };
    candidate.migration = { required: breaking, plan: typeof proposal.migration_plan === 'string' ? proposal.migration_plan : null };
    candidate.rollback = { strategy: 'restore_previous_current', target_version: baseManifest.version };
    candidate.governance = plainObject(proposal.governance) ? structuredClone(proposal.governance) : {};
    candidate.changes = summary;
    const declared = declaredBump(baseManifest.version, nextVersion);
    return {
        candidate,
        required_bump: requiredBump,
        declared_bump: declared,
        semver_ok: declared !== null && BUMP_RANK[declared] >= BUMP_RANK[requiredBump],
        change_classification: reasons,
        consistency_violations: consistencyViolations(candidate)
    };
}
