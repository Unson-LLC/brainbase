import { createHash } from 'node:crypto';
import { validateCanonicalGraph } from './canonical-graph.js';
import { retrieveGraph } from './graph-retrieval.js';
/** The public, read-only interchange format for a canonical Graph v2 snapshot. */
export const PORTABLE_GRAPH_SCHEMA_VERSION = 1;
/** Bounds keep an imported snapshot finite before it reaches a runtime or model. */
export const PORTABLE_GRAPH_MAX_ENTITIES = 10_000;
export const PORTABLE_GRAPH_MAX_EDGES = 25_000;
export const PORTABLE_GRAPH_MAX_DECISIONS = 10_000;
export const PORTABLE_GRAPH_MAX_JSON_BYTES = 8_000_000;
export const PORTABLE_GRAPH_MAX_JSON_DEPTH = 64;
/**
 * Create a detached Graph v2 bundle for transfer between the OSS and
 * organization runtimes. Personal KG, legacy relationships, source files, and
 * the local data directory are deliberately outside this contract.
 */
export function createPortableGraph(os) {
    if (!os || typeof os !== 'object' || !('graph' in os) || !('decisions' in os)) {
        throw new Error('PORTABLE-GRAPH-SOURCE: a PersonalOs with graph and decisions is required');
    }
    validateCanonicalGraph(os.graph);
    if (os.graph.version !== 2) {
        throw new Error('PORTABLE-GRAPH-V1-REJECTED: only Graph v2 can be exported');
    }
    if (!Array.isArray(os.decisions)) {
        throw new Error('PORTABLE-GRAPH-DECISIONS: decisions must be an array');
    }
    const decisionIds = new Set(os.graph.entities.filter((entity) => entity.type === 'decision').map((entity) => entity.id));
    const decisions = os.decisions
        .filter((decision) => decisionIds.has(decision.id))
        .map((decision) => structuredClone(decision))
        .sort((left, right) => left.id.localeCompare(right.id, 'en'));
    const bundle = {
        schemaVersion: PORTABLE_GRAPH_SCHEMA_VERSION,
        graph: structuredClone(os.graph),
        decisions
    };
    validatePortableGraph(bundle);
    return bundle;
}
/**
 * Validate the exact portable contract. Unknown top-level fields are rejected
 * so an organization runtime cannot silently ignore a new capability. Unknown
 * fields inside Graph records are retained after the canonical Graph validator
 * accepts them, which keeps forward-compatible metadata lossless.
 */
