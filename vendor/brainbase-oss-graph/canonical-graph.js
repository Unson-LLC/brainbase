import { createHash } from 'node:crypto';
import { getCanonicalRelation } from './relation-registry.js';
export function canonicalEdgeId(edge) {
    return `edge-${createHash('sha256').update(JSON.stringify([edge.fromId, edge.relation, edge.toId])).digest('hex').slice(0, 24)}`;
}
const v1EntityKinds = new Set(['person', 'org', 'project', 'relationship']);
const canonicalEntityKinds = new Set(['person', 'org', 'project', 'decision']);
export function validateCanonicalGraph(graph, options = {}) {
    if (!graph || typeof graph !== 'object' || !('version' in graph) || !('entities' in graph)) {
        throw new Error('GRAPH-SHAPE-VALID: graph must be an object with version and entities');
    }
    const candidate = graph;
    if (candidate.version !== 1 && candidate.version !== 2) {
        throw new Error(`GRAPH-VERSION-SUPPORTED: unsupported graph version ${String(candidate.version)}`);
    }
    if (!Array.isArray(candidate.entities)) {
        throw new Error('GRAPH-SHAPE-VALID: entities must be an array');
    }
    const entityIds = new Set();
    for (const [index, entityValue] of candidate.entities.entries()) {
        if (!entityValue || typeof entityValue !== 'object') {
            throw new Error(`GRAPH-ENTITY-SHAPE at entities[${index}]: entity must be an object`);
        }
        const entity = entityValue;
        assertNonEmptyString(entity.id, `entities[${index}].id`);
        assertNonEmptyString(entity.name, `entities[${index}].name`);
        const allowedKinds = candidate.version === 1 ? v1EntityKinds : canonicalEntityKinds;
        if (typeof entity.type !== 'string' || !allowedKinds.has(entity.type)) {
            throw new Error(`GRAPH-ENTITY-TYPE at entities[${index}].type: unsupported entity type ${String(entity.type)}`);
        }
        if (entity.aliases !== undefined && (!Array.isArray(entity.aliases) || entity.aliases.some((alias) => typeof alias !== 'string' || alias.trim() === ''))) {
            throw new Error(`GRAPH-ENTITY-ALIASES at entities[${index}].aliases: aliases must be non-empty strings`);
        }
        assertOptionalString(entity.summary, `entities[${index}].summary`);
        assertOptionalStringArray(entity.tags, `entities[${index}].tags`);
        assertOptionalRecord(entity.metadata, `entities[${index}].metadata`);
        if (entityIds.has(entity.id)) {
            if (!options.allowDuplicateEntityIds) {
                throw new Error(`GRAPH-ENTITY-ID-UNIQUE at entities[${index}].id: duplicate canonical entity ID ${entity.id}`);
            }
        }
        entityIds.add(entity.id);
    }
    if (candidate.owner !== undefined) {
        assertOptionalRecord(candidate.owner, 'owner');
        const owner = candidate.owner;
        assertOptionalString(owner.id, 'owner.id');
        assertOptionalString(owner.name, 'owner.name');
        assertOptionalString(owner.summary, 'owner.summary');
    }
    if (candidate.version === 1)
        return;
    if (!candidate.ontology || typeof candidate.ontology !== 'object') {
        throw new Error('GRAPH-ONTOLOGY-REQUIRED: Graph v2 requires ontology binding');
    }
    const ontology = candidate.ontology;
    if (ontology.id !== 'brainbase-personal-os') {
        throw new Error('GRAPH-ONTOLOGY-ID: Graph v2 ontology.id must be brainbase-personal-os');
    }
    assertNonEmptyString(ontology.version, 'ontology.version');
    assertNonEmptyString(ontology.releaseDigest, 'ontology.releaseDigest');
    if (!Array.isArray(candidate.edges)) {
        throw new Error('GRAPH-SHAPE-VALID: Graph v2 edges must be an array');
    }
    const typedGraph = graph;
    const entities = new Map();
    for (const [index, entity] of typedGraph.entities.entries()) {
        assertInterval(entity.validFrom, entity.validTo, `entities[${index}]`);
        entities.set(entity.id, entity);
    }
    const edgeIds = new Set();
    const tuples = new Set();
    for (const [index, edge] of typedGraph.edges.entries()) {
        if (!edge || typeof edge !== 'object') {
            throw new Error(`GRAPH-EDGE-SHAPE at edges[${index}]: edge must be an object`);
        }
        assertNonEmptyString(edge.id, `edges[${index}].id`);
        assertNonEmptyString(edge.fromId, `edges[${index}].fromId`);
        assertNonEmptyString(edge.relation, `edges[${index}].relation`);
        assertNonEmptyString(edge.toId, `edges[${index}].toId`);
        assertOptionalString(edge.role, `edges[${index}].role`);
        assertOptionalString(edge.context, `edges[${index}].context`);
        if (edge.provenance !== undefined) {
            assertOptionalRecord(edge.provenance, `edges[${index}].provenance`);
            if (!['user_approved', 'migration', 'import', 'onboarding'].includes(String(edge.provenance.sourceKind))) {
                throw new Error(`GRAPH-EDGE-PROVENANCE at edges[${index}].provenance.sourceKind: unsupported source kind`);
            }
            assertOptionalString(edge.provenance.sourceId, `edges[${index}].provenance.sourceId`);
            assertOptionalString(edge.provenance.evidenceHash, `edges[${index}].provenance.evidenceHash`);
        }
        if (edgeIds.has(edge.id)) {
            throw new Error(`GRAPH-EDGE-ID-UNIQUE at edges[${index}].id: duplicate canonical edge ID ${edge.id}`);
        }
        edgeIds.add(edge.id);
        const tuple = JSON.stringify([edge.fromId, edge.relation, edge.toId]);
        if (tuples.has(tuple)) {
            throw new Error(`GRAPH-EDGE-TUPLE-UNIQUE at edges[${index}]: duplicate canonical edge ${tuple}`);
        }
        tuples.add(tuple);
        const from = entities.get(edge.fromId);
        const to = entities.get(edge.toId);
        if (!from || !to) {
            throw new Error(`GRAPH-EDGE-ENDPOINT-EXISTS at edges[${index}]: missing endpoint for ${tuple}`);
        }
        const expected = getCanonicalRelation(edge.relation);
        if (from.type !== expected.from || to.type !== expected.to) {
            throw new Error(`GRAPH-EDGE-ENDPOINT-TYPE at edges[${index}]: ${edge.relation} requires ${expected.from} -> ${expected.to}`);
        }
        if (edge.id !== canonicalEdgeId(edge)) {
            throw new Error(`GRAPH-EDGE-ID-STABLE at edges[${index}].id: expected ${canonicalEdgeId(edge)}`);
        }
        assertInterval(edge.validFrom, edge.validTo, `edges[${index}]`);
    }
}
export function isActiveAt(record, asOf) {
    const instant = parseRfc3339(asOf, 'asOf');
    const from = record.validFrom === undefined ? undefined : parseRfc3339(record.validFrom, 'validFrom');
    const to = record.validTo === undefined ? undefined : parseRfc3339(record.validTo, 'validTo');
    return (from === undefined || from <= instant) && (to === undefined || instant < to);
}
function assertInterval(validFrom, validTo, path) {
    const from = validFrom === undefined ? undefined : parseRfc3339(validFrom, `${path}.validFrom`);
    const to = validTo === undefined ? undefined : parseRfc3339(validTo, `${path}.validTo`);
    if (from !== undefined && to !== undefined && from > to) {
        throw new Error(`GRAPH-VALIDITY-ORDER at ${path}: validFrom must not be after validTo`);
    }
}
function parseRfc3339(value, path) {
    if (typeof value !== 'string') {
        throw new Error(`GRAPH-VALIDITY-DATETIME at ${path}: validity must use RFC 3339 date-time values`);
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u.exec(value);
    if (!match) {
        throw new Error(`GRAPH-VALIDITY-DATETIME at ${path}: validity must use RFC 3339 date-time values`);
    }
    const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const offsetHour = Number(offsetHourText ?? 0);
    const offsetMinute = Number(offsetMinuteText ?? 0);
    const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
    if (day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
        throw new Error(`GRAPH-VALIDITY-DATETIME at ${path}: validity must use a real RFC 3339 date-time value`);
    }
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(`GRAPH-VALIDITY-DATETIME at ${path}: validity must use RFC 3339 date-time values`);
    }
    return parsed;
}
function assertNonEmptyString(value, path) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`GRAPH-NONEMPTY-STRING at ${path}: value must be a non-empty string`);
    }
}
function assertOptionalString(value, path) {
    if (value !== undefined && typeof value !== 'string') {
        throw new Error(`GRAPH-OPTIONAL-STRING at ${path}: value must be a string when present`);
    }
}
function assertOptionalStringArray(value, path) {
    if (value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))) {
        throw new Error(`GRAPH-STRING-ARRAY at ${path}: value must be an array of strings when present`);
    }
}
function assertOptionalRecord(value, path) {
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
        throw new Error(`GRAPH-OBJECT at ${path}: value must be an object when present`);
    }
}
