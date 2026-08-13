import { createHash } from 'node:crypto';

const EVIDENCE_KINDS = new Set(['url', 'artifact_ref', 'log_ref']);
const EVIDENCE_KEYS = new Set(['kind', 'ref', 'label']);
const OPAQUE_REF_PATTERN = /^[a-z][a-z0-9_+.-]{1,31}:[^\s]{1,2000}$/;
const ROUTINE_ARTIFACT_REF_PATTERN = /^routine-artifacts\/[a-z0-9_-]+\/[a-f0-9]{64}\.json$/;
const EMBEDDED_CREDENTIAL_PATTERN = /^[a-z][a-z0-9+.-]{1,31}:(?:\/\/)?[^/?#\s@]+(?::[^/?#\s@]*)?@/i;
const CONTROL_OR_NEWLINE_PATTERN = /[\u0000-\u001f\u007f]/;

export function requireSingleLine(value, field, maxLength = 200) {
    if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) {
        throw new Error(`${field} must be a non-empty trimmed string`);
    }
    if (value.length > maxLength || CONTROL_OR_NEWLINE_PATTERN.test(value)) {
        throw new Error(`${field} must be single-line and at most ${maxLength} characters`);
    }
    return value;
}

export function toIso(value, field = 'timestamp') {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid timestamp`);
    return date.toISOString();
}

export function createIdempotencyKey(projectId, sourceType, externalRunId) {
    const tuple = JSON.stringify([projectId, sourceType, externalRunId]);
    return `rr1_${createHash('sha256').update(tuple, 'utf8').digest('hex')}`;
}

export function normalizeEvidenceRefs(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error('evidence_refs must be an array');
    return value.map((entry, index) => {
        const field = `evidence_refs[${index}]`;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error(`${field} must be an object`);
        }
        for (const key of Object.keys(entry)) {
            if (!EVIDENCE_KEYS.has(key)) throw new Error(`${field}.${key} is not supported`);
        }
        const kind = requireSingleLine(entry.kind, `${field}.kind`, 32);
        const ref = requireSingleLine(entry.ref, `${field}.ref`, 2048);
        if (!EVIDENCE_KINDS.has(kind)) throw new Error(`${field}.kind is not supported`);
        if (EMBEDDED_CREDENTIAL_PATTERN.test(ref)) {
            throw new Error(`${field}.ref must not contain embedded credentials`);
        }
        if (kind === 'url') {
            let parsed;
            try {
                parsed = new URL(ref);
            } catch {
                throw new Error(`${field}.ref must be an absolute HTTPS URL`);
            }
            if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
                throw new Error(`${field}.ref must be an absolute HTTPS URL without credentials`);
            }
        } else if (!OPAQUE_REF_PATTERN.test(ref) && !ROUTINE_ARTIFACT_REF_PATTERN.test(ref)) {
            throw new Error(`${field}.ref must be a source-owned opaque reference`);
        }
        return {
            kind,
            ref,
            ...(entry.label === undefined ? {} : { label: requireSingleLine(entry.label, `${field}.label`, 120) })
        };
    }).sort((left, right) => (
        left.kind.localeCompare(right.kind)
        || left.ref.localeCompare(right.ref)
        || String(left.label || '').localeCompare(String(right.label || ''))
    ));
}

export async function postReceipt(receipt, {
    endpoint,
    serviceToken,
    fetchImpl = globalThis.fetch,
    timeoutMs = 10_000
}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${serviceToken}`,
                'content-type': 'application/json'
            },
            body: JSON.stringify(receipt),
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeout);
    }
}
