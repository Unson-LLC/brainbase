// @ts-check
/**
 * Raw Ledger envelope schema validator
 * SPEC-006 / SPEC-candidate-store-mvp Contract: cross-repo write API が
 * 受信する envelope の最低限の構造検証。
 *
 * Story: story-candidate-store-cross-repo-write
 * Parent: STR-006 / ADR-010
 */

const REQUIRED_TOP_LEVEL = [
    'raw_event_id',
    'source_system',
    'source_event_id',
    'occurred_at',
    'captured_at',
    'actor_external_id',
    'actor_person_id',
    'workspace',
    'permission_snapshot',
    'evidence_ref',
    'retention_policy'
];

const REQUIRED_EVIDENCE_REF = ['kind', 'uri', 'hash'];

const REQUIRED_PERMISSION_SNAPSHOT = ['roles', 'clearance'];

const ALLOWED_RETENTION_POLICIES = new Set(['envelope_only', 'evidence_only', 'evidence_and_body']);

/**
 * @param {*} envelope
 * @returns {{ valid: boolean, errors: Array<string> }}
 */
export function validateEnvelope(envelope) {
    const errors = [];

    if (!envelope || typeof envelope !== 'object') {
        return { valid: false, errors: ['envelope must be an object'] };
    }

    for (const field of REQUIRED_TOP_LEVEL) {
        if (envelope[field] === undefined || envelope[field] === null) {
            errors.push(`missing required field: ${field}`);
        }
    }

    if (typeof envelope.raw_event_id === 'string' && envelope.raw_event_id.length > 256) {
        errors.push('raw_event_id too long (>256 chars)');
    }

    if (typeof envelope.source_system === 'string' && !/^[a-z0-9_]+$/.test(envelope.source_system)) {
        errors.push('source_system must match /^[a-z0-9_]+$/');
    }

    if (envelope.permission_snapshot && typeof envelope.permission_snapshot === 'object') {
        for (const field of REQUIRED_PERMISSION_SNAPSHOT) {
            if (!Array.isArray(envelope.permission_snapshot[field])) {
                errors.push(`permission_snapshot.${field} must be an array`);
            }
        }
    }

    if (envelope.evidence_ref && typeof envelope.evidence_ref === 'object') {
        for (const field of REQUIRED_EVIDENCE_REF) {
            if (!envelope.evidence_ref[field] || typeof envelope.evidence_ref[field] !== 'string') {
                errors.push(`evidence_ref.${field} must be a non-empty string`);
            }
        }
    }

    if (envelope.retention_policy && !ALLOWED_RETENTION_POLICIES.has(envelope.retention_policy)) {
        errors.push(`retention_policy must be one of: ${[...ALLOWED_RETENTION_POLICIES].join(', ')}`);
    }

    for (const tsField of ['occurred_at', 'captured_at']) {
        if (envelope[tsField] && Number.isNaN(Date.parse(envelope[tsField]))) {
            errors.push(`${tsField} must be a valid ISO 8601 timestamp`);
        }
    }

    return { valid: errors.length === 0, errors };
}
