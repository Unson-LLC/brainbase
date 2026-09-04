import { createHash, createHmac } from 'node:crypto';
import path from 'node:path';

const SCHEMA_VERSION = 'brainbase-vibepro-managed-handoff.v2';
const PAYLOAD_FIELDS = [
    'schema_version',
    'repository',
    'repository_root',
    'project_code',
    'base_sha',
    'issued_at',
    'expires_at',
    'turn_id',
    'resolution_id',
    'story_id',
    'authorized',
    'graph_promotion_allowed',
    'outcome_case'
];
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const MANAGED_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const PROJECT_CODE = /^[a-z0-9][a-z0-9._-]{0,99}$/u;
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

function requiredString(value, name) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
    if (/[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${name} contains control characters`);
    return value.trim();
}

function object(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
    return value;
}

function safeIdentifier(value, name) {
    const normalized = requiredString(value, name);
    if (!SAFE_IDENTIFIER.test(normalized)) throw new Error(`${name} has an invalid format`);
    return normalized;
}

function managedIdentifier(value, name) {
    const normalized = requiredString(value, name);
    if (!MANAGED_IDENTIFIER.test(normalized)) throw new Error(`${name} has an invalid format`);
    return normalized;
}

function projectCode(value, name) {
    const normalized = requiredString(value, name);
    if (!PROJECT_CODE.test(normalized)) throw new Error(`${name} has an invalid format`);
    return normalized;
}

function compareCodePoints(left, right) {
    const a = Array.from(left, (value) => value.codePointAt(0));
    const b = Array.from(right, (value) => value.codePointAt(0));
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
        if (a[index] !== b[index]) return a[index] - b[index];
    }
    return a.length - b.length;
}

// This is intentionally byte-compatible with VibePro's managed-handoff v2
// canonicalization. The shared Brainbase RFC 8785 helper orders JS UTF-16
// code units, which differs for non-BMP property names.
function canonicalJson(value) {
    const seen = new Set();
    const serialize = (input) => {
        if (input === null || typeof input === 'boolean' || typeof input === 'string') return JSON.stringify(input);
        if (typeof input === 'number') {
            if (!Number.isFinite(input)) throw new TypeError('canonical JSON only supports finite numbers');
            return JSON.stringify(input);
        }
        if (!input || typeof input !== 'object') throw new TypeError(`canonical JSON does not support ${typeof input}`);
        if (seen.has(input)) throw new TypeError('canonical JSON does not support cyclic values');
        seen.add(input);
        let result;
        if (Array.isArray(input)) {
            for (let index = 0; index < input.length; index += 1) {
                if (!Object.hasOwn(input, index)) throw new TypeError('canonical JSON does not support sparse arrays');
            }
            result = `[${input.map((entry) => serialize(entry)).join(',')}]`;
        } else {
            const prototype = Object.getPrototypeOf(input);
            if (prototype !== Object.prototype && prototype !== null) {
                throw new TypeError('canonical JSON only supports plain objects');
            }
            result = `{${Object.keys(input).sort(compareCodePoints).map((key) => {
                if (input[key] === undefined) throw new TypeError('canonical JSON does not support undefined');
                return `${JSON.stringify(key)}:${serialize(input[key])}`;
            }).join(',')}}`;
        }
        seen.delete(input);
        return result;
    };
    return serialize(value);
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

function canonicalManagedHandoffPayload(receipt) {
    return canonicalJson([
        SCHEMA_VERSION,
        Object.fromEntries(PAYLOAD_FIELDS.map((field) => [field, receipt[field]]))
    ]);
}

function normalizeRepository(value) {
    const normalized = requiredString(value, 'target.repository').replace(/\/+$/u, '').replace(/\.git$/u, '');
    if (normalized.includes('@') && /:\/\//u.test(normalized)) {
        throw new Error('target.repository must not contain credentials');
    }
    const ssh = normalized.match(/^git@github\.com:([^/]+\/[^/]+)$/u);
    const https = normalized.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)$/u);
    const github = normalized.match(/^github:\/\/([^/]+\/[^/]+)$/u);
    if (ssh?.[1]) return `github://${ssh[1]}`;
    if (https?.[1]) return `github://${https[1]}`;
    if (github?.[1]) return `github://${github[1]}`;
    if (/^(?:repo|https|brainbase|graph|drive):\/\//u.test(normalized)) return normalized;
    throw new Error('target.repository must be a canonical repository URI');
}

function normalizeRepositoryRoot(value) {
    const root = requiredString(value, 'target.repository_root');
    const normalized = path.posix.normalize(root.replaceAll('\\', '/'));
    if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
        throw new Error('target.repository_root must be repository-relative');
    }
    return normalized || '.';
}

function timestamp(value, name) {
    const normalized = requiredString(value, name);
    if (!RFC3339.test(normalized) || !Number.isFinite(new Date(normalized).valueOf())) {
        throw new Error(`${name} must be RFC 3339`);
    }
    return normalized;
}

function technicalAcceptance(value) {
    if (!Array.isArray(value) || value.length === 0) throw new Error('technicalAcceptance must be a nonempty array');
    const ids = new Set();
    return value.map((entry, index) => {
        const acceptance = object(entry, `technicalAcceptance[${index}]`);
        const id = safeIdentifier(acceptance.id, `technicalAcceptance[${index}].id`);
        if (ids.has(id)) throw new Error('technicalAcceptance must not contain duplicate ids');
        ids.add(id);
        return {
            id,
            criterion: requiredString(acceptance.criterion, `technicalAcceptance[${index}].criterion`)
        };
    });
}

function productionProbe(value) {
    const probe = object(value, 'productionProbe');
    const id = safeIdentifier(probe.id, 'productionProbe.id');
    const expectedReceipt = `brainbase://production-probes/${id}/receipt`;
    if (probe.terminal_receipt_target !== undefined
        && requiredString(probe.terminal_receipt_target, 'productionProbe.terminal_receipt_target') !== expectedReceipt) {
        throw new Error('productionProbe.terminal_receipt_target does not identify the production probe');
    }
    return {
        id,
        procedure: requiredString(probe.procedure, 'productionProbe.procedure'),
        terminal_receipt_target: expectedReceipt
    };
}

/**
 * Produces the VibePro v2 managed-handoff wire only; it performs no I/O and
 * does not authenticate its snapshots. `brainbase://` values are logical
 * references, not API/readback proof. Its HMAC is for one shared trust domain,
 * not independent issuer proof, and no production source loader is connected.
 */
export function createVibeproManagedHandoff({
    outcomeCase,
    decision,
    target,
    technicalAcceptance: acceptanceInput,
    productionProbe: probeInput,
    signingKey,
    keyId,
    issuedAt,
    expiresAt
} = {}) {
    const sourceCase = object(outcomeCase, 'outcomeCase');
    const sourceDecision = object(decision, 'decision');
    const sourceTarget = object(target, 'target');
    const caseId = safeIdentifier(sourceCase.case_id, 'outcomeCase.case_id');
    const outcomeProject = projectCode(sourceCase.project_code, 'outcomeCase.project_code');
    const decisionCase = safeIdentifier(sourceDecision.case_id, 'decision.case_id');
    const decisionProject = projectCode(sourceDecision.project_code, 'decision.project_code');
    const targetProject = projectCode(sourceTarget.project_code, 'target.project_code');
    if (caseId !== decisionCase || caseId !== safeIdentifier(sourceTarget.case_id ?? caseId, 'target.case_id')) {
        throw new Error('OutcomeCase, decision, and target case_id must match');
    }
    if (outcomeProject !== decisionProject || outcomeProject !== targetProject) {
        throw new Error('OutcomeCase, decision, and target project_code must match');
    }

    const resolutionId = managedIdentifier(sourceDecision.resolution_id, 'decision.resolution_id');
    const turnId = managedIdentifier(sourceDecision.turn_id, 'decision.turn_id');
    const baseSha = requiredString(sourceTarget.base_sha, 'target.base_sha');
    if (!SHA.test(baseSha)) throw new Error('target.base_sha must be a lowercase 40 or 64 character Git SHA digest');
    const normalizedIssuedAt = timestamp(issuedAt, 'issuedAt');
    const normalizedExpiresAt = timestamp(expiresAt, 'expiresAt');
    if (new Date(normalizedExpiresAt).valueOf() <= new Date(normalizedIssuedAt).valueOf()) {
        throw new Error('expiresAt must be after issuedAt');
    }
    const secret = requiredString(signingKey, 'signingKey');
    if (secret.length < 32) throw new Error('signingKey must contain at least 32 characters');

    const receipt = {
        schema_version: SCHEMA_VERSION,
        repository: normalizeRepository(sourceTarget.repository),
        repository_root: normalizeRepositoryRoot(sourceTarget.repository_root),
        project_code: outcomeProject,
        base_sha: baseSha,
        issued_at: normalizedIssuedAt,
        expires_at: normalizedExpiresAt,
        turn_id: turnId,
        resolution_id: resolutionId,
        story_id: sourceTarget.story_id === null ? null : safeIdentifier(sourceTarget.story_id, 'target.story_id'),
        authorized: false,
        graph_promotion_allowed: false,
        outcome_case: {
            case_id: caseId,
            outcome_case_ref: `brainbase://outcome-cases/${caseId}`,
            judgment_receipt_ref: `brainbase://judgment-receipts/${resolutionId}`,
            decision_digest: sha256(canonicalJson(sourceDecision)),
            user_observable_outcome: requiredString(sourceCase.user_observable_outcome, 'outcomeCase.user_observable_outcome'),
            technical_acceptance: technicalAcceptance(acceptanceInput),
            production_probe: productionProbe(probeInput)
        }
    };
    const payload = canonicalManagedHandoffPayload(receipt);
    return {
        ...receipt,
        receipt_digest: sha256(payload),
        signature: {
            algorithm: 'hmac-sha256',
            key_id: managedIdentifier(keyId, 'keyId'),
            value: createHmac('sha256', secret).update(payload).digest('hex')
        }
    };
}
