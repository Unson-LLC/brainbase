import { resolveCanonicalTenantIdentity } from '../../lib/canonical-tenant-identity.js';
import { OutcomeCaseError } from './outcome-case-service.js';
import { createVibeproManagedHandoff } from './vibepro-managed-handoff.js';

const ISSUE_FIELDS = new Set(['caseId', 'resolutionId']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const MANAGED_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const PROJECT_CODE = /^[a-z0-9][a-z0-9._-]{0,99}$/u;
const MAX_TTL_MS = 60 * 60 * 1000;

function opaque(code, status, message) {
    return new OutcomeCaseError(code, message, { status });
}

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function identifier(value, pattern) {
    return typeof value === 'string' && pattern.test(value.trim()) ? value.trim() : null;
}

function input(value) {
    if (!isObject(value) || Object.keys(value).some((key) => !ISSUE_FIELDS.has(key))) {
        throw opaque('vibepro_handoff_input_invalid', 422, 'VibePro handoff input is invalid');
    }
    const caseId = identifier(value.caseId, SAFE_IDENTIFIER);
    const resolutionId = identifier(value.resolutionId, MANAGED_IDENTIFIER);
    if (!caseId || !resolutionId) throw opaque('vibepro_handoff_input_invalid', 422, 'VibePro handoff input is invalid');
    return { caseId, resolutionId };
}

function requiredSourceField(source, key) {
    return Object.hasOwn(source, key);
}

function assertOutcomeCase(outcomeCase, { caseId, organizationId, actor }) {
    if (!isObject(outcomeCase) || outcomeCase.case_id !== caseId) {
        throw opaque('vibepro_handoff_case_incoherent', 409, 'VibePro handoff case is incoherent');
    }
    if (outcomeCase.organization_id !== organizationId
        || !Array.isArray(actor.projectCodes)
        || !actor.projectCodes.includes(outcomeCase.project_code)) {
        throw opaque('vibepro_handoff_actor_denied', 403, 'VibePro handoff actor is not authorized');
    }
    if (!identifier(outcomeCase.project_code, PROJECT_CODE)
        || !Number.isSafeInteger(outcomeCase.revision)
        || outcomeCase.revision < 1) {
        throw opaque('vibepro_handoff_case_incoherent', 409, 'VibePro handoff case is incoherent');
    }
}

function assertSource(source, { caseId, resolutionId, organizationId, outcomeCase }) {
    const required = [
        'status', 'organization_id', 'project_code', 'case_id', 'resolution_id', 'outcome_case_revision',
        'decision', 'target', 'technicalAcceptance', 'productionProbe'
    ];
    if (!isObject(source) || required.some((key) => !requiredSourceField(source, key))
        || source.status !== 'adopted'
        || !isObject(source.decision) || !isObject(source.target)
        || !Array.isArray(source.technicalAcceptance) || source.technicalAcceptance.length === 0
        || !isObject(source.productionProbe)) {
        throw opaque('vibepro_handoff_source_invalid', 409, 'VibePro handoff source is invalid');
    }
    if (source.organization_id !== organizationId
        || source.project_code !== outcomeCase.project_code
        || source.case_id !== caseId
        || source.resolution_id !== resolutionId
        || source.outcome_case_revision !== outcomeCase.revision) {
        throw opaque('vibepro_handoff_source_incoherent', 409, 'VibePro handoff source is incoherent');
    }
    if (source.decision.case_id !== caseId
        || source.decision.project_code !== outcomeCase.project_code
        || source.decision.resolution_id !== resolutionId
        || source.target.case_id !== caseId
        || source.target.project_code !== outcomeCase.project_code) {
        throw opaque('vibepro_handoff_source_incoherent', 409, 'VibePro handoff source is incoherent');
    }
}

function issuedAt(clock) {
    try {
        const now = clock();
        if (now instanceof Date && Number.isFinite(now.getTime())) return now;
    } catch {
        // Clock/provider errors are configuration failures, not source failures.
    }
    throw opaque('vibepro_handoff_configuration_invalid', 500, 'VibePro handoff configuration is invalid');
}

function assertSigningConfiguration(signingKey, keyId) {
    if (typeof signingKey !== 'string' || signingKey.trim().length < 32
        || /[\u0000-\u001f\u007f]/u.test(signingKey)
        || !identifier(keyId, MANAGED_IDENTIFIER)
        || /[\u0000-\u001f\u007f]/u.test(keyId)) {
        throw opaque('vibepro_handoff_configuration_invalid', 500, 'VibePro handoff configuration is invalid');
    }
}

/**
 * Issues only from a construction-time trusted loader. `actor` is already
 * authenticated by the service entrypoint; this library does not verify tokens.
 * The producer's judgment_receipt_ref is a logical source reference, while its
 * decision_digest hashes this adopted snapshot, never an ordinary Turn receipt.
 */
export function createVibeproHandoffIssuer({
    outcomeCaseService,
    readAdoptedHandoff,
    signingKey,
    keyId,
    clock = () => new Date(),
    ttlMs = 300000
} = {}) {
    if (!outcomeCaseService || typeof outcomeCaseService.read !== 'function') {
        throw new TypeError('createVibeproHandoffIssuer requires outcomeCaseService.read');
    }
    if (typeof clock !== 'function' || !Number.isFinite(ttlMs) || ttlMs < 1 || ttlMs > MAX_TTL_MS) {
        throw new TypeError(`ttlMs must be a finite value from 1 to ${MAX_TTL_MS}`);
    }
    assertSigningConfiguration(signingKey, keyId);

    return {
        async issue(request, actor) {
            const { caseId, resolutionId } = input(request);
            const identity = resolveCanonicalTenantIdentity(actor);
            if (identity.state !== 'confirmed') {
                throw opaque('vibepro_handoff_actor_denied', 403, 'VibePro handoff actor is not authorized');
            }

            let outcomeCase;
            try {
                outcomeCase = await outcomeCaseService.read(caseId, actor);
            } catch (error) {
                if (error instanceof OutcomeCaseError && [403, 404, 422].includes(error.status)) {
                    throw opaque('vibepro_handoff_case_unavailable', error.status, 'VibePro handoff case is unavailable');
                }
                throw opaque('vibepro_handoff_case_unavailable', 503, 'VibePro handoff case is unavailable');
            }
            assertOutcomeCase(outcomeCase, { caseId, organizationId: identity.organizationId, actor });

            if (typeof readAdoptedHandoff !== 'function') {
                throw opaque('vibepro_handoff_source_unavailable', 503, 'VibePro handoff source is unavailable');
            }
            let source;
            try {
                source = await readAdoptedHandoff({
                    caseId,
                    resolutionId,
                    organizationId: identity.organizationId,
                    projectCode: outcomeCase.project_code,
                    actor
                });
            } catch (_error) {
                throw opaque('vibepro_handoff_source_unavailable', 503, 'VibePro handoff source is unavailable');
            }
            if (source === null) throw opaque('vibepro_handoff_source_not_found', 404, 'VibePro handoff source was not found');
            assertSource(source, { caseId, resolutionId, organizationId: identity.organizationId, outcomeCase });

            const now = issuedAt(clock);
            try {
                return createVibeproManagedHandoff({
                    outcomeCase,
                    decision: source.decision,
                    target: source.target,
                    technicalAcceptance: source.technicalAcceptance,
                    productionProbe: source.productionProbe,
                    signingKey,
                    keyId,
                    issuedAt: now.toISOString(),
                    expiresAt: new Date(now.getTime() + ttlMs).toISOString()
                });
            } catch (_error) {
                throw opaque('vibepro_handoff_source_invalid', 409, 'VibePro handoff source is invalid');
            }
        }
    };
}
