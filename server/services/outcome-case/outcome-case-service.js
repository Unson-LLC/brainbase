import crypto from 'crypto';
import { resolveCanonicalTenantIdentity } from '../../lib/canonical-tenant-identity.js';

const CLOSURE_STATUSES = new Set(['open', 'incomplete', 'waiting_human', 'closed']);
const EXTERNAL_STATES = new Set([
    'unknown', 'accepted', 'processing', 'delivered', 'verified-complete', 'failed'
]);
const EVIDENCE_STATES = new Set(['confirmed', 'unconfirmed', 'no_data']);
const READBACK_STATES = new Set(['confirm', 'unconfirmed', 'no_data']);
const CONSTRAINT_STATES = new Set(['satisfied', 'violated', 'unknown']);
const REFERENCE_STATES = new Set(['confirmed', 'unresolved']);
const CREATE_FIELDS = new Set([
    'case_id', 'project_code', 'capability_id', 'user_observable_outcome',
    'protected_constraints', 'non_goals', 'selected_domain_pack',
    'current_external_state', 'technical_story_refs', 'run_receipt_refs',
    'prior_attempt_refs', 'unresolved_failure_boundary'
]);
const EVALUATION_FIELDS = new Set([
    'technical_evidence', 'run_receipt_refs', 'external_readback', 'constraints_status',
    'evaluator', 'observed_at', 'current_external_state', 'unresolved_failure_boundary'
]);

export class OutcomeCaseError extends Error {
    constructor(code, message, { status = 422, details = null } = {}) {
        super(message);
        this.name = 'OutcomeCaseError';
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

function validation(message, details = null) {
    return new OutcomeCaseError('validation_failed', message, { details });
}

function requireString(value, field) {
    if (typeof value !== 'string' || !value.trim()) throw validation(`${field} is required`, { field });
    return value.trim();
}

function requireArray(value, field) {
    if (!Array.isArray(value)) throw validation(`${field} must be an array`, { field });
    return value.map((item, index) => requireString(item, `${field}[${index}]`));
}

function requirePlainObject(value, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw validation(`${field} must be an object`, { field });
    }
    return structuredClone(value);
}

function requireEnum(value, field, allowed) {
    if (!allowed.has(value)) throw validation(`${field} is not supported`, { field, value });
    return value;
}

function requireIsoTimestamp(value, field) {
    const normalized = requireString(value, field);
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) throw validation(`${field} must be an ISO timestamp`, { field });
    return parsed.toISOString();
}

function rejectUnknownFields(value, allowed, subject) {
    const unknown = Object.keys(value || {}).filter((key) => !allowed.has(key));
    if (unknown.length) throw validation(`${subject} contains unsupported fields`, { fields: unknown });
}

function uniqueRefs(value, field) {
    return [...new Set(requireArray(value, field))];
}

function normalizeResolvedAuthority(value) {
    const authority = requirePlainObject(value, 'resolved_authority');
    rejectUnknownFields(authority, new Set(['state', 'closure_authorized_person_ids', 'provenance', 'reason']), 'resolved_authority');
    const state = requireEnum(authority.state, 'resolved_authority.state', REFERENCE_STATES);
    const ids = state === 'confirmed' ? uniqueRefs(authority.closure_authorized_person_ids, 'resolved_authority.closure_authorized_person_ids') : [];
    const provenance = authority.provenance === undefined || authority.provenance === null
        ? null
        : requirePlainObject(authority.provenance, 'resolved_authority.provenance');
    const reason = authority.reason === undefined ? null : requireString(authority.reason, 'resolved_authority.reason');
    if (state === 'confirmed' && (!ids.length || !provenance)) throw validation('confirmed resolved authority requires ids and provenance');
    if (state === 'unresolved' && !reason) throw validation('unresolved resolved authority requires reason');
    return { state, closure_authorized_person_ids: ids, provenance, reason };
}

function unresolvedReference(ref, reason) {
    return { ref, state: 'unresolved', reason };
}

function normalizeReference(value, field, expectedRef) {
    const reference = requirePlainObject(value, field);
    rejectUnknownFields(reference, new Set(['ref', 'state', 'reason']), field);
    if (requireString(reference.ref, `${field}.ref`) !== expectedRef) {
        throw validation(`${field}.ref must match the OutcomeCase reference`, { field });
    }
    const state = requireEnum(reference.state, `${field}.state`, REFERENCE_STATES);
    const reason = reference.reason === undefined || reference.reason === null
        ? null
        : requireString(reference.reason, `${field}.reason`);
    if (state === 'unresolved' && !reason) {
        throw validation(`${field}.reason is required when the reference is unresolved`, { field });
    }
    return { ref: expectedRef, state, reason };
}

