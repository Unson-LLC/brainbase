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

export class OntologyError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'OntologyError';
        this.code = code;
        this.details = details;
    }
}

function violation(ruleId, message, extra = {}) {
    return { rule_id: ruleId, message, ...extra };
}

function matchesWhen(payload, when = {}) {
    return Object.entries(when).every(([key, expected]) => {
        const actual = payload?.[key];
        return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
    });
}

function assertManifest(manifest) {
    const missing = REQUIRED_MANIFEST_KEYS.filter((key) => !Object.hasOwn(manifest || {}, key));
    if (missing.length) {
        throw new OntologyError('ONTOLOGY_MANIFEST_INVALID', `Ontology manifest is missing: ${missing.join(', ')}`, { missing });
    }
    if (!Object.keys(manifest.entity_types).length || !Object.keys(manifest.relation_types).length) {
        throw new OntologyError('ONTOLOGY_MANIFEST_INVALID', 'Ontology manifest vocabulary must not be empty');
    }
    const invalidTypes = Object.entries(manifest.entity_types)
        .filter(([, definition]) => REQUIRED_TYPE_FIELDS.some((field) => definition[field] == null))
        .map(([id]) => id);
    const invalidRelations = Object.entries(manifest.relation_types)
        .filter(([, definition]) => REQUIRED_RELATION_FIELDS.some((field) => definition[field] == null)
            || (definition.inverse === undefined && definition.symmetric === undefined))
        .map(([id]) => id);
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
    constructor({ manifest, status = null }) {
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

    getType(type) {
        const definition = this.manifest.entity_types[type];
        if (!definition) {
            throw new OntologyError('ONTOLOGY_TYPE_UNKNOWN', `Unknown ontology type: ${type}`, { rule_id: 'entity-type-registered', type });
        }
        return structuredClone(definition);
    }

    getRelation(relation) {
        const definition = this.manifest.relation_types[relation];
        if (!definition) {
            throw new OntologyError('ONTOLOGY_RELATION_UNKNOWN', `Unknown ontology relation: ${relation}`, { rule_id: 'relation-type-registered', relation });
        }
        return structuredClone(definition);
    }

    validateEntity(entity, { deferRequiredRelations = false } = {}) {
        const violations = [];
        if (!entity?.id) violations.push(violation('entity-id-required', 'Entity id is required'));
        const type = entity?.type || entity?.entity_type;
        if (!this.manifest.entity_types[type]) {
            violations.push(violation('entity-type-registered', `Unknown ontology type: ${type}`, { entity_id: entity?.id, type }));
        }
        for (const rule of this.manifest.constraints) {
            if (rule.target !== type || rule.kind !== 'required_fields_when') continue;
            const matches = matchesWhen(entity?.payload, rule.when);
            if (!matches) continue;
            const missingFields = rule.fields.filter((field) => {
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

    validateEdge(edge) {
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

    validateSnapshot(snapshot, _adapters = {}) {
        const entities = snapshot?.entities || [];
        const edges = snapshot?.edges || [];
        const byId = new Map(entities.map((entity) => [entity.id, entity]));
        const validationEntityIds = Array.isArray(snapshot?.validation_entity_ids)
            ? new Set(snapshot.validation_entity_ids)
            : null;
        const validationEntities = validationEntityIds
            ? entities.filter((entity) => validationEntityIds.has(entity.id))
            : entities;
        const requiredRelationValidationEntityIds = Array.isArray(snapshot?.required_relation_validation_entity_ids)
            ? new Set(snapshot.required_relation_validation_entity_ids)
            : validationEntityIds;
        const requiredRelationValidationEntities = requiredRelationValidationEntityIds
            ? entities.filter((entity) => requiredRelationValidationEntityIds.has(entity.id))
            : entities;
        const violations = validationEntities.flatMap((entity) => this.validateEntity(entity, { deferRequiredRelations: true }).violations);
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
        for (const [relation, definition] of Object.entries(this.manifest.relation_types)) {
            if (!['many_to_one', 'one_to_many', 'one_to_one'].includes(definition.cardinality)) continue;
            const relationEdges = edges.filter((edge) => (edge.relation || edge.rel_type) === relation);
            const constrainedSides = definition.cardinality === 'many_to_one'
                ? [['from_id', 'outgoing']]
                : definition.cardinality === 'one_to_many'
                    ? [['to_id', 'incoming']]
                    : [['from_id', 'outgoing'], ['to_id', 'incoming']];
            for (const [endpoint, direction] of constrainedSides) {
                const counts = new Map();
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
            for (const entity of requiredRelationValidationEntities.filter((item) => (item.type || item.entity_type) === rule.target)) {
                if (rule.kind === 'required_relation_when' && !matchesWhen(entity.payload, rule.when)) continue;
                const alternatives = rule.alternatives || [{ relation: rule.relation, direction: 'outgoing' }];
                const hasRelation = alternatives.some((alternative) => edges.some((edge) => {
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

    inferDecisions(snapshot, { derivedAt } = {}) {
        const asOf = snapshot?.as_of || new Date().toISOString();
        const derived_at = derivedAt || snapshot?.derived_at || new Date().toISOString();
        const decisions = Object.fromEntries((snapshot?.entities || [])
            .filter((entity) => (entity.type || entity.entity_type) === 'decision')
            .map((entity) => [entity.id, { ...entity.payload, explicit: true, inferred: false }]));
        const evidence = [];
        const supersessionRule = this.manifest.inference_rules.find((rule) => rule.relation === 'supersedes');
        const effectiveStatuses = new Set(supersessionRule?.effective_statuses || ['active']);
        const isEffectiveSupersession = (edge) => {
            if ((edge.relation || edge.rel_type) !== 'supersedes') return false;
            const replacement = decisions[edge.from_id];
            if (!replacement || !decisions[edge.to_id] || !effectiveStatuses.has(replacement.status)) return false;
            const asOfTime = Date.parse(asOf);
            return [edge.effective_at, replacement.effective_at]
                .filter(Boolean)
                .every((effectiveAt) => Date.parse(effectiveAt) <= asOfTime);
        };
        for (const edge of snapshot?.edges || []) {
            if (!isEffectiveSupersession(edge)) continue;
            const replacement = decisions[edge.from_id];
            decisions[edge.to_id] = { ...decisions[edge.to_id], status: 'superseded', inferred: true };
            evidence.push({ rule_id: supersessionRule?.id || 'decision-supersession', from_id: edge.from_id, to_id: edge.to_id });
        }
        const explicitSupersessions = new Set((snapshot?.edges || [])
            .filter(isEffectiveSupersession)
            .flatMap((edge) => [`${edge.from_id}:${edge.to_id}`, `${edge.to_id}:${edge.from_id}`]));
        const scopesByDecision = new Map(Object.entries(decisions).map(([id, decision]) => [
            id,
            new Set(Array.isArray(decision.scope_ids) ? decision.scope_ids : [])
        ]));
        const entitiesById = new Map((snapshot?.entities || []).map((entity) => [entity.id, entity]));
        for (const edge of snapshot?.edges || []) {
            if ((edge.relation || edge.rel_type) !== 'belongs_to_project' || !scopesByDecision.has(edge.from_id)) continue;
            const scope = entitiesById.get(edge.to_id);
            if (!scope || (scope.type || scope.entity_type) !== 'project') continue;
            scopesByDecision.get(edge.from_id).add(edge.to_id);
        }
        const activeIds = Object.entries(decisions)
            .filter(([, decision]) => effectiveStatuses.has(decision.status))
            .map(([id]) => id);
        for (let leftIndex = 0; leftIndex < activeIds.length; leftIndex += 1) {
            for (let rightIndex = leftIndex + 1; rightIndex < activeIds.length; rightIndex += 1) {
                const leftId = activeIds[leftIndex];
                const rightId = activeIds[rightIndex];
                const leftScopes = scopesByDecision.get(leftId) || new Set();
                const rightScopes = scopesByDecision.get(rightId) || new Set();
                const overlaps = [...leftScopes].some((scope) => rightScopes.has(scope));
                if (!overlaps || explicitSupersessions.has(`${leftId}:${rightId}`)) continue;
                decisions[leftId] = { ...decisions[leftId], status: 'conflict', inferred: true };
                decisions[rightId] = { ...decisions[rightId], status: 'conflict', inferred: true };
                evidence.push({ rule_id: 'decision-active-conflict', decision_ids: [leftId, rightId] });
            }
        }
        const explanation = evidence.length
            ? evidence.map((item) => item.decision_ids
                ? `${item.decision_ids.join(' and ')} conflict`
                : `${item.from_id} supersedes ${item.to_id}`).join('; ')
            : 'No decision supersession was inferred';
        return { ontology_version: this.version, as_of: asOf, derived_at, decisions, evidence, explanation };
    }

    impact({ change = {}, snapshot = null }) {
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
            .filter((entity) => !change.type || (entity.type || entity.entity_type) === change.type)
            .map((entity) => entity.id);
        const edgeIds = (snapshot.edges || [])
            .filter((edge) => !change.relation || (edge.relation || edge.rel_type) === change.relation)
            .map((edge) => edge.id || `${edge.from_id}:${edge.relation || edge.rel_type}:${edge.to_id}`);
        let ids = change.relation ? edgeIds : entityIds;
        if (change.rule_id) {
            const rule = [...this.manifest.constraints, ...this.manifest.inference_rules]
                .find((candidate) => candidate.id === change.rule_id);
            if (!rule) {
                throw new OntologyError('ONTOLOGY_RULE_UNKNOWN', `Unknown ontology rule: ${change.rule_id}`);
            }
            ids = rule.relation
                ? (snapshot.edges || []).filter((edge) => (edge.relation || edge.rel_type) === rule.relation)
                    .map((edge) => edge.id || `${edge.from_id}:${edge.relation || edge.rel_type}:${edge.to_id}`)
                : (snapshot.entities || []).filter((entity) => !rule.target || (entity.type || entity.entity_type) === rule.target)
                    .map((entity) => entity.id);
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

    planEvolution(change = {}) {
        const kind = change.kind;
        if (!this.manifest.evolution_rules.history_required_for.includes(kind)) {
            throw new OntologyError('ONTOLOGY_EVOLUTION_KIND_INVALID', `Evolution kind does not require identity history: ${kind}`);
        }
        const required = ['canonical_id', 'source_ids', 'effective_at'];
        const missing = required.filter((field) => !change[field]
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

    interpretHistory(snapshot = {}, { asOf } = {}) {
        const interpretationTime = asOf || snapshot.as_of;
        if (!interpretationTime || !Number.isFinite(Date.parse(interpretationTime))) {
            throw new OntologyError('ONTOLOGY_HISTORY_AS_OF_REQUIRED', 'A valid as_of timestamp is required for historical interpretation');
        }
        const events = (snapshot.evolution_events || [])
            .filter((event) => Date.parse(event.effective_at) <= Date.parse(interpretationTime))
            .sort((left, right) => Date.parse(left.effective_at) - Date.parse(right.effective_at));
        const canonicalById = new Map();
        const provenanceById = new Map();
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
        const resolveId = (id) => {
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
            applied_event_ids: events.map((event) => event.event_id),
            entities: (snapshot.entities || []).map((entity) => {
                const interpretation = resolveId(entity.id);
                return {
                    ...structuredClone(entity),
                    historical_id: entity.id,
                    canonical_id: interpretation.canonical_id,
                    evolution_provenance: interpretation.provenance
                };
            }),
            edges: (snapshot.edges || []).map((edge) => {
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
