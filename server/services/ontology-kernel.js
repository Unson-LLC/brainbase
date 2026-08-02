const REQUIRED_MANIFEST_KEYS = [
    'version',
    'initial_status',
    'effective_at',
    'entity_types',
    'relation_types',
    'constraints',
    'inference_rules',
    'evolution_rules'
];

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

function assertManifest(manifest) {
    const missing = REQUIRED_MANIFEST_KEYS.filter((key) => manifest?.[key] == null);
    if (missing.length) {
        throw new OntologyError('ONTOLOGY_MANIFEST_INVALID', `Ontology manifest is missing: ${missing.join(', ')}`, { missing });
    }
    if (!Object.keys(manifest.entity_types).length || !Object.keys(manifest.relation_types).length) {
        throw new OntologyError('ONTOLOGY_MANIFEST_INVALID', 'Ontology manifest vocabulary must not be empty');
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

    validateEntity(entity) {
        const violations = [];
        if (!entity?.id) violations.push(violation('entity-id-required', 'Entity id is required'));
        const type = entity?.type || entity?.entity_type;
        if (!this.manifest.entity_types[type]) {
            violations.push(violation('entity-type-registered', `Unknown ontology type: ${type}`, { entity_id: entity?.id, type }));
        }
        for (const rule of this.manifest.constraints) {
            if (rule.target !== type || rule.kind !== 'required_fields_when') continue;
            const matches = Object.entries(rule.when || {}).every(([key, value]) => entity?.payload?.[key] === value);
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
        const violations = entities.flatMap((entity) => this.validateEntity(entity).violations);
        for (const edge of edges) {
            const from = byId.get(edge.from_id);
            const to = byId.get(edge.to_id);
            violations.push(...this.validateEdge({ ...edge, from_type: edge.from_type || from?.type, to_type: edge.to_type || to?.type }).violations);
        }
        for (const rule of this.manifest.constraints) {
            if (rule.kind !== 'required_relation') continue;
            for (const entity of entities.filter((item) => (item.type || item.entity_type) === rule.target)) {
                const hasRelation = edges.some((edge) => edge.from_id === entity.id && (edge.relation || edge.rel_type) === rule.relation);
                if (!hasRelation) {
                    violations.push(violation(rule.id, `${rule.target} requires ${rule.relation}`, { entity_id: entity.id }));
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

    inferDecisions(snapshot) {
        const asOf = snapshot?.as_of || new Date().toISOString();
        const decisions = Object.fromEntries((snapshot?.entities || [])
            .filter((entity) => (entity.type || entity.entity_type) === 'decision')
            .map((entity) => [entity.id, { ...entity.payload, explicit: true, inferred: false }]));
        const evidence = [];
        for (const edge of snapshot?.edges || []) {
            if ((edge.relation || edge.rel_type) !== 'supersedes') continue;
            const replacement = decisions[edge.from_id];
            if (!replacement || !decisions[edge.to_id]) continue;
            if (replacement.effective_at && replacement.effective_at > asOf) continue;
            decisions[edge.to_id] = { ...decisions[edge.to_id], status: 'superseded', inferred: true };
            evidence.push({ rule_id: 'decision-supersession', from_id: edge.from_id, to_id: edge.to_id });
        }
        const explanation = evidence.length
            ? evidence.map((item) => `${item.from_id} supersedes ${item.to_id}`).join('; ')
            : 'No decision supersession was inferred';
        return { ontology_version: this.version, as_of: asOf, decisions, evidence, explanation };
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
                migration_required: semver === 'major'
            };
        }
        const ids = (snapshot.entities || []).filter((entity) => !change.type || (entity.type || entity.entity_type) === change.type).map((entity) => entity.id);
        return {
            ontology_version: this.version,
            semver,
            verification: 'verified',
            match_count: ids.length,
            representative_ids: ids.slice(0, 10),
            affected_apis: change.affected_apis || [],
            affected_agents: change.affected_agents || [],
            migration_required: semver === 'major'
        };
    }
}