function normalizeReferenceResolution(value, { projectCode, capabilityId }) {
    const resolution = requirePlainObject(value, 'reference_resolution');
    rejectUnknownFields(resolution, new Set(['project', 'capability']), 'reference_resolution');
    return {
        project: normalizeReference(resolution.project, 'reference_resolution.project', projectCode),
        capability: normalizeReference(resolution.capability, 'reference_resolution.capability', capabilityId)
    };
}

async function resolveReferences(resolveOutcomeReferences, outcomeCase, actor) {
    try {
        const resolution = await resolveOutcomeReferences({
            projectCode: outcomeCase.project_code,
            capabilityId: outcomeCase.capability_id,
            actor: clone(actor)
        });
        return normalizeReferenceResolution(resolution, {
            projectCode: outcomeCase.project_code,
            capabilityId: outcomeCase.capability_id
        });
    } catch (error) {
        return {
            project: unresolvedReference(outcomeCase.project_code, 'authoritative_resolver_unavailable'),
            capability: unresolvedReference(outcomeCase.capability_id, 'authoritative_resolver_unavailable')
        };
    }
}

function closureActorPersonId(actor) {
    const personId = actor?.person_id;
    return typeof personId === 'string' && personId.trim() ? personId.trim() : null;
}

function assertClosureAuthority(authority, actor) {
    const personId = closureActorPersonId(actor);
    if (!personId) {
        throw new OutcomeCaseError('closure_actor_unauthenticated', 'A verified actor is required to close an OutcomeCase', {
            status: 403
        });
    }
    if (authority?.state !== 'confirmed' || !authority.closure_authorized_person_ids.includes(personId)) {
        throw new OutcomeCaseError('closure_authority_denied', 'The authenticated actor is not authorized to close this OutcomeCase', {
            status: 403,
            details: { person_id: personId }
        });
    }
    return personId;
}

function clone(value) {
    return structuredClone(value);
}

function normalizeCreate(input, { now, generateCaseId }) {
    requirePlainObject(input, 'OutcomeCase');
    rejectUnknownFields(input, CREATE_FIELDS, 'OutcomeCase');
    const nowIso = now.toISOString();
    return {
        case_id: input.case_id === undefined ? generateCaseId() : requireString(input.case_id, 'case_id'),
        project_code: requireString(input.project_code, 'project_code'),
        capability_id: requireString(input.capability_id, 'capability_id'),
        user_observable_outcome: requireString(input.user_observable_outcome, 'user_observable_outcome'),
        protected_constraints: requireArray(input.protected_constraints, 'protected_constraints'),
        non_goals: requireArray(input.non_goals, 'non_goals'),
        authority: null,
        selected_domain_pack: requireString(input.selected_domain_pack, 'selected_domain_pack'),
        reference_resolution: null,
        evaluation_history: [],
        terminal_evaluation: null,
        closure_status: 'open',
        current_external_state: requireEnum(
            input.current_external_state,
            'current_external_state',
            EXTERNAL_STATES
        ),
        technical_story_refs: uniqueRefs(input.technical_story_refs, 'technical_story_refs'),
        run_receipt_refs: uniqueRefs(input.run_receipt_refs, 'run_receipt_refs'),
        prior_attempt_refs: uniqueRefs(input.prior_attempt_refs, 'prior_attempt_refs'),
        unresolved_failure_boundary: input.unresolved_failure_boundary === null
            ? null
            : requireString(input.unresolved_failure_boundary, 'unresolved_failure_boundary'),
        revision: 1,
        created_at: nowIso,
        updated_at: nowIso
    };
}