export function validatePortableGraph(value) {
    assertJsonValue(value, '$', new WeakSet(), 0);
    if (!isPlainRecord(value))
        throw new Error('PORTABLE-GRAPH-SHAPE: bundle must be a plain JSON object');
    const topLevelKeys = Object.getOwnPropertyNames(value).sort();
    const expected = ['decisions', 'graph', 'schemaVersion'];
    const unknownKeys = topLevelKeys.filter((key) => !expected.includes(key));
    if (unknownKeys.length > 0) {
        throw new Error(`PORTABLE-GRAPH-SHAPE: unknown top-level field ${unknownKeys[0]}`);
    }
    if (value.schemaVersion !== PORTABLE_GRAPH_SCHEMA_VERSION) {
        throw new Error(`PORTABLE-GRAPH-VERSION: unsupported portable schema version ${String(value.schemaVersion)}`);
    }
    if (!isPlainRecord(value.graph)) {
        throw new Error('PORTABLE-GRAPH-SHAPE: graph must be a plain JSON object');
    }
    if (value.graph.version === 1) {
        throw new Error('PORTABLE-GRAPH-V1-REJECTED: portable bundles require Graph v2');
    }
    if (!Array.isArray(value.decisions)) {
        throw new Error('PORTABLE-GRAPH-DECISIONS: decisions must be an array');
    }
    const graph = value.graph;
    if (graph.version !== 2) {
        // Keep the canonical validator's explicit version error for other future
        // versions while still making the portable boundary clear to callers.
        validateCanonicalGraph(graph);
    }
    validateCanonicalGraph(graph);
    if (graph.entities.length > PORTABLE_GRAPH_MAX_ENTITIES) {
        throw new Error(`PORTABLE-GRAPH-BOUND: graph.entities exceeds ${PORTABLE_GRAPH_MAX_ENTITIES}`);
    }
    if (graph.edges.length > PORTABLE_GRAPH_MAX_EDGES) {
        throw new Error(`PORTABLE-GRAPH-BOUND: graph.edges exceeds ${PORTABLE_GRAPH_MAX_EDGES}`);
    }
    if (value.decisions.length > PORTABLE_GRAPH_MAX_DECISIONS) {
        throw new Error(`PORTABLE-GRAPH-BOUND: decisions exceeds ${PORTABLE_GRAPH_MAX_DECISIONS}`);
    }
    validateDecisionRecords(graph, value.decisions);
    const bytes = Buffer.byteLength(canonicalPortableJson(value), 'utf8');
    if (bytes > PORTABLE_GRAPH_MAX_JSON_BYTES) {
        throw new Error(`PORTABLE-GRAPH-BOUND: JSON payload exceeds ${PORTABLE_GRAPH_MAX_JSON_BYTES} bytes`);
    }
}
/** Rehydrate a validated bundle into the shared retrieval input shape. */
export function hydratePortableGraph(bundle) {
    validatePortableGraph(bundle);
    return {
        dataDir: '',
        graph: structuredClone(bundle.graph),
        personalKg: [],
        relationships: { version: 1, relationships: [] },
        decisions: structuredClone(bundle.decisions),
        // sourceCount counts imported source files in the local SSOT. A portable
        // Graph bundle contains no source files, so zero is the truthful value.
        sourceCount: 0
    };
}
/** Use exactly the OSS retrieval implementation against a portable bundle. */
export function retrievePortableGraph(bundle, input, provider) {
    return retrieveGraph(hydratePortableGraph(bundle), input, provider);
}
/** Canonical JSON with recursively sorted object keys and preserved array order. */
export function canonicalPortableJson(value) {
    assertJsonValue(value, '$', new WeakSet(), 0);
    return stableJson(value, 0);
}
/** Stable content identity for a portable Graph bundle. */
export function portableGraphDigest(value) {
    validatePortableGraph(value);
    return `sha256:${createHash('sha256').update(canonicalPortableJson(value), 'utf8').digest('hex')}`;
}
/** Descriptive alias for callers that prefer the content-identity wording. */
export const digestPortableGraph = portableGraphDigest;
function validateDecisionRecords(graph, decisions) {
    const decisionEntities = new Set(graph.entities.filter((entity) => entity.type === 'decision').map((entity) => entity.id));
    const records = new Map();
    decisions.forEach((value, index) => {
        if (!isPlainRecord(value))
            throw new Error(`PORTABLE-GRAPH-DECISION-SHAPE at decisions[${index}]`);
        requireNonEmptyString(value.id, `decisions[${index}].id`);
        requireNonEmptyString(value.title, `decisions[${index}].title`);
        requireNonEmptyString(value.decision, `decisions[${index}].decision`);
        if (records.has(value.id))
            throw new Error(`PORTABLE-GRAPH-DECISION-ID-UNIQUE: duplicate decision ID ${value.id}`);
        records.set(value.id, value);
        optionalString(value.topic, `decisions[${index}].topic`);
        optionalString(value.rationale, `decisions[${index}].rationale`);
        optionalString(value.updatedAt, `decisions[${index}].updatedAt`);
        if (value.effectiveAt !== undefined) {
            if (typeof value.effectiveAt !== 'string' || !isRfc3339(value.effectiveAt)) {
                throw new Error(`PORTABLE-GRAPH-DECISION-DATE at decisions[${index}].effectiveAt`);
            }
        }
        if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string'))) {
            throw new Error(`PORTABLE-GRAPH-DECISION-TAGS at decisions[${index}].tags`);
        }
        if (value.supersedes !== undefined) {
            if (!Array.isArray(value.supersedes) || value.supersedes.some((id) => typeof id !== 'string' || id.trim() === '')) {
                throw new Error(`PORTABLE-GRAPH-DECISION-SUPERSEDES at decisions[${index}].supersedes`);
            }
            const refs = new Set();
            for (const target of value.supersedes) {
                if (refs.has(target))
                    throw new Error(`PORTABLE-GRAPH-DECISION-REFERENCE: duplicate supersedes reference ${target}`);
                refs.add(target);
            }
        }
    });
    for (const id of decisionEntities) {
        if (!records.has(id))
            throw new Error(`PORTABLE-GRAPH-DECISION-REFERENCE: missing decision record for Graph entity ${id}`);
    }
    for (const [id, decision] of records) {
        const entity = graph.entities.find((candidate) => candidate.id === id);
        if (!entity || entity.type !== 'decision') {
            throw new Error(`PORTABLE-GRAPH-DECISION-REFERENCE: decision record ${id} has no Graph decision entity`);
        }
        for (const target of decision.supersedes ?? []) {
            if (!records.has(target)) {
                throw new Error(`PORTABLE-GRAPH-DECISION-REFERENCE: decision ${id} supersedes missing decision ${target}`);
            }
        }
    }
}
function requireNonEmptyString(value, path) {
    if (typeof value !== 'string' || value.trim() === '')
        throw new Error(`PORTABLE-GRAPH-STRING at ${path}`);
}
function optionalString(value, path) {
    if (value !== undefined && typeof value !== 'string')
        throw new Error(`PORTABLE-GRAPH-STRING at ${path}`);
}
function isRfc3339(value) {
    return /^(?:\d{4})-(?:\d{2})-(?:\d{2})T(?:\d{2}):(?:\d{2}):(?:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value));
}
function isPlainRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function assertJsonValue(value, path, active, depth) {
    if (depth > PORTABLE_GRAPH_MAX_JSON_DEPTH)
        throw new Error(`PORTABLE-GRAPH-BOUND: JSON depth exceeds ${PORTABLE_GRAPH_MAX_JSON_DEPTH} at ${path}`);
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new Error(`PORTABLE-GRAPH-JSON: non-finite number at ${path}`);
        return;
    }
    if (typeof value !== 'object')
        throw new Error(`PORTABLE-GRAPH-JSON: non-JSON value at ${path}`);
    if (active.has(value))
        throw new Error(`PORTABLE-GRAPH-JSON: cyclic value at ${path}`);
    active.add(value);
    try {
        if (Array.isArray(value)) {
            for (let index = 0; index < value.length; index += 1) {
                if (!(index in value))
                    throw new Error(`PORTABLE-GRAPH-JSON: sparse array at ${path}[${index}]`);
                assertJsonValue(value[index], `${path}[${index}]`, active, depth + 1);
            }
            return;
        }
        if (!isPlainRecord(value))
            throw new Error(`PORTABLE-GRAPH-JSON: value at ${path} must be a plain JSON object`);
        for (const key of Object.getOwnPropertyNames(value)) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor))
                throw new Error(`PORTABLE-GRAPH-JSON: accessor at ${path}.${key}`);
            assertJsonValue(descriptor.value, `${path}.${key}`, active, depth + 1);
        }
        if (Object.getOwnPropertySymbols(value).length > 0)
            throw new Error(`PORTABLE-GRAPH-JSON: symbol key at ${path}`);
    }
    finally {
        active.delete(value);
    }
}
function stableJson(value, depth) {
    if (depth > PORTABLE_GRAPH_MAX_JSON_DEPTH)
        throw new Error(`PORTABLE-GRAPH-BOUND: JSON depth exceeds ${PORTABLE_GRAPH_MAX_JSON_DEPTH}`);
    if (value === null)
        return 'null';
    if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map((item) => stableJson(item, depth + 1)).join(',')}]`;
    const record = value;
    const pairs = Object.getOwnPropertyNames(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key], depth + 1)}`);
    return `{${pairs.join(',')}}`;
}
