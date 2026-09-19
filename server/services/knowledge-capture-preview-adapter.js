/**
 * Contracts shared by the local knowledge capture and preview adapters.
 *
 * The adapter is deliberately provider-agnostic.  Production bootstrap does
 * not create one; callers must inject an explicit implementation.  This file
 * only normalizes and validates the boundary so an adapter cannot turn
 * missing evidence or an unverified version into a successful result.
 */

export class KnowledgeAIAdapterContractError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'KnowledgeAIAdapterContractError';
        this.code = 'knowledge_ai_adapter_contract_invalid';
        this.status = 502;
        this.details = details;
    }
}

function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hasOwn(value, key) {
    return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function fail(message, details = {}) {
    throw new KnowledgeAIAdapterContractError(message, details);
}

export function normalizeVersion(value, field = 'version') {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const state = text(value.state) || text(value.status);
        if (!state) fail(`${field} must include an explicit state`, { field });
        return {
            state,
            value: typeof value.value === 'string' && value.value.trim()
                ? value.value.trim()
                : typeof value.value === 'number' && Number.isFinite(value.value)
                    ? String(value.value)
                    : null
        };
    }
    fail(`${field} is required`, { field });
}

export function versionValue(value) {
    return typeof value === 'string' ? value : null;
}

function versionKey(value) {
    return typeof value === 'string' ? `known:${value}` : `unknown:${value.state}:${value.value || ''}`;
}

export function normalizeUnknown(value, field = 'unknown') {
    if (!Array.isArray(value)) fail(`${field} must be an array`, { field });
    return value.map((entry, index) => {
        if (typeof entry === 'string' && entry.trim()) return entry.trim();
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) return { ...entry };
        fail(`${field}[${index}] must be text or an object`, { field, index });
    });
}

export function normalizeReadback(value, field = 'readback') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail(`${field} is required`, { field });
    }
    const state = text(value.state) || text(value.status);
    if (!state) fail(`${field}.state is required`, { field });
    if (typeof value.verified !== 'boolean') {
        fail(`${field}.verified must be explicit`, { field });
    }
    return { ...value, state, verified: value.verified };
}

/**
 * Resolve only explicitly injected adapter methods.  There is intentionally
 * no environment or default-provider lookup here.
 */
export function resolveKnowledgeAdapter(adapter, method) {
    if (typeof adapter === 'function') return adapter;
    if (!adapter || typeof adapter !== 'object') return null;
    if (typeof adapter[method] === 'function') return adapter[method].bind(adapter);
    return null;
}

export function normalizeEvidence(value, {
    field = 'evidence',
    allowedReferences = null,
    requireExactReference = false
} = {}) {
    if (!Array.isArray(value)) fail(`${field} must be an array`, { field });
    return value.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            fail(`${field}[${index}] must be an object`, { field, index });
        }
        const id = text(entry.id) || text(entry.candidate_id) || null;
        const sourceRef = text(entry.source_ref) || text(entry.pointer) || text(entry.source) || null;
        if (requireExactReference && !id) {
            fail(`${field}[${index}].id is required`, { field, index });
        }
        if (!id && !sourceRef) {
            fail(`${field}[${index}] needs an id or source_ref`, { field, index });
        }
        if (!hasOwn(entry, 'version')) {
            fail(`${field}[${index}].version is required`, { field, index });
        }
        const version = normalizeVersion(entry.version, `${field}[${index}].version`);
        if (allowedReferences && id) {
            const key = `${id}\u0000${versionKey(version)}`;
            if (!allowedReferences.has(key)) {
                fail(`${field}[${index}] references an unavailable candidate`, {
                    field,
                    index,
                    id,
                    version
                });
            }
        }
        return {
            ...entry,
            id,
            version,
            source_ref: sourceRef
        };
    });
}

export function referenceKey(id, version) {
    return `${text(id) || ''}\u0000${versionKey(version)}`;
}

export function normalizeCitations(value, {
    field = 'citations',
    allowedReferences
} = {}) {
    if (!Array.isArray(value)) fail(`${field} must be an array`, { field });
    return value.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            fail(`${field}[${index}] must be an object`, { field, index });
        }
        const id = text(entry.id) || text(entry.candidate_id);
        if (!id) fail(`${field}[${index}].id is required`, { field, index });
        if (!hasOwn(entry, 'version')) fail(`${field}[${index}].version is required`, { field, index });
        const version = normalizeVersion(entry.version, `${field}[${index}].version`);
        if (typeof version !== 'string') {
            fail(`${field}[${index}].version must be an exact value`, { field, index, id });
        }
        const key = referenceKey(id, version);
        if (allowedReferences && !allowedReferences.has(key)) {
            fail(`${field}[${index}] references a candidate outside the isolated set`, {
                field,
                index,
                id,
                version
            });
        }
        return {
            ...entry,
            id,
            version
        };
    });
}

export function validateCaptureProposal(value, { allowedReferences = null } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail('capture adapter must return an object');
    }
    const proposal = value.proposal && typeof value.proposal === 'object' && !Array.isArray(value.proposal)
        ? value.proposal
        : value;
    for (const field of ['kind', 'summary', 'scope', 'owner_candidate', 'relations']) {
        if (!hasOwn(proposal, field)) fail(`capture proposal.${field} is required`, { field });
    }
    const version = normalizeVersion(value.version, 'capture proposal.version');
    const unknown = normalizeUnknown(value.unknown, 'capture proposal.unknown');
    const evidence = normalizeEvidence(value.evidence, {
        field: 'capture proposal.evidence',
        allowedReferences
    });
    const readback = normalizeReadback(value.readback, 'capture proposal.readback');
    return {
        proposal: {
            kind: proposal.kind,
            summary: proposal.summary,
            scope: proposal.scope,
            owner_candidate: proposal.owner_candidate,
            relations: proposal.relations
        },
        evidence,
        unknown,
        version,
        readback
    };
}

export function validatePreviewAnswer(value, { allowedReferences }) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail('preview adapter must return an object');
    }
    const answer = text(value.answer);
    if (!answer) fail('preview answer is required', { field: 'answer' });
    const rawCitations = value.citations ?? value.cited_refs ?? value.selected_refs;
    const citations = normalizeCitations(rawCitations, {
        field: 'preview citations',
        allowedReferences
    });
    const unknown = normalizeUnknown(value.unknown, 'preview unknown');
    const evidence = normalizeEvidence(value.evidence, {
        field: 'preview evidence',
        allowedReferences,
        requireExactReference: true
    });
    const readback = normalizeReadback(value.readback, 'preview readback');
    const version = normalizeVersion(value.version, 'preview version');
    const exclusions = Array.isArray(value.exclusions)
        ? value.exclusions.map((entry) => ({ ...entry }))
        : [];
    return {
        answer,
        citations,
        evidence,
        exclusions,
        unknown,
        version,
        readback
    };
}