function normalizeEvaluation(input) {
    requirePlainObject(input, 'evaluation');
    rejectUnknownFields(input, EVALUATION_FIELDS, 'evaluation');
    const technicalEvidence = requirePlainObject(input.technical_evidence, 'technical_evidence');
    rejectUnknownFields(technicalEvidence, new Set(['status', 'refs']), 'technical_evidence');
    const technicalStatus = requireEnum(technicalEvidence.status, 'technical_evidence.status', EVIDENCE_STATES);
    const technicalRefs = uniqueRefs(technicalEvidence.refs, 'technical_evidence.refs');
    if (technicalStatus === 'confirmed' && technicalRefs.length === 0) {
        throw validation('technical_evidence.refs is required when technical evidence is confirmed');
    }

    const externalReadback = requirePlainObject(input.external_readback, 'external_readback');
    rejectUnknownFields(externalReadback, new Set(['status', 'ref']), 'external_readback');
    const externalReadbackStatus = requireEnum(externalReadback.status, 'external_readback.status', READBACK_STATES);
    const externalReadbackRef = externalReadback.ref === undefined
        ? null
        : requireString(externalReadback.ref, 'external_readback.ref');
    if (externalReadbackStatus === 'confirm' && !externalReadbackRef) {
        throw validation('external_readback.ref is required when external readback is confirm');
    }

    return {
        technical_evidence: { status: technicalStatus, refs: technicalRefs },
        run_receipt_refs: uniqueRefs(input.run_receipt_refs, 'run_receipt_refs'),
        external_readback: { status: externalReadbackStatus, ref: externalReadbackRef },
        constraints_status: requireEnum(input.constraints_status, 'constraints_status', CONSTRAINT_STATES),
        evaluator_claim: requireString(input.evaluator, 'evaluator'),
        observed_at: requireIsoTimestamp(input.observed_at, 'observed_at'),
        current_external_state: input.current_external_state === undefined
            ? undefined
            : requireEnum(input.current_external_state, 'current_external_state', EXTERNAL_STATES),
        unresolved_failure_boundary: input.unresolved_failure_boundary === undefined
            ? undefined
            : input.unresolved_failure_boundary === null
                ? null
                : requireString(input.unresolved_failure_boundary, 'unresolved_failure_boundary')
    };
}

export function deriveClosureStatus({ technicalEvidence, runReceipts, externalReadback, constraintsStatus, referenceResolution, authority }) {
    const allReceiptsConfirmed = runReceipts.length > 0
        && runReceipts.every((receipt) => receipt.evidence_state === 'confirmed');
    const referencesConfirmed = referenceResolution?.project?.state === 'confirmed'
        && referenceResolution?.capability?.state === 'confirmed';
    const authorityConfirmed = authority?.state === 'confirmed'
        && authority.closure_authorized_person_ids.length > 0;
    const closeEligible = technicalEvidence.status === 'confirmed'
        && allReceiptsConfirmed
        && externalReadback.status === 'confirm'
        && constraintsStatus === 'satisfied'
        && referencesConfirmed
        && authorityConfirmed;
    if (closeEligible) return { closure_status: 'closed', close_eligible: true };
    if (externalReadback.status === 'no_data'
        || constraintsStatus === 'unknown'
        || !referencesConfirmed
        || !authorityConfirmed
        || runReceipts.some((receipt) => receipt.evidence_state === 'no_data')) {
        return { closure_status: 'waiting_human', close_eligible: false };
    }
    return { closure_status: 'incomplete', close_eligible: false };
}

export class OutcomeCaseService {
    constructor({ repository, readRunReceipt, resolveOutcomeReferences, resolveClosureAuthority, now = () => new Date(), generateCaseId = () => `oc_${crypto.randomUUID()}` } = {}) {
        if (!repository) throw new Error('OutcomeCaseService requires repository');
        if (typeof readRunReceipt !== 'function') throw new Error('OutcomeCaseService requires readRunReceipt');
        if (typeof resolveOutcomeReferences !== 'function') throw new Error('OutcomeCaseService requires resolveOutcomeReferences');
        if (typeof resolveClosureAuthority !== 'function') throw new Error('OutcomeCaseService requires resolveClosureAuthority');
        this.repository = repository;
        this.readRunReceipt = readRunReceipt;
        this.resolveOutcomeReferences = resolveOutcomeReferences;
        this.resolveClosureAuthority = resolveClosureAuthority;
        this.now = now;
        this.generateCaseId = generateCaseId;
    }

    async create(input, actor = {}) {
        const baseCase = normalizeCreate(input, { now: this.now(), generateCaseId: this.generateCaseId });
        const organizationId = this.assertProjectAccess(baseCase.project_code, actor);
        const outcomeCase = {
            ...baseCase,
            organization_id: organizationId,
            reference_resolution: await resolveReferences(this.resolveOutcomeReferences, baseCase, actor),
            authority: await this.resolveAuthority(baseCase, actor)
        };
        const existing = await this.repository.findByCaseId(outcomeCase.case_id, actor);
        if (existing) throw new OutcomeCaseError('outcome_case_already_exists', 'OutcomeCase already exists', { status: 409 });
        return this.repository.create(outcomeCase, actor);
    }

    async read(caseId, actor = {}) {
        this.assertOrganizationAccess(actor);
        const outcomeCase = await this.repository.findByCaseId(requireString(caseId, 'case_id'), actor);
        if (!outcomeCase) throw new OutcomeCaseError('outcome_case_not_found', 'OutcomeCase not found', { status: 404 });
        this.assertProjectAccess(outcomeCase.project_code, actor);
        return outcomeCase;
    }

    assertProjectAccess(projectCode, actor) {
        const organizationId = this.assertOrganizationAccess(actor);
        if (!Array.isArray(actor?.projectCodes) || !actor.projectCodes.includes(projectCode)) {
            throw new OutcomeCaseError('outcome_case_project_access_denied', 'The authenticated actor cannot access this OutcomeCase project', { status: 403 });
        }
        return organizationId;
    }

    assertOrganizationAccess(actor) {
        const identity = resolveCanonicalTenantIdentity(actor);
        if (identity.state !== 'confirmed') {
            throw new OutcomeCaseError('outcome_case_organization_access_denied', 'An authenticated organization is required to access OutcomeCase', {
                status: 403,
                details: {
                    audit_event: identity.state === 'ambiguous'
                        ? 'outcome_case_ambiguous_tenant_denied'
                        : 'outcome_case_unknown_tenant_denied'
                }
            });
        }
        return identity.organizationId;
    }

    async resolveAuthority(outcomeCase, actor) {
        try {
            return normalizeResolvedAuthority(await this.resolveClosureAuthority({ projectCode: outcomeCase.project_code, actor: clone(actor) }));
        } catch {
            return { state: 'unresolved', closure_authorized_person_ids: [], provenance: null, reason: 'authoritative_closure_authority_unavailable' };
        }
    }

    async evaluate(caseId, input, actor = {}) {
        const outcomeCase = await this.read(caseId, actor);
        const evaluation = normalizeEvaluation(input);
        const retainedRunReceiptRefs = [...new Set([
            ...(outcomeCase.run_receipt_refs || []),
            ...evaluation.run_receipt_refs
        ])];
        const runReceipts = await Promise.all(retainedRunReceiptRefs.map(async (runReceiptRef) => {
            const receipt = await this.readRunReceipt({
                projectCode: outcomeCase.project_code,
                runReceiptRef,
                actor
            });
            return {
                ref: runReceiptRef,
                evidence_state: EVIDENCE_STATES.has(receipt?.evidence_state)
                    ? receipt.evidence_state
                    : 'no_data'
            };
        }));
        const referenceResolution = await resolveReferences(this.resolveOutcomeReferences, outcomeCase, actor);
        const authority = await this.resolveAuthority(outcomeCase, actor);
        const closure = deriveClosureStatus({
            technicalEvidence: evaluation.technical_evidence,
            runReceipts,
            externalReadback: evaluation.external_readback,
            constraintsStatus: evaluation.constraints_status,
            referenceResolution,
            authority
        });
        const evaluatedBy = closure.close_eligible
            ? assertClosureAuthority(authority, actor)
            : closureActorPersonId(actor);
        const evaluationRecord = {
            technical_evidence: evaluation.technical_evidence,
            run_receipt_refs: evaluation.run_receipt_refs,
            retained_run_receipt_refs: retainedRunReceiptRefs,
            run_receipts: runReceipts,
            external_readback: evaluation.external_readback,
            constraints_status: evaluation.constraints_status,
            evaluator_claim: evaluation.evaluator_claim,
            evaluated_by: evaluatedBy,
            observed_at: evaluation.observed_at,
            reference_resolution: referenceResolution,
            authority,
            closure_status: closure.closure_status,
            close_eligible: closure.close_eligible
        };
        const updated = {
            ...clone(outcomeCase),
            run_receipt_refs: retainedRunReceiptRefs,
            reference_resolution: referenceResolution,
            authority,
            evaluation_history: [...(outcomeCase.evaluation_history || []), {
                ...evaluationRecord,
                current_external_state: evaluation.current_external_state ?? outcomeCase.current_external_state,
                unresolved_failure_boundary: evaluation.unresolved_failure_boundary === undefined ? outcomeCase.unresolved_failure_boundary : evaluation.unresolved_failure_boundary,
                resulting_revision: Number(outcomeCase.revision) + 1,
                resulting_closure_status: closure.closure_status
            }],
            terminal_evaluation: evaluationRecord,
            closure_status: closure.closure_status,
            current_external_state: evaluation.current_external_state ?? outcomeCase.current_external_state,
            unresolved_failure_boundary: evaluation.unresolved_failure_boundary === undefined
                ? outcomeCase.unresolved_failure_boundary
                : evaluation.unresolved_failure_boundary,
            revision: Number(outcomeCase.revision) + 1,
            updated_at: this.now().toISOString()
        };
        return this.repository.update(updated, { expectedRevision: outcomeCase.revision, actor });
    }
}

export const OUTCOME_CASE_CLOSURE_STATUSES = CLOSURE_STATUSES;
